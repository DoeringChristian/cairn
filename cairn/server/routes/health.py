"""Health, info, and default workspace-layout endpoints."""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Request

from ._common import get_blobs, get_data_dir, get_db

router = APIRouter(prefix="/api", tags=["health"])

_STARTED_AT = time.time()


@router.get("/health")
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


@router.get("/workspaces/{scope_type}/{scope_id}")
def workspace_layout(
    scope_type: str, scope_id: str, request: Request
) -> dict[str, Any]:
    """Default auto-generated layout (v1: read-only).

    v2 will persist/override this via ``workspaces`` table; for now we emit a
    layout derived from the sequences actually logged against the scope.
    """
    db = get_db(request)
    # For a ``run`` scope, pull unique (name, context_hash, object_type).
    if scope_type == "run":
        rows = db.read_columns(
            """
            SELECT DISTINCT name, object_type, context
            FROM sequences WHERE run_id = ?
            ORDER BY name
            """,
            [scope_id],
        )
    else:
        # For task/project/global, just enumerate distinct metric names.
        rows = db.read_columns(
            "SELECT DISTINCT name, object_type, context FROM sequences ORDER BY name"
        )

    cards = []
    for i, r in enumerate(rows):
        card_type = {
            "scalar": "scalar_plot",
            "image": "image_gallery",
            "audio": "audio_player",
            "video": "video_player",
            "figure": "figure_interactive",
            "histogram": "histogram",
            "text": "text_viewer",
        }.get(r["object_type"], "scalar_plot")
        cards.append(
            {
                "id": f"card_{i}",
                "type": card_type,
                "config": {"metric": r["name"], "context": r["context"]},
                "position": {"x": (i % 2) * 6, "y": (i // 2) * 4, "w": 6, "h": 4},
            }
        )
    return {
        "version": 1,
        "scope": {"type": scope_type, "id": scope_id},
        "cards": cards,
        "grid": {"columns": 12},
    }
