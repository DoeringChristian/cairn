"""Health, info, and default workspace-layout endpoints."""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Request

from ._common import get_blobs, get_data_dir, get_db

router = APIRouter(prefix="/api", tags=["health"])

# ``public_router`` is registered WITHOUT the require_role dependency (see
# app.py) — /api/health is a liveness probe and must work unauthenticated,
# even when auth is enabled. Everything else in this module (info,
# workspace layout) leaks data and stays behind require_role("read").
public_router = APIRouter(prefix="/api", tags=["health"])

_STARTED_AT = time.time()


@public_router.get("/health")
def health() -> dict[str, Any]:
    from cairn import __version__

    return {
        "status": "ok",
        "version": __version__,
        "uptime_sec": time.time() - _STARTED_AT,
    }


@router.get("/info")
def info(request: Request) -> dict[str, Any]:
    from cairn import __version__

    db = get_db(request)
    dd = get_data_dir(request)
    (run_count,) = db.read_one("SELECT COUNT(*) FROM runs") or (0,)
    # Approximate size = size of DB file + blob dir.
    size = dd.db_path.stat().st_size if dd.db_path.exists() else 0
    for p in dd.artifacts_dir.rglob("*"):
        if p.is_file():
            size += p.stat().st_size
    return {
        "version": __version__,
        "data_dir": str(dd.root),
        "run_count": run_count,
        "size_bytes": size,
    }


