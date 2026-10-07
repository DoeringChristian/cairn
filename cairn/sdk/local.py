"""Writing to a local repo (a ``.cairn/`` directory) without a server URL.

Two transports, one rule: only the holder of the repo's ingest lease writes
SQLite (see ``cairn/server/storage/lease.py``).

* ``LocalTransport`` — a ``cairn.Run``'s writer. Every write is a record
  appended to the run's own log, ``.cairn/wals/<run_id>.wal.jsonl``, plus
  content-addressed blobs; the lease holder ingests the log (a running
  ``cairn ui``/``cairn server`` within ~2 s, else the next Reader or CLI
  command). Many processes, on many hosts of a shared filesystem, can log
  at once without contending for the database. What needs an answer now
  (``use_artifact``, resume / fork / rewind, sweep claims) goes through
  ``RepoTransport``.
* ``RepoTransport`` — every other write (Reader and CLI edits, sweeps,
  registry edits, ``cairn.log_artifact``, imports). Each call goes to the
  live server holding the lease over HTTP, or else takes the lease briefly,
  catches up on pending logs and writes the database itself.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, TypeVar

from ..server import ingest_ops
from ..server.storage import lease as lease_mod
from ..server.storage.blobs import BlobStore
from ..server.storage.datadir import DataDir
from ..server.storage.db import Database

log = logging.getLogger(__name__)

T = TypeVar("T")

#: Seconds a writer waits for a brief lease holder (another CLI command or
#: Reader catching up) before giving up.
LEASE_WAIT = 300.0


class ServerUnreachable(RuntimeError):
    """The live server holding a repo's lease does not answer."""


def server_transport(holder: dict[str, Any], root: Path, timeout: float = 10.0) -> Any:
    """An HTTP ``Transport`` to the server ``holder`` (a lease's contents),
    authenticated with the repo's ``auth/local.token`` (same-user trust:
    the serving process leaves it in the repo for exactly this)."""
    import httpx

    from .transport import Transport

    url = lease_mod.server_url(holder)
    try:
        resp = httpx.get(f"{url}/api/health", timeout=2.0)
        if resp.status_code != 200:
            raise RuntimeError(f"status {resp.status_code}")
    except Exception as exc:
        raise ServerUnreachable(
            f"the repo {root} is served by {holder.get('mode', 'a server')} "
            f"(pid {holder.get('pid')} on {holder.get('host')}) at {url}, which does not "
            f"answer ({exc}). Pass that server's reachable URL with --server/repo=, or "
            "stop it."
        ) from exc
    tok_path = root / "auth" / "local.token"
    token = tok_path.read_text().strip() if tok_path.exists() else None
    return Transport(url, timeout=timeout, token=token)


