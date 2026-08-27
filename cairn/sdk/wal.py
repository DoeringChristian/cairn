"""Write-Ahead Log for HTTP transport resilience.

Every SDK event (batch, artifact, param, log, finish) is written to a local
append-only JSONL file BEFORE being sent to the server. On disconnect, events
accumulate. On reconnect (or at ``run.finish()``), the backlog is replayed
in order.

WAL file per run: ``{wal_dir}/{run_id}.wal.jsonl``
Checkpoint file:  ``{wal_dir}/{run_id}.checkpoint``

Line 1 is a HEADER record (R3): {"seq": 0, "op": "header", "payload":
{"epoch": <hex>, "target": <server-url>, "created": <iso>}} — ``epoch`` is
minted per WAL file so sequence numbers can never alias across file
recreations (the (run_id, epoch, seq) idempotency key), and ``target``
records where this log replays (the ``cairn sync`` scanner needs no other
context). Subsequent lines:
    {"seq": N, "op": "batch"|"artifact"|"params"|"logs"|..., "payload": {...}}

ACK DISCIPLINE (R3 — fixes the silent-loss bug): the checkpoint is a
CONTIGUOUS low-water mark plus the set of individually-acked seqs above it
(JSON {"low": N, "acked": [...]}; a bare integer is read as {"low": N} for
backward compatibility). ``ack(seq)`` records a successful send; the low
water only advances over contiguous acks, so a FAILED op can never be
shadowed by a later success — it stays pending and replays.

``CAIRN_WAL_DIR`` overrides the log location (HPC: point at node-local
scratch).
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
    env = os.environ.get("CAIRN_WAL_DIR")
    if env:
        return Path(env)
    return Path(platformdirs.user_cache_dir("cairn")) / "wal"


@dataclass
class WALEntry:
    seq: int
    op: str
    payload: dict[str, Any]


class WriteAheadLog:
    """Append-only JSONL log with checkpoint-based replay."""

    def __init__(
        self, run_id: str, wal_dir: Path | None = None, *, target: str | None = None
    ):
        self.run_id = run_id
        self.wal_dir = wal_dir or default_wal_dir()
        self.wal_dir.mkdir(parents=True, exist_ok=True)
        self._wal_path = self.wal_dir / f"{run_id}.wal.jsonl"
        self._checkpoint_path = self.wal_dir / f"{run_id}.checkpoint"
        self._seq = self._read_last_seq()
        self._fh = open(self._wal_path, "a")  # noqa: SIM115
        self.epoch, self.target = self._read_or_write_header(target)

    def _read_or_write_header(self, target: str | None) -> tuple[str, str | None]:
        """Read the header record, writing one first on a fresh file (R3)."""
        import secrets
        from datetime import datetime, timezone

        try:
            with open(self._wal_path) as f:
                first = f.readline().strip()
            if first:
                rec = json.loads(first)
                if rec.get("op") == "header":
                    pl = rec.get("payload", {})
                    return pl.get("epoch", ""), pl.get("target") or target
        except (OSError, json.JSONDecodeError):
            pass
        if self._seq == 0:
            epoch = secrets.token_hex(8)
            rec = {"seq": 0, "op": "header", "payload": {
                "epoch": epoch,
                "target": target,
                "created": datetime.now(timezone.utc).isoformat(),
            }}
            self._fh.write(json.dumps(rec, separators=(",", ":")) + "\n")
            self._fh.flush()
            os.fsync(self._fh.fileno())
            return epoch, target
        return "", target  # legacy headerless file mid-stream

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

    def _read_ack_state(self) -> tuple[int, set[int]]:
        try:
            raw = self._checkpoint_path.read_text().strip()
        except OSError:
            return 0, set()
        if not raw:
            return 0, set()
        try:
            obj = json.loads(raw)
        except json.JSONDecodeError:
            return 0, set()
        if isinstance(obj, int):  # legacy bare-int checkpoint
            return obj, set()
        return int(obj.get("low", 0)), set(obj.get("acked", []))

    def _write_ack_state(self, low: int, acked: set[int]) -> None:
        self._checkpoint_path.write_text(
            json.dumps({"low": low, "acked": sorted(acked)})
        )

    def read_checkpoint(self) -> int:
        """The contiguous low-water mark (every seq <= this is delivered)."""
        low, _ = self._read_ack_state()
        return low

    def ack(self, seq: int) -> None:
        """Record a successful send of ``seq`` (R3 ack discipline).

        The low water advances only over CONTIGUOUS acks — a failed earlier
        op keeps everything behind it pending, so it can never be shadowed.
        """
        low, acked = self._read_ack_state()
        if seq <= low:
            return
        acked.add(seq)
        while (low + 1) in acked:
            low += 1
            acked.discard(low)
        self._write_ack_state(low, acked)

    def checkpoint(self, seq: int) -> None:
        """DEPRECATED alias of :meth:`ack` (kept for one release)."""
        self.ack(seq)

    def pending(self) -> Iterator[WALEntry]:
        """Yield all UNACKED entries (above the low water, minus the acked
        set), in order."""
        cp, acked = self._read_ack_state()
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
                    if seq <= cp or seq in acked or raw.get("op") == "header":
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
        """True if any entry is not yet acked."""
        cp, acked = self._read_ack_state()
        return self._seq > cp and any(True for _ in self.pending())
