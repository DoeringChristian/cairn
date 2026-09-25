"""Artifact read endpoints — list per run, fetch bytes with Range support."""

from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import Response, StreamingResponse

from ._common import get_blobs, get_db, require_run

router = APIRouter(prefix="/api", tags=["artifacts"])

_RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$")

# Content is addressed by SHA256 digest, so a given URL's bytes never change —
# safe to cache forever. This is the immutable half of the query-URL freshness
# contract (the /api/query resolver is Cache-Control: no-store). The viewer
# relies on it: stepping through media requests the same URL for the same
# bytes in every card, so after the first load each image comes from the
# browser cache. The digest doubles as a strong ETag, so a revalidation (a
# hard reload, or a cache that ignores `immutable`) is a bodiless 304.
_IMMUTABLE = "public, max-age=31536000, immutable"


def _etag(digest: str) -> str:
    return f'"{digest}"'


def _etag_matches(if_none_match: str | None, digest: str) -> bool:
    """RFC 9110 weak comparison of an If-None-Match list against the digest's ETag."""
    if not if_none_match:
        return False
    tags = [t.strip() for t in if_none_match.split(",")]
    return any(t == "*" or t.removeprefix("W/") == _etag(digest) for t in tags)


@router.get("/runs/{run_id}/artifacts")
def list_run_artifacts(run_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    require_run(db, run_id)
    # Union of run_artifacts (named, non-sequence) and artifacts referenced by
    # sequences for this run.
    rows = db.read_columns(
        """
        SELECT ra.name, ra.hash,
               CASE WHEN ra.step = -1 THEN NULL ELSE ra.step END AS step,
               ra.created_at, a.mime_type, a.size_bytes, a.metadata,
               a.object_type
        FROM run_artifacts ra
        JOIN artifacts a ON a.hash = ra.hash
        WHERE ra.run_id = ?
        ORDER BY ra.created_at DESC
        """,
        [run_id],
    )
    seq_rows = db.read_columns(
        """
        SELECT DISTINCT s.name, s.artifact_hash AS hash, s.step,
               a.mime_type, a.size_bytes, a.metadata, s.object_type
        FROM sequences s
        JOIN artifacts a ON a.hash = s.artifact_hash
        WHERE s.run_id = ? AND s.artifact_hash IS NOT NULL
        ORDER BY s.name, s.step
        """,
        [run_id],
    )
    return {"named": rows, "from_sequences": seq_rows}


@router.get("/artifacts/{digest}")
def get_artifact(
    digest: str,
    request: Request,
    range_header: str | None = Header(default=None, alias="range"),
    if_none_match: str | None = Header(default=None, alias="if-none-match"),
) -> Response:
    db = get_db(request)
    blobs = get_blobs(request)
    rows = db.read_columns(
        "SELECT mime_type, size_bytes FROM artifacts WHERE hash = ?", [digest]
    )
    if not rows:
        raise HTTPException(status_code=404, detail="artifact not found")
    mime_type = rows[0]["mime_type"]
    total_size = rows[0]["size_bytes"]
    cache_headers = {"Cache-Control": _IMMUTABLE, "ETag": _etag(digest)}

    # A validator the client already holds names these exact bytes.
    if _etag_matches(if_none_match, digest):
        return Response(status_code=304, headers=cache_headers)

    if range_header:
        m = _RANGE_RE.match(range_header)
        if not m:
            raise HTTPException(status_code=416, detail="bad Range")
        start_s, end_s = m.groups()
        start = int(start_s) if start_s else 0
        end = int(end_s) if end_s else total_size - 1
        if start < 0 or end >= total_size or start > end:
            raise HTTPException(status_code=416, detail="range not satisfiable")
        length = end - start + 1
        fh = blobs.open_stream(digest)
        fh.seek(start)

        def iterator(fh=fh, remaining=length):
            try:
                while remaining > 0:
                    chunk = fh.read(min(65536, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk
            finally:
                fh.close()

        headers = {
            "Content-Range": f"bytes {start}-{end}/{total_size}",
            "Content-Length": str(length),
            "Accept-Ranges": "bytes",
            **cache_headers,
        }
        return StreamingResponse(
            iterator(), status_code=206, headers=headers, media_type=mime_type
        )

    # Full body
    data, _meta = blobs.get(digest)
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(len(data)),
        **cache_headers,
    }
    return Response(content=data, media_type=mime_type, headers=headers)
