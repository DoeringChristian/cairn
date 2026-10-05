"""Write-Ahead Log for HTTP transport resilience.

Every SDK event (batch, artifact, param, log, finish) is written to a local
append-only JSONL file BEFORE being sent to the server. On disconnect, events
accumulate. On reconnect (or at ``run.finish()``), the backlog is replayed
in order.

WAL file per run: ``{wal_dir}/{run_id}.wal.jsonl``
Checkpoint file:  ``{wal_dir}/{run_id}.checkpoint``

Line 1 is a HEADER record: {"seq": 0, "op": "header", "payload":
{"epoch": <hex>, "target": <server-url>, "created": <iso>}} — ``epoch`` is
minted per WAL file so sequence numbers can never alias across file
recreations (the (run_id, epoch, seq) idempotency key), and ``target``
records where this log replays (the ``cairn sync`` scanner needs no other
context). Subsequent lines:
    {"seq": N, "op": "batch"|"artifact"|"params"|"summary"|"logs"|..., "payload": {...}}

ACK DISCIPLINE (fixes a silent-loss bug): the checkpoint is a
CONTIGUOUS low-water mark plus the set of individually-acked seqs above it
(JSON {"low": N, "acked": [...]}). ``ack(seq)`` records a successful send; the low
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
import threading
import uuid
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


def _seq_of(line: bytes) -> int | None:
    """The ``seq`` of an entry line as ``append`` writes it (``{"seq":N,...``),
    read without parsing the rest; None for any other shape."""
    if not line.startswith(b'{"seq":'):
        return None
    end = line.find(b",", 7)
    try:
        return int(line[7:end])
    except ValueError:
        return None


def dead_letter_path(wal_dir: Path, run_id: str) -> Path:
    """Where ``WriteAheadLog.dead_letter`` keeps a run's rejected ops."""
    return wal_dir / f"{run_id}.dead.jsonl"


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
        # The run's flush threads (metrics, logs), its heartbeat and the
        # training thread all append and ack.
        self._lock = threading.RLock()
        # Byte offset of each entry appended by this process: ``pending()``
        # seeks past the delivered prefix instead of re-reading the file.
        self._offsets: dict[int, int] = {}
        self._seq = self._read_last_seq()
        self._fh = open(self._wal_path, "a")  # noqa: SIM115
        self.epoch, self.target = self._read_or_write_header(target)

    def _read_or_write_header(self, target: str | None) -> tuple[str, str | None]:
        """Read the header record, writing one first on a fresh file."""
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
        with self._lock:
            self._seq += 1
            entry = {"seq": self._seq, "op": op, "payload": payload}
            line = json.dumps(entry, separators=(",", ":"))
            self._offsets[self._seq] = self._fh.tell()
            self._fh.write(line + "\n")
            self._fh.flush()
            os.fsync(self._fh.fileno())
            return self._seq

    def append_artifact(
        self, data: bytes, mime_type: str, metadata: dict[str, Any] | None,
        object_type: str | None = None,
    ) -> int:
        """Write an artifact entry (see ``artifact_payload``)."""
        return self.append(
            "artifact", self.artifact_payload(data, mime_type, metadata, object_type),
        )

    def artifact_payload(
        self, data: bytes, mime_type: str, metadata: dict[str, Any] | None,
        object_type: str | None = None,
    ) -> dict[str, Any]:
        """An artifact entry's payload. Small artifacts are inlined as base64;
        large ones are written to a file beside the log, referenced by path."""
        payload: dict[str, Any] = {"mime_type": mime_type, "metadata": metadata or {}}
        if object_type:
            payload["object_type"] = object_type
        if len(data) <= INLINE_ARTIFACT_MAX:
            payload["data_b64"] = base64.b64encode(data).decode("ascii")
        else:
            temp_path = self.wal_dir / f"{self.run_id}.artifact.{uuid.uuid4().hex}.bin"
            temp_path.write_bytes(data)
            payload["data_file"] = str(temp_path)
        return payload

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
        """Record a successful send of ``seq``.

        The low water advances only over CONTIGUOUS acks — a failed earlier
        op keeps everything behind it pending, so it can never be shadowed.
        """
        with self._lock:
            low, acked = self._read_ack_state()
            if seq <= low:
                return
            acked.add(seq)
            while (low + 1) in acked:
                low += 1
                acked.discard(low)
            self._write_ack_state(low, acked)

    def pending(self) -> Iterator[WALEntry]:
        """Yield all UNACKED entries (above the low water, minus the acked
        set), in order."""
        cp, acked = self._read_ack_state()
        try:
            with open(self._wal_path, "rb") as f:
                start = self._offsets.get(cp + 1)
                if start is not None:
                    f.seek(start)
                for raw_line in f:
                    line = raw_line.strip()
                    if not line:
                        continue
                    seq = _seq_of(line)
                    if seq is not None and (seq <= cp or seq in acked):
                        continue  # delivered: skip without parsing the payload
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

    @property
    def dead_letter_path(self) -> Path:
        return dead_letter_path(self.wal_dir, self.run_id)

    def dead_letter(self, entry: WALEntry, reason: str) -> None:
        """Move an entry the server REJECTED (a 4xx: resending cannot help)
        out of the replay queue, into ``{run_id}.dead.jsonl`` beside the log,
        so the ops behind it are not blocked. The file is kept (``cleanup``
        leaves it; ``cairn sync`` lists it): the data is set aside, not lost.
        """
        with self._lock:
            payload = dict(entry.payload)
            data_file = payload.get("data_file")
            if data_file:  # an artifact too large to inline: keep its bytes
                kept = self.wal_dir / f"{self.run_id}.dead.{entry.seq}.bin"
                try:
                    Path(data_file).replace(kept)
                    payload["data_file"] = str(kept)
                except OSError:
                    pass
            rec = {"seq": entry.seq, "op": entry.op, "reason": reason, "payload": payload}
            with open(self.dead_letter_path, "a") as f:
                f.write(json.dumps(rec, separators=(",", ":")) + "\n")
                f.flush()
                os.fsync(f.fileno())
            self.ack(entry.seq)

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
