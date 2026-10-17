"""The upload protocol: run-log records and blobs, uploader -> server.

* ``GET  /api/ingest/runs/{run_id}/logs/{log}`` -> ``{"applied_seq": n}``
  (0 for a log never seen).
* ``POST /api/ingest/runs/{run_id}/logs/{log}`` with ``{"from_seq": n,
  "records": [...]}`` (JSON, optionally ``Content-Encoding: gzip``; at most
  ``MAX_BODY`` bytes as sent) -> ``{"applied_seq": m}``. Applied in one
  transaction, exactly once (``record_apply.apply_records``):

  - 409 ``{"applied_seq"}``: a gap (resume from ``applied_seq + 1``);
  - 409 ``{"applied_seq", "missing_blobs": [...]}``: upload those first;
  - 503 + ``Retry-After``: the log waits for its run (a worker's log, a
    resumed run, a fork's parent), the server is busy, or its disk is full;
  - 422: a malformed batch; 413: a body over the limit.
* ``HEAD /api/blobs/{sha256}`` -> 200 (stored) / 404.
* ``PUT  /api/blobs/{sha256}`` raw bytes -> 201 (stored) / 200 (had it);
  400 when the bytes do not hash to the name. Written to a temp file, fsynced,
  renamed into place: idempotent and crash-safe.

All write-role routes (``app.py``).
"""

from __future__ import annotations

import errno
import gzip
import hashlib
import json
import logging
import os
import re
import sqlite3
import zlib
from typing import Any

import anyio
import anyio.to_thread
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse

from cairn.backend import record_apply
from ._common import get_blobs, get_data_dir, get_db

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["ingest"])

#: Largest request body accepted (as sent, i.e. compressed).
MAX_BODY = 8 * 1024 * 1024
#: Largest body after decompression.
MAX_INFLATED = 64 * 1024 * 1024
#: Ingest requests applying at once; more are told to come back (503): they
#: would only queue on the database's one write lock, holding threads.
MAX_IN_FLIGHT = 16
#: Threads applying batches (the writes serialize on one lock anyway).
APPLY_THREADS = 4

_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_RUN_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _check_names(run_id: str, log_name: str) -> None:
    if not _RUN_ID.match(run_id):
        raise HTTPException(status_code=422, detail=f"invalid run id {run_id!r}")
    if not record_apply.LOG_NAME.match(log_name):
        raise HTTPException(status_code=422, detail=f"invalid log name {log_name!r}")


def _busy(detail: str, retry_after: int, **extra: Any) -> JSONResponse:
    return JSONResponse(
        {"detail": detail, **extra}, status_code=503, headers={"Retry-After": str(retry_after)},
    )


def _limiter(request: Request) -> anyio.CapacityLimiter:
    state = request.app.state
    limiter = getattr(state, "apply_limiter", None)
    if limiter is None:  # created on first use, inside the app's event loop
        limiter = state.apply_limiter = anyio.CapacityLimiter(APPLY_THREADS)
    return limiter


def _disk_full(exc: BaseException) -> bool:
    if isinstance(exc, OSError) and exc.errno in (errno.ENOSPC, errno.EDQUOT):
        return True
    return isinstance(exc, sqlite3.OperationalError) and "full" in str(exc)


async def _read_body(request: Request) -> bytes:
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > MAX_BODY:
        raise HTTPException(status_code=413, detail=f"body over {MAX_BODY} bytes")
    chunks = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_BODY:
            raise HTTPException(status_code=413, detail=f"body over {MAX_BODY} bytes")
        chunks.append(chunk)
    body = b"".join(chunks)
    if request.headers.get("content-encoding", "").lower() == "gzip":
        try:
            d = zlib.decompressobj(16 + zlib.MAX_WBITS)
            body = d.decompress(body, MAX_INFLATED)
            if d.unconsumed_tail:
                raise HTTPException(status_code=413, detail=f"body inflates over {MAX_INFLATED} bytes")
        except (zlib.error, gzip.BadGzipFile) as exc:
            raise HTTPException(status_code=400, detail=f"bad gzip body: {exc}") from None
    return body


@router.get("/ingest/runs/{run_id}/logs/{log_name}")
def get_progress(run_id: str, log_name: str, request: Request) -> dict[str, Any]:
    """How far a log has been applied."""
    _check_names(run_id, log_name)
    return {"applied_seq": record_apply.applied_seq(get_db(request), run_id, log_name)}


