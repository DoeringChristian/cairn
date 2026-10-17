"""Source-tree read endpoints — tree manifest + one-file extraction."""

from __future__ import annotations

import json
import posixpath
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from cairn.backend.source_cache import SOURCE_CACHE
from ._common import get_data_dir, get_db, get_blobs, require_run

router = APIRouter(prefix="/api", tags=["source"])


@router.get("/runs/{run_id}/source/tree")
def get_source_tree(run_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    dd = get_data_dir(request)
    require_run(db, run_id)
    from cairn.backend.sources import get
    try:
        return get(db, run_id)[1]
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.get("/runs/{run_id}/source/file")
def get_source_file(
    run_id: str, request: Request, path: str = Query(...)
) -> dict[str, Any]:
    """Return one file's contents by path.

    Rejects absolute paths and any segment containing ``..`` to prevent
    directory traversal into the host fs.
    """
    db = get_db(request)
    dd = get_data_dir(request)
    require_run(db, run_id)

    # Path safety: must be relative, no backrefs, no absolute, no NUL.
    normalized = posixpath.normpath(path)
    if (
        normalized.startswith("/")
        or normalized.startswith("..")
        or "\x00" in path
        or path.startswith("/")
    ):
        raise HTTPException(status_code=400, detail="invalid path")

    from cairn.backend.sources import file
    try:
        data = file(db, get_blobs(request), run_id, normalized)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if data is None:
        raise HTTPException(404, 'file not in archive')
    # Try UTF-8 decode; if binary, return base64.
    try:
        text = data.decode("utf-8")
        return {"path": normalized, "encoding": "utf-8", "content": text}
    except UnicodeDecodeError:
        import base64

        return {
            "path": normalized,
            "encoding": "base64",
            "content": base64.b64encode(data).decode("ascii"),
        }
