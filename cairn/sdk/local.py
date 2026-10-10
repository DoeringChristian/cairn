"""Writing to a local repo (a ``.cairn/`` directory) without a server URL.

``RepoTransport`` — writes that are not a run's own logging (Reader and CLI
edits, sweeps, registry edits, ``cairn.log_artifact``, imports). Each call
goes to the live server holding the repo's ingest lease over HTTP, or else
takes the lease briefly, catches up on pending logs and writes the database
itself. (A ``cairn.Run`` writes only its run directory: ``cairn.sdk.runlog``.)
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
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

    def rename_run(self, run_id: str, name: str) -> dict[str, Any]:
        """-> ``{"display_name", "version"}`` (the run's number in its new series)."""
        return self._call(
            "rename_run", lambda db: ingest_ops.rename_run(db, run_id, name), run_id, name,
        )

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

    def record_run_use(self, run_id: str, used_run_id: str, role: str | None) -> None:
        from ..server import artifact_registry_ops as ops

        self._call(
            "record_run_use",
            lambda db: ops.record_run_use(db, run_id=run_id, used_run_id=used_run_id, role=role),
            run_id, used_run_id, role,
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
