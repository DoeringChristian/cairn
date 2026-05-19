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
            and holder.get("mode") == "server"
            and holder.get("host")
            and holder.get("port")
        ):
            raise _RepoServedByOtherError(holder)

        self._use_wal = use_wal
        self.blobs = BlobStore(self.data_dir.artifacts_dir)
        self.server_url = f"file://{self.data_dir.root}"
        self._closed = False

        if use_wal:
            # WAL mode: no DB access.
            self.db = None  # type: ignore[assignment]
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
        else:
            self.db.close()

    # ---- high-level ops ------------------------------------------------------

    def create_run(self, body: dict[str, Any]) -> dict[str, Any]:
        if self._use_wal:
            run_id = body["run_id"]
            project = body["project"]
            project_id = project.lower().replace(" ", "-")
            self._wal_path = self._wal_dir / f"{run_id}.wal.jsonl"
            self._lock_path = self._wal_dir / f"{run_id}.lock"
            self._lock_path.write_text(str(os.getpid()))
            self._wal_fh = open(self._wal_path, "a")  # noqa: SIM115
            now = datetime.now(timezone.utc).isoformat()
            self._wal_write("create_run", {
                "run_id": run_id, "project": project, "project_id": project_id,
                "name": body.get("name"), "tags": body.get("tags"),
                "notes": body.get("notes"), "env": body.get("env"),
                "git": body.get("git"), "cli_args": body.get("cli_args"),
                "hostname": body.get("hostname"), "user": body.get("user"),
                "created_at": now,
            })
            return {"run_id": run_id, "project_id": project_id, "url": f"/p/{project_id}/r/{run_id}"}
        else:
            return ingest_ops.create_run(
                self.db, project=body["project"], run_id=body.get("run_id"),
                name=body.get("name"), tags=body.get("tags"),
                notes=body.get("notes"), env=body.get("env"),
                git=body.get("git"), cli_args=body.get("cli_args"),
                hostname=body.get("hostname"), user=body.get("user"),
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

    def finish_run(self, run_id: str, status: str, exit_code: int | None = None) -> None:
        if self._use_wal:
            now = datetime.now(timezone.utc).isoformat()
            self._wal_write("finish", {"run_id": run_id, "status": status, "exit_code": exit_code, "ended_at": now})
        else:
            ingest_ops.finish_run(self.db, run_id, status, exit_code)

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

    def heartbeat(self, run_id: str) -> None:
        if self._use_wal:
            now = datetime.now(timezone.utc).isoformat()
            self._wal_write("heartbeat", {"run_id": run_id, "wall_time": now})
        else:
            ingest_ops.heartbeat(self.db, run_id)

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

    def download_artifact_bytes(self, digest: str) -> bytes:
        """Download raw artifact bytes by hash from the local blob store."""
        data, _ = self.blobs.get(digest)
        return data

    def drain_spill(self, run_id: str | None = None) -> int:
        """Local mode never spills; nothing to drain."""
        return 0
