"""0.5 run logs (``<repo>/wals/<run_id>.wal.jsonl``), written by hand for the
server's legacy-import tests: 0.6 clients no longer write them."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class LegacyLog:
    """Appends 0.5 log records ``{"seq", "op", "payload"}`` to a run's log."""

    def __init__(self, repo: str | Path, run_id: str, label: str | None = None) -> None:
        self.repo = Path(repo)
        self.run_id = run_id
        wals = self.repo / "wals"
        wals.mkdir(parents=True, exist_ok=True)
        name = run_id if label is None else f"{run_id}~{label}"
        self.path = wals / f"{name}.wal.jsonl"
        self.seq = 0

    def write(self, op: str, payload: dict[str, Any]) -> None:
        self.seq += 1
        with open(self.path, "a") as fh:
            fh.write(json.dumps({"seq": self.seq, "op": op, "payload": payload}) + "\n")

    def create(self, project: str = "p", **fields: Any) -> None:
        from cairn.server.ingest_ops import slugify

        self.write("create_run", {
            "run_id": self.run_id, "project": project, "project_id": slugify(project),
            "created_at": datetime.now(timezone.utc).isoformat(), **fields,
        })

    def finish(self, status: str = "completed", exit_code: int | None = None) -> None:
        self.write("finish", {"run_id": self.run_id, "status": status, "exit_code": exit_code,
                              "ended_at": datetime.now(timezone.utc).isoformat()})

    def blob(self, data: bytes, mime: str = "application/octet-stream") -> str:
        from cairn.server.storage.blobs import BlobStore
        from cairn.server.storage.datadir import DataDir

        digest, _ = BlobStore(DataDir(self.repo).artifacts_dir).put(data)
        self.write("artifact_meta", {"hash": digest, "mime_type": mime, "size_bytes": len(data),
                                     "metadata": {}, "object_type": None})
        return digest
