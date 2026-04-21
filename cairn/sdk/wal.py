"""Write-Ahead Log for HTTP transport resilience.

Every SDK event (batch, artifact, param, log, finish) is written to a local
append-only JSONL file BEFORE being sent to the server. On disconnect, events
accumulate. On reconnect (or at ``run.finish()``), the backlog is replayed
in order.

WAL file per run: ``{wal_dir}/{run_id}.wal.jsonl``
Checkpoint file:  ``{wal_dir}/{run_id}.checkpoint``

Each line:
    {"seq": N, "op": "batch"|"artifact"|"params"|"logs"|"finish", "payload": {...}}

The checkpoint records the last successfully sent sequence number. On drain,
entries from checkpoint+1 to EOF are replayed.
"""

from __future__ import annotations

import base64
import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator

import platformdirs

log = logging.getLogger(__name__)

# Max artifact size to inline in WAL (base64). Larger → temp file.
INLINE_ARTIFACT_MAX = 1 * 1024 * 1024  # 1 MB


def default_wal_dir() -> Path:
    return Path(platformdirs.user_cache_dir("cairn")) / "wal"


@dataclass
class WALEntry:
    seq: int
    op: str
    payload: dict[str, Any]


class WriteAheadLog:
    """Append-only JSONL log with checkpoint-based replay."""

    def __init__(self, run_id: str, wal_dir: Path | None = None):
        self.run_id = run_id
        self.wal_dir = wal_dir or default_wal_dir()
        self.wal_dir.mkdir(parents=True, exist_ok=True)
        self._wal_path = self.wal_dir / f"{run_id}.wal.jsonl"
        self._checkpoint_path = self.wal_dir / f"{run_id}.checkpoint"
        self._seq = self._read_last_seq()
        self._fh = open(self._wal_path, "a")  # noqa: SIM115

    def _read_last_seq(self) -> int:
        """Read the highest seq from the WAL file, or 0 if empty."""
        if not self._wal_path.exists():
            return 0
        last = 0
        try:
            with open(self._wal_path) as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                        last = max(last, entry.get("seq", 0))
                    except json.JSONDecodeError:
                        continue
        except OSError:
            pass
        return last

    def append(self, op: str, payload: dict[str, Any]) -> int:
        """Write one entry to the WAL. Returns the sequence number."""
        self._seq += 1
        entry = {"seq": self._seq, "op": op, "payload": payload}
        line = json.dumps(entry, separators=(",", ":"))
        self._fh.write(line + "\n")
        self._fh.flush()
        os.fsync(self._fh.fileno())
        return self._seq

    def append_artifact(
        self, data: bytes, mime_type: str, metadata: dict[str, Any] | None
    ) -> int:
        """Write an artifact entry. Small artifacts are inlined as base64;
        large ones are written to a temp file referenced by path."""
        if len(data) <= INLINE_ARTIFACT_MAX:
            payload = {
                "data_b64": base64.b64encode(data).decode("ascii"),
                "mime_type": mime_type,
                "metadata": metadata or {},
            }
        else:
            # Write to temp file in WAL dir
            temp_path = self.wal_dir / f"{self.run_id}.artifact.{self._seq + 1}.bin"
            temp_path.write_bytes(data)
            payload = {
                "data_file": str(temp_path),
                "mime_type": mime_type,
                "metadata": metadata or {},
            }
        return self.append("artifact", payload)

    def read_checkpoint(self) -> int:
        """Return the last checkpointed seq, or 0."""
        try:
            return int(self._checkpoint_path.read_text().strip())
        except (OSError, ValueError):
            return 0

    def checkpoint(self, seq: int) -> None:
        """Record that all entries up to ``seq`` have been successfully sent."""
        self._checkpoint_path.write_text(str(seq))

    def pending(self) -> Iterator[WALEntry]:
        """Yield all entries after the checkpoint."""
        cp = self.read_checkpoint()
        try:
            with open(self._wal_path) as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        raw = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    seq = raw.get("seq", 0)
                    if seq <= cp:
                        continue
                    yield WALEntry(
                        seq=seq, op=raw.get("op", ""), payload=raw.get("payload", {})
                    )
        except OSError:
            return

    def close(self) -> None:
        """Close the WAL file handle."""
        try:
            self._fh.close()
        except OSError:
            pass

    def cleanup(self) -> None:
        """Remove WAL and checkpoint files (call after successful drain)."""
        self.close()
        self._wal_path.unlink(missing_ok=True)
        self._checkpoint_path.unlink(missing_ok=True)
        # Clean up any temp artifact files
        for f in self.wal_dir.glob(f"{self.run_id}.artifact.*.bin"):
            f.unlink(missing_ok=True)
        # Remove WAL dir if empty
        try:
            if not any(self.wal_dir.iterdir()):
                self.wal_dir.rmdir()
        except OSError:
            pass

    @property
    def has_pending(self) -> bool:
        """True if there are entries that haven't been checkpointed."""
        cp = self.read_checkpoint()
        return self._seq > cp
