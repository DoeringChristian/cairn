"""Custom viewer routes: the project's viewer list and ``cairn viewer dev`` sources.

* ``GET /api/projects/{p}/viewers[?all_versions=1]`` -> ``{viewers: [entry]}``:
  published viewers (artifact families of type ``cairn-viewer``) plus live
  dev sources (``dev: true``). See ``cairn.server.custom_viewers``.
* Dev sources (write role to change, read role to read; never share links):
  ``POST .../viewers/dev/{name}`` declares the file set (and heartbeats),
  ``PUT .../viewers/dev/{name}/file?path=&session=`` uploads one file,
  ``DELETE .../viewers/dev/{name}?session=`` ends it,
  ``GET .../viewers/dev/{name}/files`` and ``.../file?path=`` read it.

* Built-in viewers (shipped with the UI bundle, named ``cairn.<name>``) lead
  every list (``builtin: true``); ``GET /api/viewers/builtin/{name}/files``
  and ``.../file?path=`` read them (share links too: they are part of the app).
* Default viewers (``cairn.server.viewer_defaults``): ``GET
  .../viewer-defaults`` -> ``{defaults: {key: viewer}, builtin: {key:
  viewer}}`` (the project's, and the built-in viewers'; read role, share
  links too); ``PUT .../viewer-defaults`` with ``{kind, viewer}`` sets one
  (write role; ``viewer: null`` clears it: a built-in type's renderer).

Published files are read through ``/api/artifact-versions/{id}/files`` and
``/file?path=``.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .. import auth, viewer_defaults
from ..custom_viewers import DevError, builtin_defaults, builtin_viewers, dev_store_for, published_viewers
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
    builtins = [v.entry() for v in builtin_viewers().values()]
    grant = auth.request_share(request)
    if grant is not None:
        scope = auth.share_scope(request, grant)
        return {"viewers": builtins + published_viewers(db, project, version_ids=scope.viewer_versions)}
    viewers = builtins + published_viewers(db, project, all_versions=all_versions)
    viewers += _store(request).entries(project)
    return {"viewers": viewers}


def _builtin(name: str):
    v = builtin_viewers().get(name)
    if v is None:
        raise HTTPException(status_code=404, detail=f"no built-in viewer {name!r}")
    return v


@router.get("/viewers/builtin/{name}/files")
def builtin_files(name: str) -> dict[str, Any]:
    """``{files: [{path, size, digest, mime}]}`` of a built-in viewer."""
    return {"files": _builtin(name).file_list()}


@router.get("/viewers/builtin/{name}/file")
def builtin_file(name: str, request: Request, path: str = Query(...)) -> Response:
    """One file of a built-in viewer (revalidated by its sha256)."""
    v = _builtin(name)
    sha = v.files.get(path)
    if sha is None:
        raise HTTPException(status_code=404, detail=f"built-in viewer {name!r} has no file {path!r}")
    headers = {"Cache-Control": "no-cache", "ETag": f'"{sha}"', **UNTRUSTED_CONTENT_HEADERS}
    if request.headers.get("if-none-match") == headers["ETag"]:
        return Response(status_code=304, headers=headers)
    return Response(content=v.read(path), media_type=mime_for(path), headers=headers)


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


@router.get("/projects/{project_id}/viewer-defaults")
def get_viewer_defaults(project_id: str, request: Request) -> dict[str, Any]:
    """The project's default viewer per kind: ``{defaults: {key: viewer}}``.
    A built-in type without a key shows in its built-in renderer."""
    return {
        "defaults": viewer_defaults.list_defaults(get_db(request), _project(project_id)),
        "builtin": builtin_defaults(),
    }


class ViewerDefaultBody(BaseModel):
    #: A built-in type (``volume``) or custom data (``custom:<kind>``, a bare kind too).
    kind: str
    #: The viewer's name; null: none (a built-in type's renderer).
    viewer: str | None = None


@router.put("/projects/{project_id}/viewer-defaults", dependencies=[_write])
def put_viewer_default(project_id: str, body: ViewerDefaultBody, request: Request) -> dict[str, Any]:
    """Set (or clear) the default viewer of one kind -> the project's defaults."""
    project = _project(project_id)
    try:
        key = viewer_defaults.normalize_kind(body.kind)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    db = get_db(request)
    if body.viewer is not None:
        listed = [v.entry() for v in builtin_viewers().values()] + published_viewers(db, project) + _store(request).entries(project)
        accepts = next(
            (v.get("accepts") or [] for v in listed
             if v["name"] == body.viewer and not v.get("error")),
            None,
        )
        if accepts is None:
            raise HTTPException(status_code=404, detail=f"no viewer {body.viewer!r} in project {project!r}")
        if not viewer_defaults.viewer_accepts(accepts, key):
            raise HTTPException(status_code=400, detail=f"viewer {body.viewer!r} does not accept {key!r}")
    with db.transaction() as con:
        viewer_defaults.set_default(con, project, key, body.viewer)
    return {"defaults": viewer_defaults.list_defaults(db, project), "builtin": builtin_defaults()}
