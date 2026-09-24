"""Local transport — direct-DB or WAL mode for server-less SDK use.

When a ``Run`` is constructed with ``repo=`` pointing at a ``.cairn/``
directory, it uses ``LocalTransport`` instead of the HTTP ``Transport``.

Two modes controlled by ``use_wal``:

* **Direct DB** (default, ``use_wal=False``): writes go straight to SQLite
  via ``ingest_ops``. Simple, immediate. Fine for single-machine use.

* **WAL mode** (``use_wal=True``): writes go to a per-run append-only
  JSONL file (``.cairn/wals/{run_id}.wal.jsonl``). The SDK never touches
  the SQLite database. The UI server ingests WAL files in the background.
  Use this for NFS / multi-node / Slurm setups.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import secrets
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psutil

from ..server import ingest_ops
from ..server.storage.blobs import BlobStore
from ..server.storage.datadir import DataDir
from ..server.storage.db import Database

log = logging.getLogger(__name__)

# Max artifact size to inline in WAL (base64).
_INLINE_ARTIFACT_MAX = 1 * 1024 * 1024  # 1 MB


class _RepoServedByOtherError(Exception):
    """Internal signal: a server is already serving this repo."""

    def __init__(self, holder: dict[str, Any]):
        self.holder = holder
        super().__init__(
            f"repo is being served by {holder.get('mode')!r} on "
            f"{holder.get('host')!r}:{holder.get('port')!r}"
        )


def _holder_is_live(holder: dict[str, Any] | None) -> bool:
    if not holder:
        return False
    pid = holder.get("pid")
    return isinstance(pid, int) and psutil.pid_exists(pid)


class LocalTransport:
    """Mirrors the public surface of ``cairn.sdk.transport.Transport`` but
    writes to the local repo — either directly to SQLite or via WAL files.
    """

    def __init__(self, repo: str | Path, *, use_wal: bool = False):
        self.data_dir = DataDir(Path(repo))
        holder = self.data_dir.read_lock()
        if (
            _holder_is_live(holder)
            and holder is not None
            and holder.get("mode") in ("server", "ui")
            and holder.get("host")
            and holder.get("port")
        ):
            raise _RepoServedByOtherError(holder)

        self._use_wal = use_wal
        self.blobs = BlobStore(self.data_dir.artifacts_dir)
        self.server_url = f"file://{self.data_dir.root}"
        self._closed = False

        if use_wal:
            # WAL mode: every write goes to the WAL; reads (read_columns) use
            # a read-only connection opened on first use.
            self.db = None  # type: ignore[assignment]
            self._ro_conn: sqlite3.Connection | None = None
            self._ro_lock = threading.Lock()
            self._wal_dir = self.data_dir.root / "wals"
            self._wal_dir.mkdir(parents=True, exist_ok=True)
            self._wal_path: Path | None = None
            self._lock_path: Path | None = None
            self._wal_fh: Any = None
            self._wal_seq = 0
        else:
            # Direct DB mode.
            self.db = Database.open(self.data_dir.db_path)

    # ---- WAL I/O (only used when use_wal=True) -------------------------------

    def _wal_write(self, op: str, payload: dict[str, Any]) -> int:
        self._wal_seq += 1
        entry = {"seq": self._wal_seq, "op": op, "payload": payload}
        line = json.dumps(entry, separators=(",", ":"))
        self._wal_fh.write(line + "\n")
        self._wal_fh.flush()
        os.fsync(self._wal_fh.fileno())
        return self._wal_seq

    # ---- synchronous reads ----------------------------------------------------

    def read_columns(self, sql: str, params: list[Any] | None = None) -> list[dict[str, Any]]:
        """Run a read query against the repo DB; rows as dicts.

        Direct mode reads through the transport's own connection. WAL mode
        never writes the DB, so it reads through a separate READ-ONLY
        connection (``mode=ro``) and sees only what the ingester has drained
        so far — this process's own un-drained WAL ops are not visible. A
        repo whose DB does not exist yet reads as empty.
        """
        if not self._use_wal:
            return self.db.read_columns(sql, params)
        with self._ro_lock:
            if self._ro_conn is None:
                path = self.data_dir.db_path
                if not path.exists():
                    return []
                self._ro_conn = sqlite3.connect(
                    f"{path.resolve().as_uri()}?mode=ro", uri=True,
                    check_same_thread=False, timeout=10.0,
                )
            cur = self._ro_conn.execute(sql, params or [])
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]

    # ---- lifecycle -----------------------------------------------------------

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._use_wal:
            if self._wal_fh:
                try:
                    self._wal_fh.close()
                except OSError:
                    pass
            if self._lock_path and self._lock_path.exists():
                self._lock_path.unlink(missing_ok=True)
            with self._ro_lock:
                if self._ro_conn is not None:
                    self._ro_conn.close()
                    self._ro_conn = None
        else:
            self.db.close()

    # ---- high-level ops ------------------------------------------------------

    def create_run(self, body: dict[str, Any]) -> dict[str, Any]:
        """Create a run from a create body (the ``POST /api/runs`` shape)."""
        fields = {k: body.get(k) for k in ingest_ops.CREATE_RUN_FIELDS}
        if not self._use_wal:
            return ingest_ops.create_run(self.db, project=body["project"], **fields)
        run_id = body["run_id"]
        project = body["project"]
        project_id = ingest_ops.slugify(project)
        self._open_run_wal(run_id)
        self._wal_write("create_run", {
            **fields,
            "project": project,
            "project_id": project_id,
            "created_at": fields["created_at"] or datetime.now(timezone.utc).isoformat(),
        })
        return {"run_id": run_id, "project_id": project_id, "url": f"/p/{project_id}/r/{run_id}"}

    def _open_run_wal(self, run_id: str) -> None:
        """Start (or, for a resumed run, continue) the run's WAL file."""
        self._wal_path = self._wal_dir / f"{run_id}.wal.jsonl"
        self._lock_path = self._wal_dir / f"{run_id}.lock"
        self._lock_path.write_text(str(os.getpid()))
        self._wal_fh = open(self._wal_path, "a")  # noqa: SIM115

    def _require_ingested(self, run_id: str) -> dict[str, Any]:
        """WAL mode: the run as the ingester has drained it so far."""
        rows = self.read_columns("SELECT * FROM runs WHERE id = ?", [run_id])
        if not rows:
            raise ingest_ops.RunNotFound(
                f"run {run_id} not found (in WAL mode a run must be ingested "
                "before it can be resumed or forked)"
            )
        return rows[0]

    def resume_run(self, run_id: str) -> dict[str, Any]:
        if not self._use_wal:
            return ingest_ops.resume_run(self.db, run_id)
        row = self._require_ingested(run_id)
        self._open_run_wal(run_id)
        self._wal_write("resume_run", {"run_id": run_id})
        return self._reopened(row)

    def rewind_run(self, run_id: str, step: int) -> dict[str, Any]:
        if not self._use_wal:
            return ingest_ops.rewind_run(self.db, run_id, step)
        row = self._require_ingested(run_id)
        self._open_run_wal(run_id)
        self._wal_write("rewind_run", {"run_id": run_id, "step": step})
        return self._reopened(row)

    @staticmethod
    def _reopened(row: dict[str, Any]) -> dict[str, Any]:
        pid, rid = row["project_id"], row["id"]
        return {
            "run_id": rid, "project_id": pid, "url": f"/p/{pid}/r/{rid}",
            "tags": json.loads(row["tags"]) if row.get("tags") else [],
        }

    def fork_run(
        self, parent_id: str, new_id: str, step: int, body: dict[str, Any],
    ) -> dict[str, Any]:
        """``body`` is the child's create body (the ``create_run`` shape)."""
        fields = {
            k: body.get(k) for k in ingest_ops.CREATE_RUN_FIELDS
            if k not in ("run_id", "parent_run_id", "fork_step")
        }
        if not self._use_wal:
            return ingest_ops.fork_run(
                self.db, parent_id=parent_id, step=step, run_id=new_id, **fields,
            )
        pid = self._require_ingested(parent_id)["project_id"]
        self._open_run_wal(new_id)
        self._wal_write("fork_run", {
            **fields, "parent_id": parent_id, "new_id": new_id, "step": step,
        })
        return {"run_id": new_id, "project_id": pid, "url": f"/p/{pid}/r/{new_id}"}

    def sequence_steps(self, run_id: str) -> list[dict[str, Any]]:
        """Each of the run's series as ``{name, context, max_step}``."""
        return self.read_columns(
            "SELECT name, context, MAX(step) AS max_step FROM sequences "
            "WHERE run_id = ? GROUP BY name, context_hash",
            [run_id],
        )

    def post_batch(self, run_id: str, points: list[dict[str, Any]]) -> bool:
        try:
            if self._use_wal:
                self._wal_write("batch", {"run_id": run_id, "points": points})
            else:
                ingest_ops.insert_batch(self.db, run_id, points)
            return True
        except Exception:  # noqa: BLE001
            log.exception("post_batch failed for run %s", run_id)
            return False

    def post_params(self, run_id: str, params: dict[str, Any]) -> None:
        if self._use_wal:
            self._wal_write("params", {"run_id": run_id, "params": params})
        else:
            ingest_ops.set_params(self.db, run_id, params)

    def post_summary(self, run_id: str, summary: dict[str, Any]) -> None:
        if self._use_wal:
            self._wal_write("summary", {"run_id": run_id, "summary": summary})
        else:
            ingest_ops.set_summary(self.db, run_id, summary)

    def post_logs(self, run_id: str, lines: list[dict[str, Any]]) -> bool:
        try:
            if self._use_wal:
                self._wal_write("logs", {"run_id": run_id, "lines": lines})
            else:
                ingest_ops.insert_logs(self.db, self.data_dir, run_id, lines)
            return True
        except Exception:  # noqa: BLE001
            log.exception("post_logs failed for run %s", run_id)
            return False

    def finish_run(
        self, run_id: str, status: str, exit_code: int | None = None,
        ended_at: str | None = None,
    ) -> None:
        if self._use_wal:
            ended_at = ended_at or datetime.now(timezone.utc).isoformat()
            self._wal_write("finish", {"run_id": run_id, "status": status, "exit_code": exit_code, "ended_at": ended_at})
        else:
            ingest_ops.finish_run(self.db, run_id, status, exit_code, ended_at)

    def set_tags(self, run_id: str, tags: list[str]) -> None:
        if self._use_wal:
            self._wal_write("set_tags", {"run_id": run_id, "tags": tags})
        else:
            ingest_ops.set_tags(self.db, run_id, tags)

    def set_notes(self, run_id: str, notes: str) -> None:
        if self._use_wal:
            self._wal_write("set_notes", {"run_id": run_id, "notes": notes})
        else:
            ingest_ops.set_notes(self.db, run_id, notes)

    def rename_run(self, run_id: str, name: str) -> None:
        if self._use_wal:
            self._wal_write("rename_run", {"run_id": run_id, "name": name})
        else:
            ingest_ops.rename_run(self.db, run_id, name)

    def delete_keys(self, run_id: str, table: str, keys: list[str]) -> None:
        if self._use_wal:
            self._wal_write("delete_keys", {"run_id": run_id, "table": table, "keys": keys})
        else:
            ingest_ops.delete_keys(self.db, run_id, table, keys)

    def alert(self, run_id: str, alert: dict[str, Any]) -> None:
        """``alert``: alert_id, title, text, level, created_at."""
        if self._use_wal:
            self._wal_write("alert", {"run_id": run_id, **alert})
        else:
            ingest_ops.insert_alert(
                self.db, run_id, alert["title"], alert.get("text", ""),
                alert.get("level", "info"),
                alert_id=alert["alert_id"], created_at=alert.get("created_at"),
            )

    def define_metric(
        self, run_id: str, name: str, step_metric: str | None, summary: str | None,
    ) -> None:
        if self._use_wal:
            self._wal_write("define_metric", {
                "run_id": run_id, "name": name, "step_metric": step_metric, "summary": summary,
            })
        else:
            ingest_ops.define_metric(self.db, run_id, name, step_metric, summary)

    def attach_artifact(self, run_id: str, name: str, digest: str, step: int | None = None) -> None:
        if self._use_wal:
            self._wal_write("attach_artifact", {"run_id": run_id, "name": name, "hash": digest, "step": step})
        else:
            ingest_ops.attach_artifact(self.db, self.blobs, run_id, name, digest, step)

    def upload_source(self, run_id: str, archive: bytes, manifest: dict[str, Any]) -> None:
        if self._use_wal:
            digest = hashlib.sha256(archive).hexdigest()
            self.blobs.put(archive, "application/zip", {"manifest": manifest})
            self._wal_write("source", {"run_id": run_id, "hash": digest, "manifest": manifest})
        else:
            ingest_ops.save_source(self.db, self.data_dir, run_id, archive, manifest)

    def upload_artifact(
        self,
        data: bytes,
        mime_type: str,
        metadata: dict[str, Any] | None = None,
        object_type: str | None = None,
    ) -> str:
        if self._use_wal:
            digest = hashlib.sha256(data).hexdigest()
            self.blobs.put(data, mime_type, metadata)
            self._wal_write("artifact_meta", {
                "hash": digest, "mime_type": mime_type,
                "size_bytes": len(data), "metadata": metadata or {},
                "object_type": object_type,
            })
            return digest
        else:
            result = ingest_ops.put_artifact(
                self.db, self.blobs, data, mime_type, metadata, object_type=object_type,
            )
            return result["hash"]

    def heartbeat(self, run_id: str) -> str | None:
        """Returns the run's ``stop_requested`` timestamp, if any."""
        if self._use_wal:
            now = datetime.now(timezone.utc).isoformat()
            self._wal_write("heartbeat", {"run_id": run_id, "wall_time": now})
            rows = self.read_columns("SELECT stop_requested FROM runs WHERE id = ?", [run_id])
            return rows[0]["stop_requested"] if rows else None
        return ingest_ops.heartbeat(self.db, run_id)

    # ---- versioned artifact registry ------------------------------------------

    def create_artifact_version(
        self,
        project_id: str,
        family_name: str,
        family_type: str,
        digest: str,
        size_bytes: int,
        metadata: dict[str, Any],
        created_by_run: str,
        aliases: list[str] | None,
    ) -> dict[str, Any]:
        """Ensure the artifact family exists and create a new version."""
        if self._use_wal:
            self._wal_write("create_artifact_version", {
                # Client-generated so replaying the WAL is idempotent.
                "version_id": secrets.token_hex(8),
                "project_id": project_id,
                "family_name": family_name,
                "family_type": family_type,
                "hash": digest,
                "size_bytes": size_bytes,
                "metadata": metadata,
                "created_by_run": created_by_run,
                "aliases": aliases or ["latest"],
            })
            # WAL mode can't return the full version info synchronously.
            return {}
        from ..server import artifact_registry_ops
        return artifact_registry_ops.create_artifact_version(
            self.db,
            project_id=project_id,
            family_name=family_name,
            family_type=family_type,
            digest=digest,
            size_bytes=size_bytes,
            metadata=metadata,
            created_by_run=created_by_run,
            aliases=aliases or ["latest"],
        )

    def resolve_artifact(self, project_id: str, ref: str) -> dict[str, Any]:
        """Resolve ``"name:alias"`` or ``"name:vN"`` to a version dict."""
        if self._use_wal:
            raise RuntimeError("resolve_artifact is not supported in WAL mode")
        from ..server import artifact_registry_ops
        return artifact_registry_ops.resolve_ref(self.db, project_id, ref)

    def record_artifact_input(self, run_id: str, artifact_version_id: str, role: str) -> None:
        """Record that a run consumed an artifact version."""
        if self._use_wal:
            self._wal_write("record_artifact_input", {
                "run_id": run_id,
                "artifact_version_id": artifact_version_id,
                "role": role,
            })
        else:
            from ..server import artifact_registry_ops
            artifact_registry_ops.record_input(
                self.db, run_id=run_id, artifact_version_id=artifact_version_id, role=role,
            )

    # ---- sweeps (direct mode only: a trial claim needs an answer now) ---------

    def _sweep_db(self) -> Database:
        if self._use_wal:
            raise RuntimeError(
                "sweeps need a server or a direct-mode repo: WAL mode never writes the "
                "database, so it cannot claim trials. Drop local_wal=True, or start "
                "`cairn server` on the repo."
            )
        return self.db

    def create_sweep(self, body: dict[str, Any]) -> dict[str, Any]:
        from ..server import sweep_ops
        body = dict(body)
        return sweep_ops.create_sweep(self._sweep_db(), space=body.pop("parameters"), **body)

    def list_sweeps(self, project: str | None = None) -> list[dict[str, Any]]:
        from ..server import sweep_ops
        from ..server.routes._common import slugify
        return sweep_ops.list_sweeps(self._sweep_db(), slugify(project) if project else None)

    def get_sweep(self, sweep_id: str) -> dict[str, Any]:
        from ..server import sweep_ops
        return sweep_ops.get_sweep(self._sweep_db(), sweep_id)

    def sweep_action(self, sweep_id: str, action: str) -> dict[str, Any]:
        from ..server import sweep_ops
        return sweep_ops.set_status(self._sweep_db(), sweep_id, action)

    def next_trial(self, sweep_id: str) -> dict[str, Any]:
        from ..server import sweep_ops
        return sweep_ops.next_trial(self._sweep_db(), sweep_id)

    def report_trial(self, sweep_id: str, trial_id: str, **body: Any) -> dict[str, Any]:
        from ..server import sweep_ops
        return sweep_ops.report_trial(self._sweep_db(), sweep_id, trial_id, **body)

    def download_artifact_bytes(self, digest: str) -> bytes:
        """Download raw artifact bytes by hash from the local blob store."""
        data, _ = self.blobs.get(digest)
        return data

    def drain_spill(self, run_id: str | None = None) -> int:
        """Local mode never spills; nothing to drain."""
        return 0