class RepoTransport:
    """Writes to a local repo through its ingest-lease holder.

    Every method runs on the live server that holds the lease (over HTTP,
    the same calls as ``Transport``), or else in this process under the
    lease, after catching up on pending run logs. Mirrors the public surface
    of ``cairn.sdk.transport.Transport`` for everything that is not a run's
    own logging.
    """

    def __init__(self, repo: str | Path, *, timeout: float = 10.0) -> None:
        self.data_dir = DataDir(Path(repo))
        self.blobs = BlobStore(self.data_dir.artifacts_dir)
        self.server_url = f"file://{self.data_dir.root}"
        self._timeout = timeout
        self._db: Database | None = None
        self._remote: Any = None
        self._remote_holder: dict[str, Any] | None = None
        self._lock = threading.Lock()

    # ---- plumbing --------------------------------------------------------

    def _server(self, holder: dict[str, Any]) -> Any:
        if self._remote is None or self._remote_holder != holder:
            if self._remote is not None:
                self._remote.close()
            self._remote = server_transport(holder, self.data_dir.root, self._timeout)
            self._remote_holder = holder
        return self._remote

    def database(self) -> Database:
        """The repo's database; open it (migrations included) only under the lease."""
        if self._db is None:
            self._db = Database.open(self.data_dir.db_path)
        return self._db

    def served_by(self) -> Any:
        """An HTTP ``Transport`` to the live server holding the repo's lease
        (in another process), or None when there is none."""
        holder = lease_mod.serving_holder(self.data_dir.root)
        return None if holder is None else self._server(holder)

    def under_lease(self, fn: Callable[[Database], T], *, catch_up_first: bool = True) -> T:
        """``fn(db)`` in this process under the lease, after catching up on
        pending run logs (unless not ``catch_up_first``).

        Raises:
            lease.ServedByServer: A live server holds the lease.
        """
        with (
            lease_mod.acquire(self.data_dir.root, mode="client", wait=LEASE_WAIT),
            self._lock,
        ):
            db = self.database()
            if catch_up_first:
                catch_up(self.data_dir, db, self.blobs)
            return fn(db)

    def _call(self, name: str, local: Callable[[Database], T], *args: Any, **kwargs: Any) -> T:
        """``local(db)`` under the lease, or ``Transport.<name>(*args)`` on
        the server holding it."""
        holder = lease_mod.serving_holder(self.data_dir.root)
        if holder is None:
            try:
                return self.under_lease(local)
            except lease_mod.ServedByServer as exc:
                holder = exc.holder
        return getattr(self._server(holder), name)(*args, **kwargs)

    def ingest_pending(self) -> int:
        """Apply every pending run log now (on the server, or here)."""
        return self._call("ingest_pending", lambda db: 0)

    def close(self) -> None:
        if self._remote is not None:
            self._remote.close()
            self._remote = None
        if self._db is not None:
            self._db.close()
            self._db = None

    # ---- runs --------------------------------------------------------------

    def create_run(self, body: dict[str, Any]) -> dict[str, Any]:
        fields = {k: body.get(k) for k in ingest_ops.CREATE_RUN_FIELDS}
        return self._call(
            "create_run",
            lambda db: ingest_ops.create_run(db, project=body["project"], **fields),
            body,
        )

    def post_batch(self, run_id: str, points: list[dict[str, Any]]) -> bool:
        def local(db: Database) -> bool:
            ingest_ops.insert_batch(db, run_id, points)
            return True
        return self._call("post_batch", local, run_id, points)

    def post_params(self, run_id: str, params: dict[str, Any]) -> None:
        self._call("post_params", lambda db: ingest_ops.set_params(db, run_id, params), run_id, params)

    def post_summary(self, run_id: str, summary: dict[str, Any]) -> None:
        self._call(
            "post_summary", lambda db: ingest_ops.set_summary(db, run_id, summary), run_id, summary,
        )

    def post_logs(self, run_id: str, lines: list[dict[str, Any]]) -> bool:
        def local(db: Database) -> bool:
            ingest_ops.insert_logs(db, self.data_dir, run_id, lines)
            return True
        return self._call("post_logs", local, run_id, lines)

    def finish_run(
        self, run_id: str, status: str, exit_code: int | None = None,
        ended_at: str | None = None,
    ) -> None:
        self._call(
            "finish_run",
            lambda db: ingest_ops.finish_run(db, run_id, status, exit_code, ended_at),
            run_id, status, exit_code, ended_at=ended_at,
        )

    def set_tags(self, run_id: str, tags: list[str]) -> None:
        self._call("set_tags", lambda db: ingest_ops.set_tags(db, run_id, tags), run_id, tags)

    def set_notes(self, run_id: str, notes: str) -> None:
        self._call("set_notes", lambda db: ingest_ops.set_notes(db, run_id, notes), run_id, notes)

    def rename_run(self, run_id: str, name: str) -> None:
        self._call("rename_run", lambda db: ingest_ops.rename_run(db, run_id, name), run_id, name)

    def delete_keys(self, run_id: str, table: str, keys: list[str]) -> None:
        self._call(
            "delete_keys", lambda db: ingest_ops.delete_keys(db, run_id, table, keys),
            run_id, table, keys,
        )

    def set_metric_rule(
        self, run_id: str, name: str, x: str | None, summary: str | None,
    ) -> None:
        self._call(
            "set_metric_rule",
            lambda db: ingest_ops.set_metric_rule(db, run_id, name, x, summary),
            run_id, name, x, summary,
        )

    def upload_source(self, run_id: str, archive: bytes, manifest: dict[str, Any]) -> None:
        self._call(
            "upload_source",
            lambda db: ingest_ops.save_source(db, self.data_dir, run_id, archive, manifest),
            run_id, archive, manifest,
        )

    def upload_artifact(
        self, data: bytes, mime_type: str, metadata: dict[str, Any] | None = None,
        object_type: str | None = None,
    ) -> str:
        return self._call(
            "upload_artifact",
            lambda db: ingest_ops.put_artifact(
                db, self.blobs, data, mime_type, metadata, object_type=object_type,
            )["hash"],
            data, mime_type, metadata, object_type,
        )

    def download_artifact_bytes(self, digest: str) -> bytes:
        return self.blobs.get(digest)

    def drain_spill(self, run_id: str | None = None) -> int:
        return 0

    # ---- versioned artifact registry ------------------------------------------

    def create_artifact_version(self, project_id: str, body: dict[str, Any]) -> dict[str, Any]:
        from ..server import artifact_registry_ops as ops

        return self._call(
            "create_artifact_version",
            lambda db: ops.create_version(db, self.blobs, project_id=project_id, **body),
            project_id, body,
        )

    def resolve_artifact(self, project_id: str, ref: str) -> dict[str, Any]:
        """``[project/]name[:alias|:vN]`` -> the version dict."""
        from ..server import artifact_registry_ops as ops

        return self._call(
            "resolve_artifact", lambda db: ops.resolve_ref(db, project_id, ref), project_id, ref,
        )

    def record_artifact_input(self, run_id: str, artifact_version_id: str, role: str) -> None:
        from ..server import artifact_registry_ops as ops

        self._call(
            "record_artifact_input",
            lambda db: ops.record_input(
                db, run_id=run_id, artifact_version_id=artifact_version_id, role=role,
            ),
            run_id, artifact_version_id, role,
        )

    def add_artifact_alias(self, version_id: str, alias: str) -> dict[str, Any]:
        from ..server import artifact_registry_ops as ops
        return self._call(
            "add_artifact_alias", lambda db: ops.add_alias(db, version_id, alias), version_id, alias,
        )

    def remove_artifact_alias(self, version_id: str, alias: str) -> dict[str, Any]:
        from ..server import artifact_registry_ops as ops
        return self._call(
            "remove_artifact_alias", lambda db: ops.remove_alias(db, version_id, alias),
            version_id, alias,
        )

    def add_artifact_tag(self, version_id: str, tag: str) -> dict[str, Any]:
        from ..server import artifact_registry_ops as ops
        return self._call(
            "add_artifact_tag", lambda db: ops.add_tag(db, version_id, tag), version_id, tag,
        )

    def remove_artifact_tag(self, version_id: str, tag: str) -> dict[str, Any]:
        from ..server import artifact_registry_ops as ops
        return self._call(
            "remove_artifact_tag", lambda db: ops.remove_tag(db, version_id, tag), version_id, tag,
        )

    def update_artifact_version(self, version_id: str, body: dict[str, Any]) -> dict[str, Any]:
        from ..server import artifact_registry_ops as ops
        return self._call(
            "update_artifact_version", lambda db: ops.update_version(db, version_id, **body),
            version_id, body,
        )

    def delete_artifact_version(self, version_id: str, force: bool) -> None:
        from ..server import artifact_registry_ops as ops
        self._call(
            "delete_artifact_version", lambda db: ops.delete_version(db, version_id, force=force),
            version_id, force,
        )

    def delete_artifact_family(self, project_id: str, name: str) -> None:
        from ..server import artifact_registry_ops as ops

        def local(db: Database) -> None:
            fam = ops.get_family_by_name(db, project_id, name)
            if fam is None:
                raise LookupError(f"no artifact {name!r} in project {project_id!r}")
            ops.delete_family(db, fam["id"])
        self._call("delete_artifact_family", local, project_id, name)

    # ---- sweeps ----------------------------------------------------------------

    def create_sweep(self, body: dict[str, Any]) -> dict[str, Any]:
        from ..server import sweep_ops

        def local(db: Database) -> dict[str, Any]:
            b = dict(body)
            sweep_ops.check_keys(b, (*sweep_ops.CONFIG_KEYS, "sweep_id"))
            return sweep_ops.create_sweep(db, space=b.pop("parameters"), **b)
        return self._call("create_sweep", local, body)

    def list_sweeps(self, project: str | None = None) -> list[dict[str, Any]]:
        from ..server import sweep_ops
        from ..server.routes._common import slugify
        return self._call(
            "list_sweeps",
            lambda db: sweep_ops.list_sweeps(db, slugify(project) if project else None),
            project,
        )

    def get_sweep(self, sweep_id: str) -> dict[str, Any]:
        from ..server import sweep_ops
        return self._call("get_sweep", lambda db: sweep_ops.get_sweep(db, sweep_id), sweep_id)

    def sweep_action(self, sweep_id: str, action: str) -> dict[str, Any]:
        from ..server import sweep_ops
        return self._call(
            "sweep_action", lambda db: sweep_ops.set_status(db, sweep_id, action), sweep_id, action,
        )

    def next_trial(self, sweep_id: str) -> dict[str, Any]:
        from ..server import sweep_ops
        return self._call("next_trial", lambda db: sweep_ops.next_trial(db, sweep_id), sweep_id)

    def report_trial(self, sweep_id: str, trial_id: str, **body: Any) -> dict[str, Any]:
        from ..server import sweep_ops
        return self._call(
            "report_trial",
            lambda db: sweep_ops.report_trial(db, sweep_id, trial_id, **body),
            sweep_id, trial_id, **body,
        )


