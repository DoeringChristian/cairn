"""Uploading run directories: the code shared by the daemon and ``cairn sync``.

For each log of a run directory: learn the server's ``applied_seq`` (once per
session, so a restart after a kill -9 resumes exactly), read the records
after it, make sure the server holds every blob they reference, POST them,
and record the server's answer in the log's ``acked`` file. The server
applies a record once, by (run, log, seq), so resending is always safe.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..sdk.runlog.codec import record_blobs
from ..sdk.runlog.log import LogReader
from ..sdk.runlog.rundir import LogRef, RunDir
from .client import MAX_BODY, Gap, IngestClient, UploadError

log = logging.getLogger(__name__)


class LogSync:
    """The upload state of one log (kept across rounds by the daemon)."""

    def __init__(self, ref: LogRef) -> None:
        self.ref = ref
        self.reader = LogReader(ref.log_dir)
        #: The server's applied_seq as last answered; None: ask first.
        self.applied: int | None = None
        #: Payload bytes per batch (halved by a 413).
        self.max_bytes = MAX_BODY

    def step(self, client: IngestClient, run_id: str, *, max_bytes: int | None = None) -> int:
        """Upload one batch; returns the number of records the server newly
        confirmed (0: nothing to send).

        Raises:
            UploadError: The attempt failed (retry later).
        """
        for _attempt in range(3):
            try:
                return self._step(client, run_id, min(max_bytes or self.max_bytes, self.max_bytes))
            except Gap as gap:
                if gap.missing_blobs:
                    # The server lacks blobs it needs first (maybe collected
                    # since we saw them): send them, then the batch again.
                    for digest in gap.missing_blobs:
                        client.known_blobs.discard(digest)
                        if not client.ensure_blob(digest, self.ref.run_dir.blobs_dir / digest):
                            raise UploadError(
                                f"the server needs blob {digest}, which is missing from "
                                f"{self.ref.run_dir.blobs_dir} too (run `cairn fsck`)",
                                rejected=True,
                            ) from None
                # The server has less than we thought (it restored a backup,
                # or another uploader raced us): continue from its answer.
                self.applied = gap.applied_seq
                self._ack(gap.applied_seq)
            except UploadError as exc:
                if exc.status == 413 and self.max_bytes > 64 << 10:
                    self.max_bytes //= 2  # too big for the server: smaller batches
                    continue
                raise
        return 0

    def _step(self, client: IngestClient, run_id: str, max_bytes: int) -> int:
        if self.applied is None:
            self.applied = client.applied_seq(run_id, self.ref.name)
            self._ack(self.applied)
        records = self.reader.read(self.applied, max_bytes=max_bytes)
        if not records:
            if self.reader.error:
                raise UploadError(
                    f"{self.ref.log_dir}: {self.reader.error} (run `cairn fsck`)", rejected=True,
                )
            return 0
        first = records[0]["seq"]
        if first > self.applied + 1:
            raise UploadError(
                f"{self.ref.log_dir}: the server has applied seq {self.applied}, but this log "
                f"starts at {first}: the records in between are not in this directory",
                rejected=True,
            )
        for rec in records:
            for digest in record_blobs(rec):
                if not client.ensure_blob(digest, self.ref.run_dir.blobs_dir / digest):
                    log.warning(
                        "cairn: blob %s of run %s is missing from %s; sending its record without it",
                        digest, run_id, self.ref.run_dir.blobs_dir,
                    )
        before = self.applied
        applied = client.post_records(run_id, self.ref.name, records)
        self.applied = applied
        self._ack(applied)
        return max(0, applied - before)

    def _ack(self, seq: int) -> None:
        if self.ref.acked() != seq:
            self.ref.set_acked(seq)

    def done(self) -> bool:
        """Everything in the log is confirmed (as of now)."""
        return self.applied is not None and self.ref.last_seq() <= self.applied


@dataclass
class DirSync:
    """The upload state of one run directory."""

    run_dir: RunDir
    logs: dict[str, LogSync] = field(default_factory=dict)

    def refresh(self) -> list[LogSync]:
        for ref in self.run_dir.logs():
            if ref.key not in self.logs:
                self.logs[ref.key] = LogSync(ref)
        return list(self.logs.values())

    def step(self, client: IngestClient, *, budget: int = 8) -> int:
        """Up to ``budget`` batches over the directory's logs; returns the
        records newly confirmed."""
        run_id = self.run_dir.run_id
        total = 0
        for ls in self.refresh():
            for _ in range(budget):
                n = ls.step(client, run_id)
                total += n
                if n == 0:
                    break
        return total

    def settled(self) -> bool:
        """Fully confirmed and no writer left: nothing more will come."""
        logs = self.refresh()
        return all(ls.done() for ls in logs) and not self.run_dir.live()


def endpoint_for(run_dir: RunDir) -> tuple[str, str | None]:
    """``(url, token)`` of the server a run directory uploads to.

    Raises:
        Exception: The endpoint cannot be resolved (or started) now.
    """
    from ..endpoint import resolve_endpoint

    meta = run_dir.meta()
    server = meta.get("endpoint")
    if server in (None, "local"):
        ep = resolve_endpoint(repo=meta.get("repo")) if meta.get("repo") else resolve_endpoint()
    else:
        ep = resolve_endpoint(server=server)
    return ep.url, meta.get("token") or ep.token


def sync_paths(
    run_dirs: list[RunDir],
    *,
    client_for: Callable[[RunDir], IngestClient] | None = None,
    deadline: float | None = None,
    progress: Callable[[RunDir, str], Any] | None = None,
) -> dict[Path, str | None]:
    """Upload ``run_dirs`` in the foreground until each is fully confirmed,
    fails, or ``deadline`` (``time.monotonic()``) passes. Returns
    ``{path: None (done) | error}``. ``client_for`` picks the client of a
    directory (default: its recorded endpoint)."""
    clients: dict[tuple[str, str | None], IngestClient] = {}

    def default_client(rd: RunDir) -> IngestClient:
        key = endpoint_for(rd)
        if key not in clients:
            clients[key] = IngestClient(*key)
        return clients[key]

    pick = client_for or default_client
    out: dict[Path, str | None] = {}
    try:
        for rd in run_dirs:
            ds = DirSync(rd)
            try:
                client = pick(rd)
                while True:
                    if ds.step(client, budget=64) == 0:
                        break  # nothing left to send (a live run may add more)
                    if deadline is not None and time.monotonic() > deadline:
                        raise UploadError("time is up")
                out[rd.path] = None
                if progress:
                    progress(rd, "ok")
            except Exception as exc:  # noqa: BLE001 - report, keep going
                out[rd.path] = str(exc)
                if progress:
                    progress(rd, str(exc))
    finally:
        for c in clients.values():
            c.close()
    return out
