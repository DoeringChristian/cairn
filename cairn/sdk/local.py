"""WAL-based transport for server-less SDK use.

When a ``Run`` is constructed with ``repo=`` pointing at a ``.cairn/``
directory, it uses ``LocalTransport`` instead of the HTTP ``Transport``.

Writers NEVER touch the SQLite database. All data goes to:
- ``.cairn/wals/{run_id}.wal.jsonl``  — append-only JSONL per run
- ``.cairn/artifacts/``               — content-addressed blobs

The UI server (or ``cairn.Reader``) is the sole database writer,
draining WAL files into SQLite via the ingestion thread.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psutil

from ..server.storage.blobs import BlobStore
from ..server.storage.datadir import DataDir

log = logging.getLogger(__name__)

# Max artifact size to inline in WAL (base64). Larger → temp file alongside WAL.
_INLINE_ARTIFACT_MAX = 1 * 1024 * 1024  # 1 MB


class _RepoServedByOtherError(Exception):
    """Internal signal: a server is already serving this repo.

    Carries the lock-file ``holder`` dict so the Run constructor can
    extract ``host``/``port`` and connect over HTTP.
    """

    def __init__(self, holder: dict[str, Any]):
        self.holder = holder
        super().__init__(
            f"repo is being served by {holder.get('mode')!r} on "
            f"{holder.get('host')!r}:{holder.get('port')!r}"
        )


def _holder_is_live(holder: dict[str, Any] | None) -> bool:
    """True if ``holder`` contains an alive PID."""
    if not holder:
        return False
    pid = holder.get("pid")
    return isinstance(pid, int) and psutil.pid_exists(pid)


class LocalTransport:
    """Mirrors the public surface of ``cairn.sdk.transport.Transport`` but
    writes to per-run WAL files instead of the database.

    The SDK never opens or touches the SQLite database.
    """

    def __init__(self, repo: str | Path):
        self.data_dir = DataDir(Path(repo))
        holder = self.data_dir.read_lock()
        # If a server is serving this repo, switch to HTTP mode.
        if (
            _holder_is_live(holder)
            and holder is not None
            and holder.get("mode") == "server"
            and holder.get("host")
            and holder.get("port")
        ):
            raise _RepoServedByOtherError(holder)
        self.blobs = BlobStore(self.data_dir.artifacts_dir)
        self.server_url = f"file://{self.data_dir.root}"
        self._closed = False

        # WAL state — initialized by create_run().
        self._wal_dir = self.data_dir.root / "wals"
        self._wal_dir.mkdir(parents=True, exist_ok=True)
        self._wal_path: Path | None = None
        self._lock_path: Path | None = None
        self._wal_fh: Any = None
        self._wal_seq = 0

    # ---- WAL I/O -------------------------------------------------------------

    def _wal_write(self, op: str, payload: dict[str, Any]) -> int:
        """Append one entry to the per-run WAL. Returns sequence number."""
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
        if self._wal_fh:
            try:
                self._wal_fh.close()
            except OSError:
                pass
        # Remove lock file — signals to server that this WAL is ready.
        if self._lock_path and self._lock_path.exists():
            self._lock_path.unlink(missing_ok=True)

    # ---- high-level ops (mirror Transport) -----------------------------------

    def create_run(self, body: dict[str, Any]) -> dict[str, Any]:
        run_id = body["run_id"]
        project = body["project"]
        project_id = project.lower().replace(" ", "-")

        self._wal_path = self._wal_dir / f"{run_id}.wal.jsonl"
        self._lock_path = self._wal_dir / f"{run_id}.lock"

        # Create lock file to signal "still writing".
        self._lock_path.write_text(str(os.getpid()))

        # Open WAL for append.
        self._wal_fh = open(self._wal_path, "a")  # noqa: SIM115

        now = datetime.now(timezone.utc).isoformat()
        self._wal_write("create_run", {
            "run_id": run_id,
            "project": project,
            "project_id": project_id,
            "name": body.get("name"),
            "tags": body.get("tags"),
            "notes": body.get("notes"),
            "env": body.get("env"),
            "git": body.get("git"),
            "cli_args": body.get("cli_args"),
            "hostname": body.get("hostname"),
            "user": body.get("user"),
            "created_at": now,
        })

        return {
            "run_id": run_id,
            "project_id": project_id,
            "url": f"/p/{project_id}/r/{run_id}",
        }

    def post_batch(self, run_id: str, points: list[dict[str, Any]]) -> bool:
        try:
            self._wal_write("batch", {"run_id": run_id, "points": points})
            return True
        except Exception:  # noqa: BLE001
            log.exception("WAL write failed for run %s", run_id)
            return False

    def post_params(self, run_id: str, params: dict[str, Any]) -> None:
        self._wal_write("params", {"run_id": run_id, "params": params})

    def post_logs(self, run_id: str, lines: list[dict[str, Any]]) -> bool:
        try:
            self._wal_write("logs", {"run_id": run_id, "lines": lines})
            return True
        except Exception:  # noqa: BLE001
            log.exception("WAL write failed for run %s", run_id)
            return False

    def finish_run(
        self, run_id: str, status: str, exit_code: int | None = None
    ) -> None:
        now = datetime.now(timezone.utc).isoformat()
        self._wal_write("finish", {
            "run_id": run_id,
            "status": status,
            "exit_code": exit_code,
            "ended_at": now,
        })

    def set_tags(self, run_id: str, tags: list[str]) -> None:
        self._wal_write("set_tags", {"run_id": run_id, "tags": tags})

    def set_notes(self, run_id: str, notes: str) -> None:
        self._wal_write("set_notes", {"run_id": run_id, "notes": notes})

    def attach_artifact(
        self, run_id: str, name: str, digest: str, step: int | None = None
    ) -> None:
        self._wal_write("attach_artifact", {
            "run_id": run_id, "name": name, "hash": digest, "step": step,
        })

    def upload_source(
        self, run_id: str, archive: bytes, manifest: dict[str, Any]
    ) -> None:
        # Store archive as a blob, record in WAL.
        digest = hashlib.sha256(archive).hexdigest()
        self.blobs.put(archive, "application/zip", {"manifest": manifest})
        self._wal_write("source", {
            "run_id": run_id, "hash": digest, "manifest": manifest,
        })

    def upload_artifact(
        self,
        data: bytes,
        mime_type: str,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        # Blobs go to shared content-addressed store (NFS-safe atomic rename).
        digest = hashlib.sha256(data).hexdigest()
        self.blobs.put(data, mime_type, metadata)
        # Record artifact metadata in WAL so ingestion can create the DB row.
        if len(data) <= _INLINE_ARTIFACT_MAX:
            self._wal_write("artifact_meta", {
                "hash": digest,
                "mime_type": mime_type,
                "size_bytes": len(data),
                "metadata": metadata or {},
            })
        else:
            self._wal_write("artifact_meta", {
                "hash": digest,
                "mime_type": mime_type,
                "size_bytes": len(data),
                "metadata": metadata or {},
            })
        return digest

    def heartbeat(self, run_id: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        self._wal_write("heartbeat", {"run_id": run_id, "wall_time": now})

    def drain_spill(self, run_id: str | None = None) -> int:
        """Local WAL mode never spills; nothing to drain."""
        return 0
