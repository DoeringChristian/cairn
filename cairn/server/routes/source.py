"""Source-tree read endpoints — tree manifest + one-file extraction."""

from __future__ import annotations

import json
import posixpath
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from ..source_cache import SOURCE_CACHE
from ._common import get_data_dir, get_db, require_run

router = APIRouter(prefix="/api", tags=["source"])


@router.get("/runs/{run_id}/source/tree")
def get_source_tree(run_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    dd = get_data_dir(request)
    require_run(db, run_id)
    manifest_path = dd.sources_dir / run_id / "manifest.json"
    if not manifest_path.exists():
        raise HTTPException(status_code=404, detail="no source archive for run")
    return json.loads(manifest_path.read_text())


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

    archive_path = dd.sources_dir / run_id / "tree.tar.zst"
    if not archive_path.exists():
        raise HTTPException(status_code=404, detail="no source archive for run")

    tree = SOURCE_CACHE.get(archive_path)
    data = tree.files.get(normalized)
    if data is None:
        if normalized in tree.others:
            raise HTTPException(status_code=400, detail="not a regular file")
        raise HTTPException(status_code=404, detail="file not in archive")
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