@router.post("/ingest/runs/{run_id}/logs/{log_name}")
async def post_records(run_id: str, log_name: str, request: Request) -> Any:
    """Apply a batch of one log's records (see the module docstring)."""
    _check_names(run_id, log_name)
    state = request.app.state
    in_flight = getattr(state, "ingest_in_flight", 0)
    if in_flight >= MAX_IN_FLIGHT:
        return _busy("the server is busy; retry later", 1)
    state.ingest_in_flight = in_flight + 1
    try:
        body = await _read_body(request)
        try:
            data = json.loads(body)
        except (ValueError, UnicodeDecodeError):
            raise HTTPException(status_code=422, detail="body is not JSON") from None
        if not isinstance(data, dict) or not isinstance(data.get("records"), list):
            raise HTTPException(status_code=422, detail='body must be {"from_seq", "records"}')
        records = data["records"]
        from_seq = data.get("from_seq", records[0].get("seq") if records and isinstance(records[0], dict) else 1)
        if not isinstance(from_seq, int) or isinstance(from_seq, bool) or from_seq < 1:
            raise HTTPException(status_code=422, detail="from_seq must be a positive integer")
        db, dd, blobs = get_db(request), get_data_dir(request), get_blobs(request)
        try:
            applied = await anyio.to_thread.run_sync(
                lambda: record_apply.apply_records(db, dd, blobs, run_id, log_name, from_seq, records),
                limiter=_limiter(request),
            )
        except record_apply.ReplayConflict as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from None
        except record_apply.BadRecords as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from None
        except record_apply.MissingBlobs as exc:
            return JSONResponse(
                {"detail": str(exc), "applied_seq": exc.applied_seq, "missing_blobs": exc.hashes},
                status_code=409,
            )
        except record_apply.IngestGap as exc:
            return JSONResponse({"detail": str(exc), "applied_seq": exc.applied_seq}, status_code=409)
        except record_apply.IngestWait as exc:
            return _busy(str(exc), 5, applied_seq=exc.applied_seq)
        except (sqlite3.OperationalError, OSError) as exc:
            if _disk_full(exc):
                log.error("ingest of %s/%s: disk full (%s)", run_id, log_name, exc)
                return _busy("the server's disk is full; retry later", 30)
            if isinstance(exc, sqlite3.OperationalError) and "locked" in str(exc):
                return _busy("the database is busy; retry later", 1)
            raise
        return {"applied_seq": applied}
    finally:
        state.ingest_in_flight -= 1


@router.head("/blobs/{digest}")
def head_blob(digest: str, request: Request) -> Response:
    """200 if stored (its mtime refreshed, so garbage collection spares it
    until the record naming it arrives), else 404."""
    if not _SHA256.match(digest):
        raise HTTPException(status_code=422, detail="not a sha256 hex digest")
    return Response(status_code=200 if get_blobs(request).touch(digest) else 404)


@router.put("/blobs/{digest}")
async def put_blob(digest: str, request: Request) -> Response:
    """Store the body as blob ``digest`` after verifying its hash."""
    if not _SHA256.match(digest):
        raise HTTPException(status_code=422, detail="not a sha256 hex digest")
    blobs = get_blobs(request)
    if await anyio.to_thread.run_sync(blobs.touch, digest):
        # Already stored: the body is not needed (a client may still send it).
        return Response(status_code=200)
    h = hashlib.sha256()
    try:
        fh = await anyio.to_thread.run_sync(blobs.incoming)
    except OSError as exc:
        if _disk_full(exc):
            return _busy("the server's disk is full; retry later", 30)
        raise
    tmp = fh.name
    committed = False
    try:
        try:
            pending: list[bytes] = []
            buffered = 0
            async for chunk in request.stream():
                h.update(chunk)
                pending.append(chunk)
                buffered += len(chunk)
                if buffered >= 1 << 20:
                    data, pending, buffered = b"".join(pending), [], 0
                    await anyio.to_thread.run_sync(fh.write, data)

            def _sync() -> None:
                fh.write(b"".join(pending))
                fh.flush()
                os.fsync(fh.fileno())
                fh.close()

            await anyio.to_thread.run_sync(_sync)
        except OSError as exc:
            if _disk_full(exc):
                return _busy("the server's disk is full; retry later", 30)
            raise
        if h.hexdigest() != digest:
            raise HTTPException(
                status_code=400, detail=f"the body hashes to {h.hexdigest()}, not {digest}",
            )
        stored = await anyio.to_thread.run_sync(blobs.commit_incoming, tmp, digest)
        committed = True
        return Response(status_code=201 if stored else 200)
    finally:
        if not fh.closed:
            fh.close()
        if not committed:
            try:
                os.unlink(tmp)
            except FileNotFoundError:
                pass
