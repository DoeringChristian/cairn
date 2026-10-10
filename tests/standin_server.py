"""TEST-ONLY stand-in for the server half of 0.6 in the client branch.

MERGE NOTE: the server agent implements the real ingestion protocol (spec
§4) and the local-server auto-start (§5). Until then this module gives the
existing end-to-end tests (``cairn.Run`` then ``cairn.Reader``) a server:

* ``ingest_router()``: §4's endpoints on any test app, applying records with
  0.5's ingest code (``wal_ingest._apply_op``) and an ``ingest_progress``
  table, one transaction per batch, exactly once by (run, log, seq);
* ``install(monkeypatch)``: a local repo's "server" is an in-process app
  over it (``TestClient``); every group commit of a run's log is uploaded
  at once through the real uploader code (``cairn.uploader.sync``), so the
  repo sees what a run logged as soon as it is durable.

At merge time delete this module (and its uses in conftest.py) in favour of
the real server.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import threading
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response

_TABLE = """CREATE TABLE IF NOT EXISTS ingest_progress (
    run_id TEXT NOT NULL, log TEXT NOT NULL, applied_seq INTEGER NOT NULL,
    PRIMARY KEY (run_id, log))"""


def _applied(db: Any, run_id: str, log: str) -> int:
    db.write(_TABLE)
    rows = db.read_columns(
        "SELECT applied_seq FROM ingest_progress WHERE run_id = ? AND log = ?", [run_id, log])
    return int(rows[0]["applied_seq"]) if rows else 0


_apply_lock = threading.Lock()


def ingest_router() -> APIRouter:
    from cairn.sdk.runlog.codec import RESERVED
    from cairn.server.wal_ingest import _apply_op

    r = APIRouter()

    @r.get("/api/ingest/runs/{run_id}/logs/{log}")
    def get_applied(run_id: str, log: str, request: Request) -> dict[str, int]:
        return {"applied_seq": _applied(request.app.state.db, run_id, log)}

    @r.post("/api/ingest/runs/{run_id}/logs/{log}")
    async def post_records(run_id: str, log: str, request: Request) -> Any:
        body = await request.body()
        if request.headers.get("content-encoding") == "gzip":
            body = gzip.decompress(body)
        req = json.loads(body)
        state = request.app.state
        db = state.db
        with _apply_lock:
            applied = _applied(db, run_id, log)
            if req["from_seq"] > applied + 1:
                return Response(json.dumps({"applied_seq": applied}), status_code=409,
                                media_type="application/json")
            first = req["records"][0] if req["records"] else {}
            waits_for = None
            if log != "main" or first.get("op") in ("resume_run", "rewind_run"):
                waits_for = run_id  # a worker's (or a reopening) log needs its run
            elif first.get("op") == "fork_run" and applied == 0:
                waits_for = first.get("parent_id")  # a fork needs its parent
            if waits_for and not db.read_columns("SELECT 1 FROM runs WHERE id = ?", [waits_for]):
                return Response(json.dumps({"detail": f"run {waits_for} not created yet"}),
                                status_code=503, headers={"Retry-After": "0.2"},
                                media_type="application/json")
            with db.transaction():
                for rec in req["records"]:
                    if rec["seq"] <= applied:
                        continue
                    payload = {k: v for k, v in rec.items() if k not in RESERVED}
                    try:
                        with db.transaction():
                            _apply_op(db, state.data_dir, state.blobs, rec["op"], payload, run_id,
                                      worker=log != "main")
                    except Exception:  # noqa: BLE001 - as 0.5's ingester: skip a bad op
                        pass
                    applied = rec["seq"]
                db.write(
                    "INSERT INTO ingest_progress (run_id, log, applied_seq) VALUES (?, ?, ?) "
                    "ON CONFLICT (run_id, log) DO UPDATE SET applied_seq = excluded.applied_seq",
                    [run_id, log, applied],
                )
        return {"applied_seq": applied}

    @r.head("/api/blobs/{digest}")
    def head_blob(digest: str, request: Request) -> Response:
        return Response(status_code=200 if request.app.state.blobs.exists(digest) else 404)

    @r.put("/api/blobs/{digest}")
    async def put_blob(digest: str, request: Request) -> dict[str, str]:
        data = await request.body()
        if hashlib.sha256(data).hexdigest() != digest:
            raise HTTPException(400, "hash mismatch")
        request.app.state.blobs.put(data)
        return {"hash": digest}

    return r


# ---- local repos: an in-process app each ----------------------------------------------

_repos: dict[str, Any] = {}
_repos_lock = threading.Lock()


def repo_client(repo: str | Path) -> Any:
    """A ``TestClient`` over an app serving ``repo`` (no lifespan loops)."""
    from fastapi.testclient import TestClient

    from cairn.server.app import create_app
    from cairn.server.storage.blobs import BlobStore
    from cairn.server.storage.datadir import DataDir
    from cairn.server.storage.db import Database

    key = str(Path(repo).resolve())
    with _repos_lock:
        if key not in _repos:
            dd = DataDir(Path(key))
            db = Database.open(dd.db_path)
            blobs = BlobStore(dd.artifacts_dir)
            app = create_app(db=db, blobs=blobs, data_dir_obj=dd, background_tasks=False)
            client = TestClient(app, base_url="http://standin")
            client.__enter__()  # the lifespan puts db/blobs on app.state
            _repos[key] = (client, db)
        return _repos[key][0]


def close_all() -> None:
    with _repos_lock:
        for client, db in _repos.values():
            try:
                client.__exit__(None, None, None)
            finally:
                db.close()
        _repos.clear()


def _ingest_client(run_dir: Any) -> Any:
    from cairn import config
    from cairn.uploader.client import IngestClient

    meta = run_dir.meta()
    if meta.get("endpoint") in (None, "local"):
        return IngestClient("http://standin", client=repo_client(meta["repo"]))
    url = meta["endpoint"]
    return IngestClient(url, meta.get("token") or config.resolve_token(url), timeout=10)


_sync_locks: dict[str, threading.Lock] = {}


def sync_now(run_dir: Any) -> None:
    from cairn.uploader.sync import DirSync

    lock = _sync_locks.setdefault(str(run_dir.path), threading.Lock())
    with lock:
        client = _ingest_client(run_dir)
        try:
            ds = DirSync(run_dir)
            for _ in range(1000):
                if ds.step(client, budget=64) == 0:
                    break
        finally:
            client.close()


def sync_repo(repo: str | Path) -> None:
    """Upload every run directory of ``$CAIRN_DIR`` that belongs to ``repo``."""
    import os

    from cairn.sdk.runlog.rundir import cairn_dir, iter_run_dirs

    from cairn.sdk.runlog.log import _live_writers

    # What this process logged so far, as if the group commit had just run.
    for w in list(_live_writers):
        try:
            w.flush()
        except Exception:  # noqa: BLE001
            pass
    want = str(Path(repo).resolve())
    for rd in iter_run_dirs(cairn_dir()) if os.environ.get("CAIRN_DIR") else []:
        if rd.meta().get("repo") == want:
            try:
                sync_now(rd)
            except Exception:  # noqa: BLE001
                pass


def install(monkeypatch: Any) -> None:
    from cairn.sdk.runlog import server as server_mod
    from cairn.sdk.runlog.writer import RunWriter
    from cairn.sdk.transport import Transport

    orig_api = server_mod.ServerReads.api
    orig_peek = server_mod.ServerReads.peek

    def api(self: Any) -> Any:
        if self.server is None and self.repo:
            if self._api is None:
                self._api = Transport("http://standin", client=repo_client(self.repo))
            return self._api
        return orig_api(self)

    def peek(self: Any) -> Any:
        if self.server is None and self.repo:
            return api(self)
        return orig_peek(self)

    orig_init = RunWriter.__init__

    def init(self: Any, *args: Any, **kwargs: Any) -> None:
        orig_init(self, *args, **kwargs)

        def on_commit(_seq: int) -> None:
            try:
                sync_now(self.run_dir)
            except Exception:  # noqa: BLE001 - a test server that is down
                pass

        self.log._on_commit = on_commit

    monkeypatch.setattr(server_mod.ServerReads, "api", api)
    monkeypatch.setattr(server_mod.ServerReads, "peek", peek)
    monkeypatch.setattr(RunWriter, "__init__", init)
