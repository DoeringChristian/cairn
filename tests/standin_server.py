"""Test helper: upload run directories in-process at every group commit.

Tests read back right after logging, so instead of the background uploader
(off in tests, ``CAIRN_UPLOADER=off``) each commit is uploaded synchronously
to the repo's server (an in-process test server, see ``tests/conftest.py``).
"""

from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Any

_sync_locks: dict[str, threading.Lock] = {}


def _ingest_client(run_dir: Any) -> Any:
    from cairn import config
    from cairn.endpoint import resolve_endpoint
    from cairn.uploader.client import IngestClient

    meta = run_dir.meta()
    if meta.get("endpoint") in (None, "local"):
        ep = resolve_endpoint(repo=meta["repo"])
        return IngestClient(ep.url, ep.token, timeout=10)
    url = meta["endpoint"]
    return IngestClient(url, meta.get("token") or config.resolve_token(url), timeout=10)


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
    from cairn.sdk.runlog.log import _live_writers
    from cairn.sdk.runlog.rundir import cairn_dir, iter_run_dirs

    for w in list(_live_writers):  # as if the group commit had just run
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
    from cairn.sdk.runlog.writer import RunWriter

    orig_init = RunWriter.__init__

    def init(self: Any, *args: Any, **kwargs: Any) -> None:
        orig_init(self, *args, **kwargs)

        def on_commit(_seq: int) -> None:
            try:
                sync_now(self.run_dir)
            except Exception:  # noqa: BLE001 - a test server that is down
                pass

        self.log._on_commit = on_commit

    monkeypatch.setattr(RunWriter, "__init__", init)
