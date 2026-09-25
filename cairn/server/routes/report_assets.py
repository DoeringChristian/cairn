"""Images uploaded into a report (pasted or dropped into a cell).

The bytes go to the content-addressed blob store; a ``report_assets`` row
grants one report access to one hash. A report references an image as
``cairn-asset:<hash>`` and the client resolves that to the GET route here.
Only raster images are accepted, recognised by their magic bytes (never by
the client's declared type), so an upload can't smuggle HTML or SVG script
onto the API origin.
"""

from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response

from .. import auth
from ..storage.db import Database
from ._common import get_blobs, get_db, utc_now

router = APIRouter(prefix="/api", tags=["reports"])
_write = Depends(auth.require_role("write"))

MAX_ASSET_BYTES = 20 * 1024 * 1024

# A hash names immutable bytes. ``private``: the route sits behind auth, so a
# shared cache must not keep it.
_IMMUTABLE = "private, max-age=31536000, immutable"
_HASH_RE = re.compile(r"^[0-9a-f]{64}$")


def sniff_image_type(data: bytes) -> str | None:
    """The MIME type of a PNG/JPEG/GIF/WebP by its magic bytes, else None."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def require_report(db: Database, project_id: str, report_id: str) -> None:
    if db.read_one(
        "SELECT 1 FROM reports WHERE id = ? AND project_id = ?", [report_id, project_id],
    ) is None:
        raise HTTPException(status_code=404, detail="report not found")


@router.post("/projects/{project_id}/reports/{report_id}/assets", dependencies=[_write])
async def upload_report_asset(
    project_id: str, report_id: str, request: Request, file: UploadFile = File(...),
) -> dict[str, Any]:
    db = get_db(request)
    require_report(db, project_id, report_id)
    data = await file.read(MAX_ASSET_BYTES + 1)
    if len(data) > MAX_ASSET_BYTES:
        raise HTTPException(status_code=413, detail="image larger than 20 MB")
    mime_type = sniff_image_type(data)
    if mime_type is None:
        raise HTTPException(
            status_code=415, detail="only PNG, JPEG, GIF and WebP images are accepted",
        )
    digest, size = get_blobs(request).put(data, mime_type)
    db.write(
        """INSERT OR IGNORE INTO report_assets
               (report_id, hash, mime_type, size_bytes, created_at)
           VALUES (?, ?, ?, ?, ?)""",
        [report_id, digest, mime_type, size, utc_now().isoformat()],
    )
    return {
        "hash": digest,
        "mime_type": mime_type,
        "size_bytes": size,
        "ref": f"cairn-asset:{digest}",
        "url": f"/api/reports/{report_id}/assets/{digest}",
    }


@router.get("/reports/{report_id}/assets/{digest}")
def get_report_asset(report_id: str, digest: str, request: Request) -> Response:
    if not _HASH_RE.match(digest):
        raise HTTPException(status_code=404, detail="asset not found")
    db = get_db(request)
    row = db.read_one(
        "SELECT mime_type FROM report_assets WHERE report_id = ? AND hash = ?",
        [report_id, digest],
    )
    blobs = get_blobs(request)
    if row is None or not blobs.exists(digest):
        raise HTTPException(status_code=404, detail="asset not found")
    data = blobs.path_for(digest).read_bytes()
    return Response(
        content=data,
        media_type=row[0],
        headers={"Cache-Control": _IMMUTABLE, "X-Content-Type-Options": "nosniff"},
    )
