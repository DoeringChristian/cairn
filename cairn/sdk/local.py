"""Direct-to-DuckDB transport for server-less SDK use.

When a ``Run`` is constructed with ``repo=`` pointing at a ``.cairn/``
directory, it uses ``LocalTransport`` instead of the HTTP ``Transport``.
Writes go straight to the DuckDB file and blob store in that directory.

The repo-level write lock (``DataDir.acquire_lock("sdk")``) is held for the
lifetime of this transport. A running ``cairn server`` on the same repo will
refuse to start (and vice versa), preserving DuckDB's single-writer invariant.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from ..server import ingest_ops
from ..server.storage.blobs import BlobStore
from ..server.storage.datadir import DataDir
from ..server.storage.db import Database

log = logging.getLogger(__name__)


class LocalTransport:
    """Mirrors the public surface of ``cairn.sdk.transport.Transport`` but
    writes directly to the on-disk repo instead of going over HTTP.
    """

    def __init__(self, repo: str | Path):
        self.data_dir = DataDir(Path(repo))
        self.data_dir.acquire_lock("sdk")
        try:
            self.db = Database.open(self.data_dir.db_path)
        except Exception:
            # Never leak the lock if DB open fails.
            self.data_dir.release_lock()
            raise
        self.blobs = BlobStore(self.data_dir.artifacts_dir)
        # ``Run.url`` references this; local runs use a ``file://`` scheme so
        # printing it isn't misleading about the transport.
        self.server_url = f"file://{self.data_dir.root}"
        self._closed = False

    # ---- lifecycle --------------------------------------------------------

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            self.db.close()
        finally:
            self.data_dir.release_lock()

    # ---- high-level ops (mirror Transport) --------------------------------

    def create_run(self, body: dict[str, Any]) -> dict[str, Any]:
        return ingest_ops.create_run(
            self.db,
            project=body["project"],
            task=body["task"],
            name=body.get("name"),
            tags=body.get("tags"),
            notes=body.get("notes"),
            env=body.get("env"),
            git=body.get("git"),
            cli_args=body.get("cli_args"),
            hostname=body.get("hostname"),
            user=body.get("user"),
        )

    def post_batch(self, run_id: str, points: list[dict[str, Any]]) -> bool:
        try:
            ingest_ops.insert_batch(self.db, run_id, points)
            return True
        except Exception:  # noqa: BLE001
            log.exception("local insert_batch failed for run %s", run_id)
            return False

    def post_params(self, run_id: str, params: dict[str, Any]) -> None:
        ingest_ops.set_params(self.db, run_id, params)

    def post_logs(self, run_id: str, lines: list[dict[str, Any]]) -> bool:
        try:
            ingest_ops.insert_logs(self.db, self.data_dir, run_id, lines)
            return True
        except Exception:  # noqa: BLE001
            log.exception("local insert_logs failed for run %s", run_id)
            return False

    def finish_run(
        self, run_id: str, status: str, exit_code: int | None = None
    ) -> None:
        ingest_ops.finish_run(self.db, run_id, status, exit_code)

    def set_tags(self, run_id: str, tags: list[str]) -> None:
        ingest_ops.set_tags(self.db, run_id, tags)

    def set_notes(self, run_id: str, notes: str) -> None:
        ingest_ops.set_notes(self.db, run_id, notes)

    def attach_artifact(
        self, run_id: str, name: str, digest: str, step: int | None = None
    ) -> None:
        ingest_ops.attach_artifact(self.db, self.blobs, run_id, name, digest, step)

    def upload_source(
        self, run_id: str, archive: bytes, manifest: dict[str, Any]
    ) -> None:
        ingest_ops.save_source(self.db, self.data_dir, run_id, archive, manifest)

    def upload_artifact(
        self,
        data: bytes,
        mime_type: str,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        """Put the blob; return its sha256 digest. Local writes are always
        successful (or raise), so no HEAD probe is needed — blobs.put is
        already idempotent on duplicate bytes.
        """
        result = ingest_ops.put_artifact(self.db, self.blobs, data, mime_type, metadata)
        return result["hash"]

    def drain_spill(self, run_id: str | None = None) -> int:
        """Local mode never spills; nothing to drain."""
        return 0
