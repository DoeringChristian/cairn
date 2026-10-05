"""Custom viewer routes: the project's viewer list and ``cairn viewer dev`` sources.

* ``GET /api/projects/{p}/viewers[?all_versions=1]`` -> ``{viewers: [entry]}``:
  published viewers (artifact families of type ``cairn-viewer``) plus live
  dev sources (``dev: true``). See ``cairn.server.custom_viewers``.
* Dev sources (write role to change, read role to read; never share links):
  ``POST .../viewers/dev/{name}`` declares the file set (and heartbeats),
  ``PUT .../viewers/dev/{name}/file?path=&session=`` uploads one file,
  ``DELETE .../viewers/dev/{name}?session=`` ends it,
  ``GET .../viewers/dev/{name}/files`` and ``.../file?path=`` read it.

Published files are read through ``/api/artifact-versions/{id}/files`` and
``/file?path=``.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .. import auth
from ..custom_viewers import DevError, dev_store_for, published_viewers
from ..viewer_manifest import mime_for
from ._common import get_data_dir, get_db, slugify
from .artifacts import UNTRUSTED_CONTENT_HEADERS

router = APIRouter(prefix="/api", tags=["viewers"])
_write = Depends(auth.require_role("write"))


def _project(project_id: str) -> str:
    try:
        return slugify(project_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None


def _store(request: Request):
    return dev_store_for(get_data_dir(request).root)


def _dev(fn, *args: Any) -> Any:
    try:
        return fn(*args)
    except DevError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from None


@router.get("/projects/{project_id}/viewers")
def list_viewers(project_id: str, request: Request, all_versions: bool = False) -> dict[str, Any]:
    """Published viewers (each ``latest``, or every version with
    ``all_versions``) followed by live dev sources. A share link sees only the
    viewer versions its report uses, and no dev sources."""
    project = _project(project_id)
    db = get_db(request)
    grant = auth.request_share(request)
    if grant is not None:
        scope = auth.share_scope(request, grant)
        return {"viewers": published_viewers(db, project, version_ids=scope.viewer_versions)}
    viewers = published_viewers(db, project, all_versions=all_versions)
    viewers += _store(request).entries(project)
    return {"viewers": viewers}


class DevDeclareBody(BaseModel):
    session: str
    #: The folder's complete file set: relative path -> sha256 (hex).
    files: dict[str, str] = Field(default_factory=dict)


@router.post("/projects/{project_id}/viewers/dev/{name}", dependencies=[_write])
def dev_declare(project_id: str, name: str, body: DevDeclareBody, request: Request) -> dict[str, Any]:
    """Declare a dev source's file set (also its heartbeat) -> ``{missing,
    revision}``: upload each missing path with ``PUT .../file``."""
    return _dev(_store(request).declare, _project(project_id), name, body.session, body.files)


@router.put("/projects/{project_id}/viewers/dev/{name}/file", dependencies=[_write])
async def dev_put_file(
    project_id: str, name: str, request: Request,
    path: str = Query(...), session: str = Query(...),
) -> dict[str, Any]:
    """Upload one declared file (raw body) -> ``{missing, revision}``."""
    data = await request.body()
    return _dev(_store(request).put, _project(project_id), name, session, path, data)


@router.delete("/projects/{project_id}/viewers/dev/{name}", dependencies=[_write])
def dev_delete(project_id: str, name: str, request: Request, session: str = Query(...)) -> dict[str, Any]:
    _store(request).delete(_project(project_id), name, session)
    return {"deleted": name}


@router.get("/projects/{project_id}/viewers/dev/{name}/files")
def dev_files(project_id: str, name: str, request: Request) -> dict[str, Any]:
    """``{revision, files: [{path, size, digest, mime}]}`` of a dev source."""
    src = _dev(_store(request).get, _project(project_id), name)
    return {"revision": src.revision, "files": src.files()}


@router.get("/projects/{project_id}/viewers/dev/{name}/file")
def dev_file(project_id: str, name: str, request: Request, path: str = Query(...)) -> Response:
    """One file of a dev source, never cached."""
    src = _dev(_store(request).get, _project(project_id), name)
    data = _dev(src.read, path)
    return Response(
        content=data, media_type=mime_for(path),
        headers={"Cache-Control": "no-store", "X-Cairn-Revision": str(src.revision),
                 **UNTRUSTED_CONTENT_HEADERS},
    )
