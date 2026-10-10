"""Repo administration over the API: stats, backups, fsck, daemon shutdown.

* ``GET  /api/admin/repo`` — what the repo holds (``cairn ping``).
* ``POST /api/admin/backup`` — an online backup into ``<repo>/backups/``;
  ``GET /api/admin/backups/{name}`` downloads one (``cairn backup --to``).
* ``POST /api/admin/fsck?repair=`` — ``integrity.fsck`` (``cairn fsck``).
* ``POST /api/server/shutdown`` — stop a daemon server (``cairn server
  --daemon``, e.g. the one a ``Reader`` of an archive started); 409 for any
  other server, which is stopped where it was started.

Write-role routes (``app.py``).
"""

from __future__ import annotations

from typing import Any

import anyio.to_thread
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from .. import integrity
from ._common import get_blobs, get_data_dir, get_db

router = APIRouter(prefix="/api", tags=["admin"])


@router.get("/admin/repo")
async def repo_stats(request: Request) -> dict[str, Any]:
    db, dd = get_db(request), get_data_dir(request)
    return await anyio.to_thread.run_sync(lambda: integrity.repo_stats(db, dd))


@router.post("/admin/backup")
async def make_backup(request: Request) -> dict[str, Any]:
    db, dd = get_db(request), get_data_dir(request)
    return await anyio.to_thread.run_sync(lambda: integrity.backup(db, dd))


@router.get("/admin/backups/{name}")
def download_backup(name: str, request: Request) -> FileResponse:
    path = integrity.backup_path(get_data_dir(request), name)
    if path is None:
        raise HTTPException(status_code=404, detail=f"no backup {name!r}")
    return FileResponse(path, media_type="application/vnd.sqlite3", filename=name)


@router.post("/admin/fsck")
async def run_fsck(request: Request, repair: bool = False) -> dict[str, Any]:
    db, dd, blobs = get_db(request), get_data_dir(request), get_blobs(request)
    return await anyio.to_thread.run_sync(
        lambda: integrity.fsck(db, dd, blobs, repair=repair),
    )


@router.post("/server/shutdown")
def shutdown(request: Request) -> dict[str, Any]:
    shutdown_fn = getattr(request.app.state, "request_shutdown", None)
    if not getattr(request.app.state, "daemon", False) or shutdown_fn is None:
        raise HTTPException(
            status_code=409, detail="only a daemon server (cairn server --daemon) stops on request",
        )
    shutdown_fn()
    return {"stopping": True}