def catch_up(data_dir: DataDir, db: Database, blobs: BlobStore) -> int:
    """Ingest pending run logs; the caller holds the lease."""
    from ..server.wal_ingest import has_pending, ingest_all

    if not has_pending(data_dir, db):
        return 0
    return ingest_all(data_dir, db, blobs)


class LocalTransport:
    """A ``cairn.Run``'s writer on a local repo: appends to the run's log.

    Mirrors the public surface of ``cairn.sdk.transport.Transport``. Never
    writes SQLite; reads (``should_stop``, a resumed run's steps) use a
    read-only connection and see what the lease holder ingested so far.

    ``label`` and ``primary`` describe the process (set by ``cairn.Run``
    before it creates or joins the run): a labelled process writes
    ``<run_id>~<label>.wal.jsonl``; a worker (not ``primary``) opens its log
    with ``join``, ends it with ``detach`` and writes no heartbeats.
    """

    #: Seconds ``join_run`` waits for a run whose project it must look up.
    JOIN_WAIT = 120.0

    def __init__(self, repo: str | Path, *, timeout: float = 10.0):
        self.data_dir = DataDir(Path(repo))
        self.blobs = BlobStore(self.data_dir.artifacts_dir)
        self.server_url = f"file://{self.data_dir.root}"
        self._closed = False
        self._repo = RepoTransport(self.data_dir.root, timeout=timeout)
        self._ro: Database | None = None
        self._ro_lock = threading.Lock()
        self._wal_dir = self.data_dir.root / "wals"
        self._wal_dir.mkdir(parents=True, exist_ok=True)
        self._wal_fh: Any = None
        self._wal_lock = threading.Lock()
        self._wal_seq = 0
        self._log_finished = False
        self.label: str | None = None
        self.primary = True

    @property
    def repo(self) -> RepoTransport:
        """Where writes that need an answer go (the lease holder)."""
        return self._repo

    # ---- the run's log ---------------------------------------------------------

    def _open_log(self, run_id: str) -> None:
        """Start (or, for a resumed run or a worker joining again, continue)
        this process's log of the run."""
        from ..server.wal_ingest import log_name

        path = self._wal_dir / log_name(run_id, self.label)
        if not self.primary and _last_op(path) == "detach":
            # An earlier process with this label detached: let the lease
            # holder finish (and delete) its log before this one continues it.
            self._repo.ingest_pending()
        fh = open(path, "ab")  # noqa: SIM115
        if self.label is not None and not _try_lock(fh):
            fh.close()
            raise ValueError(
                f"label {self.label!r} is in use by another live process of run {run_id}"
            )
        if fh.tell() > 0:
            # A writer killed mid-append left a torn last line: end it, so the
            # next record is a line of its own.
            with open(path, "rb") as rd:
                rd.seek(-1, 2)
                if rd.read(1) != b"\n":
                    fh.write(b"\n")
        self._wal_fh = fh
        self._log_finished = False

    def _wal_write(self, op: str, payload: dict[str, Any]) -> int:
        with self._wal_lock:
            if self._wal_fh is None or self._log_finished:
                log.warning("run log closed; dropped a %r record", op)
                return self._wal_seq
            self._wal_seq += 1
            entry = {"seq": self._wal_seq, "op": op, "payload": payload}
            line = json.dumps(entry, separators=(",", ":")) + "\n"
            self._wal_fh.write(line.encode("utf-8"))
            self._wal_fh.flush()
            os.fsync(self._wal_fh.fileno())
            if op in ("finish", "detach"):
                # The last record: the ingester deletes the log once it has
                # applied it, so nothing may follow.
                self._log_finished = True
                self._wal_fh.close()
                self._wal_fh = None
            return self._wal_seq

    # ---- reads ---------------------------------------------------------------

    def read_columns(self, sql: str, params: list[Any] | None = None) -> list[dict[str, Any]]:
        """A read query on the repo DB (read-only; what has been ingested so
        far). A repo without a database yet reads as empty."""
        with self._ro_lock:
            if self._ro is None:
                if not self.data_dir.db_path.exists():
                    return []
                self._ro = Database.open_readonly(self.data_dir.db_path)
            ro = self._ro
        return ro.read_columns(sql, params)

    def readonly_db(self) -> Database | None:
        self.read_columns("SELECT 1")
        return self._ro

    # ---- lifecycle -----------------------------------------------------------

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        with self._wal_lock:
            if self._wal_fh is not None:
                try:
                    self._wal_fh.close()
                except OSError:
                    pass
                self._wal_fh = None
        with self._ro_lock:
            if self._ro is not None:
                self._ro.close()
                self._ro = None
        self._repo.close()

    # ---- run lifecycle ---------------------------------------------------------

    def create_run(self, body: dict[str, Any]) -> dict[str, Any]:
        """Create a run from a create body (the ``POST /api/runs`` shape)."""
        fields = {k: body.get(k) for k in ingest_ops.CREATE_RUN_FIELDS}
        run_id = body["run_id"]
        project = body["project"]
        project_id = ingest_ops.slugify(project)
        if self.read_columns("SELECT id FROM runs WHERE id = ?", [run_id]) or (
            self._primary_log(run_id) is not None
        ):
            raise ingest_ops.RunExists(f"a run with id {run_id} exists already")
        self._open_log(run_id)
        self._wal_write("create_run", {
            **fields,
            "project": project,
            "project_id": project_id,
            "created_at": fields["created_at"] or datetime.now(timezone.utc).isoformat(),
        })
        return {"run_id": run_id, "project_id": project_id, "url": f"/p/{project_id}/r/{run_id}"}

    def _primary_log(self, run_id: str) -> Path | None:
        """A primary's log of ``run_id`` not ingested to its end yet (one
        opening with ``create_run``/``fork_run``), if any."""
        from ..server.wal_ingest import LABEL_SEP, LOG_SUFFIX

        candidates = [self._wal_dir / f"{run_id}{LOG_SUFFIX}",
                      *self._wal_dir.glob(f"{run_id}{LABEL_SEP}*{LOG_SUFFIX}")]
        for path in candidates:
            if _first_record(path).get("op") in ("create_run", "fork_run"):
                return path
        return None

    def join_run(self, run_id: str, project: str | None) -> dict[str, Any]:
        """Join ``run_id`` as a worker: open this process's log with a
        ``join`` record; its records wait at the ingester until the run
        exists. Returns the run's ``project_id``/``url`` and, if it is
        ingested already, its tags, documents, status and stop request.

        The project is the ingested run's, else ``project``, else the one
        its primary's log names, waiting up to ``JOIN_WAIT`` seconds for
        either to appear.

        Raises:
            ValueError: ``project`` is not the run's project.
            ingest_ops.RunNotFound: No such run appeared in time.
        """
        import time

        from ..server import config_doc

        deadline = time.monotonic() + self.JOIN_WAIT
        while True:
            rows = self.read_columns("SELECT * FROM runs WHERE id = ?", [run_id])
            row = rows[0] if rows else None
            project_id = row["project_id"] if row else None
            if project_id is None and project is not None:
                project_id = ingest_ops.slugify(project)
            if project_id is None:
                path = self._primary_log(run_id)
                if path is not None:
                    project_id = _first_record(path)["payload"].get("project_id")
            if project_id is not None or time.monotonic() > deadline:
                break
            time.sleep(0.25)
        if project_id is None:
            raise ingest_ops.RunNotFound(f"run {run_id} not found")
        if row is not None and project is not None and ingest_ops.slugify(project) != project_id:
            raise ValueError(f"run {run_id} is in project {project_id!r}, not {project!r}")
        self._open_log(run_id)
        self._wal_write("join", {"run_id": run_id, "label": self.label})
        return {
            "run_id": run_id, "project_id": project_id, "url": f"/p/{project_id}/r/{run_id}",
            "tags": json.loads(row["tags"]) if row and row.get("tags") else [],
            "config": config_doc.loads(row.get("config")) if row else {},
            "summary": config_doc.loads(row.get("summary")) if row else {},
            "status": row["status"] if row else None,
            "stop_requested": row.get("stop_requested") if row else None,
        }

    def detach_run(self, run_id: str) -> None:
        """End a worker's log: the run's status is its primary's to set."""
        self._wal_write("detach", {"run_id": run_id})

    def _ingested_run(self, run_id: str) -> dict[str, Any]:
        """The run as stored, after the lease holder caught up on every log
        (this run's earlier one included)."""
        self._repo.ingest_pending()
        rows = self.read_columns("SELECT * FROM runs WHERE id = ?", [run_id])
        if not rows:
            raise ingest_ops.RunNotFound(f"run {run_id} not found")
        return rows[0]

    @staticmethod
    def _reopened(row: dict[str, Any]) -> dict[str, Any]:
        from ..server import config_doc

        pid, rid = row["project_id"], row["id"]
        return {
            "run_id": rid, "project_id": pid, "url": f"/p/{pid}/r/{rid}",
            "tags": json.loads(row["tags"]) if row.get("tags") else [],
            "config": config_doc.loads(row.get("config")),
            "summary": config_doc.loads(row.get("summary")),
        }

    def resume_run(self, run_id: str) -> dict[str, Any]:
        row = self._ingested_run(run_id)
        self._open_log(run_id)
        self._wal_write("resume_run", {"run_id": run_id})
        return self._reopened(row)

    def rewind_run(self, run_id: str, step: int) -> dict[str, Any]:
        row = self._ingested_run(run_id)
        self._open_log(run_id)
        self._wal_write("rewind_run", {"run_id": run_id, "step": step})
        return self._reopened(row)

    def fork_run(
        self, parent_id: str, new_id: str, step: int, body: dict[str, Any],
    ) -> dict[str, Any]:
        """``body`` is the child's create body (the ``create_run`` shape)."""
        from ..server import config_doc

        fields = {
            k: body.get(k) for k in ingest_ops.CREATE_RUN_FIELDS
            if k not in ("run_id", "parent_run_id", "fork_step")
        }
        parent = self._ingested_run(parent_id)
        pid = parent["project_id"]
        if self.read_columns("SELECT id FROM runs WHERE id = ?", [new_id]) or (
            self._primary_log(new_id) is not None
        ):
            raise ingest_ops.RunExists(f"a run with id {new_id} exists already")
        self._open_log(new_id)
        self._wal_write("fork_run", {
            **fields, "parent_id": parent_id, "new_id": new_id, "step": step,
        })
        return {
            "run_id": new_id, "project_id": pid, "url": f"/p/{pid}/r/{new_id}",
            "config": config_doc.loads(parent.get("config")),
            "summary": config_doc.loads(parent.get("summary")),
        }

    def sequence_steps(self, run_id: str) -> list[dict[str, Any]]:
        """Each of the run's series as ``{name, max_step}``."""
        return self.read_columns(
            "SELECT name, MAX(step) AS max_step FROM sequences "
            "WHERE run_id = ? GROUP BY name",
            [run_id],
        )

    def post_batch(self, run_id: str, points: list[dict[str, Any]]) -> bool:
        try:
            self._wal_write("batch", {"run_id": run_id, "points": points})
            return True
        except Exception:  # noqa: BLE001
            log.exception("post_batch failed for run %s", run_id)
            return False

    def post_params(self, run_id: str, params: dict[str, Any]) -> None:
        self._wal_write("params", {"run_id": run_id, "params": params})

    def post_summary(self, run_id: str, summary: dict[str, Any]) -> None:
        self._wal_write("summary", {"run_id": run_id, "summary": summary})

    def post_logs(self, run_id: str, lines: list[dict[str, Any]]) -> bool:
        try:
            self._wal_write("logs", {"run_id": run_id, "lines": lines})
            return True
        except Exception:  # noqa: BLE001
            log.exception("post_logs failed for run %s", run_id)
            return False

    def finish_run(
        self, run_id: str, status: str, exit_code: int | None = None,
        ended_at: str | None = None,
    ) -> None:
        ended_at = ended_at or datetime.now(timezone.utc).isoformat()
        self._wal_write("finish", {
            "run_id": run_id, "status": status, "exit_code": exit_code, "ended_at": ended_at,
        })

    def set_total_steps(self, run_id: str, total_steps: int | None) -> None:
        self._wal_write("total_steps", {"run_id": run_id, "total_steps": total_steps})

    def post_progress(self, run_id: str, body: dict[str, Any]) -> None:
        """``body``: value, total, wall_time."""
        self._wal_write("progress", {"run_id": run_id, **body})

    def set_tags(self, run_id: str, tags: list[str]) -> None:
        self._wal_write("set_tags", {"run_id": run_id, "tags": tags})

    def set_notes(self, run_id: str, notes: str) -> None:
        self._wal_write("set_notes", {"run_id": run_id, "notes": notes})

    def rename_run(self, run_id: str, name: str) -> None:
        self._wal_write("rename_run", {"run_id": run_id, "name": name})

    def delete_keys(self, run_id: str, table: str, keys: list[str]) -> None:
        self._wal_write("delete_keys", {"run_id": run_id, "table": table, "keys": keys})

    def alert(self, run_id: str, alert: dict[str, Any]) -> None:
        """``alert``: alert_id, title, text, level, created_at."""
        self._wal_write("alert", {"run_id": run_id, **alert})

    def set_metric_rule(
        self, run_id: str, name: str, x: str | None, summary: str | None,
    ) -> None:
        self._wal_write("set_metric_rule", {
            "run_id": run_id, "name": name, "x": x, "summary": summary,
        })

    def upload_source(self, run_id: str, archive: bytes, manifest: dict[str, Any]) -> None:
        digest, _ = self.blobs.put(archive)
        self._wal_write("source", {"run_id": run_id, "hash": digest, "manifest": manifest})

    def upload_artifact(
        self,
        data: bytes,
        mime_type: str,
        metadata: dict[str, Any] | None = None,
        object_type: str | None = None,
    ) -> str:
        digest, _ = self.blobs.put(data)
        self._wal_write("artifact_meta", {
            "hash": digest, "mime_type": mime_type,
            "size_bytes": len(data), "metadata": metadata or {},
            "object_type": object_type,
        })
        return digest

    def heartbeat(self, run_id: str) -> str | None:
        """Log a heartbeat; return the run's ``stop_requested`` timestamp, if
        any (read-only, as far as the holder has ingested). A worker writes
        no heartbeat: the run's liveness is its primary's."""
        if self.primary:
            now = datetime.now(timezone.utc).isoformat()
            self._wal_write("heartbeat", {"run_id": run_id, "wall_time": now})
        rows = self.read_columns("SELECT stop_requested FROM runs WHERE id = ?", [run_id])
        return rows[0]["stop_requested"] if rows else None

    # ---- versioned artifact registry ------------------------------------------

    def create_artifact_version(self, project_id: str, body: dict[str, Any]) -> dict[str, Any] | None:
        """Log a new version (``body``: the ``POST
        /api/projects/{id}/artifact-versions`` shape, with a client-generated
        ``version_id``). Its number is assigned at ingestion, so this returns
        None (``ArtifactVersion.wait`` blocks until it is)."""
        from ..server import artifact_registry_ops

        artifact_registry_ops.validate_name(body["name"])
        for alias in body.get("aliases") or []:
            artifact_registry_ops.validate_user_alias(alias)
        artifact_registry_ops.validate_tags(body.get("tags"))
        # A family keeps one type: refuse now what ingestion would drop (as
        # far as the repo has ingested; the ingester checks again).
        known = self.read_columns(
            "SELECT type FROM artifact_families WHERE project_id = ? AND name = ?",
            [project_id, body["name"]],
        )
        want = body.get("type") or "artifact"
        if known and known[0]["type"] != want:
            raise ValueError(
                f"artifact {body['name']!r} has type {known[0]['type']!r}, not {want!r}"
            )
        self._wal_write("create_artifact_version", {"project_id": project_id, **body})
        return None

    def resolve_artifact(self, project_id: str, ref: str) -> dict[str, Any]:
        """``[project/]name[:alias|:vN]`` -> the version dict, after the lease
        holder caught up on every pending log (this run's own included)."""
        self._repo.ingest_pending()
        return self._repo.resolve_artifact(project_id, ref)

    def record_artifact_input(self, run_id: str, artifact_version_id: str, role: str) -> None:
        """Record (in the run's log) that the run consumed an artifact version."""
        self._wal_write("record_artifact_input", {
            "run_id": run_id, "artifact_version_id": artifact_version_id, "role": role,
        })

    def add_artifact_alias(self, version_id: str, alias: str) -> dict[str, Any]:
        return self._repo.add_artifact_alias(version_id, alias)

    def remove_artifact_alias(self, version_id: str, alias: str) -> dict[str, Any]:
        return self._repo.remove_artifact_alias(version_id, alias)

    def add_artifact_tag(self, version_id: str, tag: str) -> dict[str, Any]:
        return self._repo.add_artifact_tag(version_id, tag)

    def remove_artifact_tag(self, version_id: str, tag: str) -> dict[str, Any]:
        return self._repo.remove_artifact_tag(version_id, tag)

    def update_artifact_version(self, version_id: str, body: dict[str, Any]) -> dict[str, Any]:
        return self._repo.update_artifact_version(version_id, body)

    def delete_artifact_version(self, version_id: str, force: bool) -> None:
        self._repo.delete_artifact_version(version_id, force)

    def delete_artifact_family(self, project_id: str, name: str) -> None:
        self._repo.delete_artifact_family(project_id, name)

    # ---- sweeps (through the lease holder: a claim needs an answer now) ---------

    def create_sweep(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._repo.create_sweep(body)

    def list_sweeps(self, project: str | None = None) -> list[dict[str, Any]]:
        return self._repo.list_sweeps(project)

    def get_sweep(self, sweep_id: str) -> dict[str, Any]:
        return self._repo.get_sweep(sweep_id)

    def sweep_action(self, sweep_id: str, action: str) -> dict[str, Any]:
        return self._repo.sweep_action(sweep_id, action)

    def next_trial(self, sweep_id: str) -> dict[str, Any]:
        return self._repo.next_trial(sweep_id)

    def report_trial(self, sweep_id: str, trial_id: str, **body: Any) -> dict[str, Any]:
        return self._repo.report_trial(sweep_id, trial_id, **body)

    def download_artifact_bytes(self, digest: str) -> bytes:
        """Raw artifact bytes by hash, from the local blob store."""
        return self.blobs.get(digest)

    def drain_spill(self, run_id: str | None = None) -> int:
        """Local mode never spills; nothing to drain."""
        return 0


def _first_record(path: Path) -> dict[str, Any]:
    """A log's first complete record ({} if none, or no such file)."""
    try:
        with open(path, "rb") as fh:
            line = fh.readline()
    except FileNotFoundError:
        return {}
    if not line.endswith(b"\n"):
        return {}
    try:
        record = json.loads(line)
    except json.JSONDecodeError:
        return {}
    return record if isinstance(record, dict) else {}


def _last_op(path: Path) -> str | None:
    """The op of a log's last complete record (None if none, or no file)."""
    try:
        with open(path, "rb") as fh:
            size = fh.seek(0, 2)
            fh.seek(max(0, size - 4096))
            tail = fh.read()
    except FileNotFoundError:
        return None
    lines = tail.rstrip(b"\n").rsplit(b"\n", 1)
    if not tail.endswith(b"\n") or not lines[-1]:
        return None
    try:
        return json.loads(lines[-1]).get("op")
    except (json.JSONDecodeError, AttributeError):
        return None


def _try_lock(fh: Any) -> bool:
    """Hold an exclusive advisory lock on a labelled process's log while it
    is open: False when another live process holds it. Best effort: where
    the platform or filesystem has no such locks (Windows, some network
    filesystems) the label is not checked."""
    try:
        import fcntl
    except ImportError:
        return True
    try:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return False
    except OSError:
        return True
    return True
