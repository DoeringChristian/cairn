"""Export and import runs as ZIP archives.

Export bundles run metadata, params, summary, sequences, artifacts, logs, and
source code into a single ZIP that can be imported into another Cairn
instance. The archive format lives in ``cairn.server.run_archive``.
"""

from __future__ import annotations

import io
import zipfile
from typing import Any

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..run_archive import restore_archive, write_archive
from ._common import get_blobs, get_data_dir, get_db, utc_now

router = APIRouter(prefix="/api", tags=["import-export"])


class ExportRequest(BaseModel):
    run_ids: list[str]


@router.post("/export")
def export_runs(body: ExportRequest, request: Request) -> StreamingResponse:
    if not body.run_ids:
        raise HTTPException(status_code=400, detail="run_ids must not be empty")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        try:
            write_archive(
                get_db(request), get_blobs(request), get_data_dir(request), body.run_ids, zf,
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from None

    buf.seek(0)
    timestamp = utc_now().strftime("%Y%m%d_%H%M%S")
    filename = f"cairn_export_{timestamp}.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import")
async def import_runs(request: Request, file: UploadFile = File(...)) -> dict[str, Any]:
    """Restore an export under NEW run ids; references between runs follow."""
    content = await file.read()
    try:
        zf = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Invalid ZIP file") from None
    try:
        imported = restore_archive(
            get_db(request), get_blobs(request), get_data_dir(request), zf, keep_ids=False,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    return {"imported": imported}
