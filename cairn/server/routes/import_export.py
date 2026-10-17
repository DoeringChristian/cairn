"""Export and import runs as ZIP archives.

Export bundles run metadata, params, summary, sequences, artifacts, logs, and
source code into a single ZIP that can be imported into another Cairn
instance. The archive format lives in ``cairn.backend.run_archive``.
"""

from __future__ import annotations

import io
import zipfile
from typing import Any

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from cairn.backend.run_archive import restore_archive, write_archive
from cairn.server.routes._common import get_blobs, get_data_dir, get_db
from cairn.backend.common import slugify, utc_now

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
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from None

    buf.seek(0)
    timestamp = utc_now().strftime("%Y%m%d_%H%M%S")
    filename = f"cairn_export_{timestamp}.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import")
async def import_runs(
    request: Request, file: UploadFile = File(...), project: str | None = None,
    keep_ids: bool = False,
) -> dict[str, Any]:
    """Restore an export under NEW run ids; references between runs follow.
    ``project`` puts the archive's runs (with their sweeps and artifact
    registry entries) into that project instead of their own. ``keep_ids``
    keeps the archive's run ids (a fresh repo, e.g. a Reader of an archive:
    an id that exists already is an error)."""
    if project is not None:
        try:
            project = slugify(project)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from None
    content = await file.read()
    try:
        zf = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Invalid ZIP file") from None
    with zf:
        try:
            imported = await run_in_threadpool(  # long and blocking: off the event loop
                restore_archive,
                get_db(request), get_blobs(request), get_data_dir(request), zf, keep_ids=keep_ids,
                project=project,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from None
    return {"imported": imported}
