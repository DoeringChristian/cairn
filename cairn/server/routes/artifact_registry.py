"""Artifact registry routes: families, versions, entries, aliases, lineage.

Shapes are the ``artifact_registry_ops`` dicts:

* family: ``{id, project_id, name, type, description, created_at, updated_at,
  version_count, latest_version, total_size, aliases: {alias: version}}``;
* version: ``{id, family_id, project_id, name, type, version, ref,
  qualified_ref, digest, size, file_count, ref_count, metadata, description,
  step, created_at, aliases, created_by_run, producer, consumer_count}``;
* entry: ``{path, size, digest, mime, object_type, uri, etag, meta}``;
* lineage: ``{nodes, edges, groups[, center]}`` (see the Lineage section of
  ``artifact_registry_ops``).
"""

from __future__ import annotations

import shutil
import tempfile
import zipfile
from collections.abc import Iterator
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from .. import artifact_registry_ops as ops
from .. import auth
from ..storage.db import Database
from ._common import get_blobs, get_db, slugify
from ..viewer_manifest import VIEWER_TYPE, mime_for
from .artifacts import serve_blob

router = APIRouter(prefix="/api", tags=["artifact-registry"])
_write = Depends(auth.require_role("write"))


def _http(exc: Exception) -> HTTPException:
    if isinstance(exc, LookupError):
        return HTTPException(status_code=404, detail=str(exc).strip("'\""))
    return HTTPException(status_code=400, detail=str(exc))


def _version_type(db: Any, version_id: str) -> str | None:
    rows = db.read(
        "SELECT af.type FROM artifact_versions av JOIN artifact_families af "
        "ON af.id = av.family_id WHERE av.id = ?", [version_id],
    )
    return rows[0][0] if rows else None


def _project(project_id: str) -> str:
    try:
        return slugify(project_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None


# ---------------------------------------------------------------------------
# Families
# ---------------------------------------------------------------------------

class FamilyUpdate(BaseModel):
    description: str | None = None


@router.get("/projects/{project_id}/artifact-families")
def list_families(project_id: str, request: Request, type: str | None = None) -> dict[str, Any]:
    """``{families: [family]}``, most recently updated first; ``type`` filters."""
    return {"families": ops.list_families(get_db(request), _project(project_id), type_filter=type)}


@router.get("/projects/{project_id}/artifact-families/by-name/{name:path}")
def get_family_by_name(project_id: str, name: str, request: Request) -> dict[str, Any]:
    """The family named ``name`` with ``versions`` (newest first)."""
    db = get_db(request)
    family = ops.get_family_by_name(db, _project(project_id), name)
    if family is None:
        raise HTTPException(status_code=404, detail=f"artifact {name!r} not found")
    return ops.family_detail(db, family["id"])


@router.get("/artifact-families/{family_id}")
def get_family(family_id: str, request: Request) -> dict[str, Any]:
    """The family with ``versions`` (newest first)."""
    try:
        return ops.family_detail(get_db(request), family_id)
    except LookupError as exc:
        raise _http(exc) from None


@router.patch("/artifact-families/{family_id}", dependencies=[_write])
def update_family(family_id: str, body: FamilyUpdate, request: Request) -> dict[str, Any]:
    db = get_db(request)
    try:
        ops.update_family(db, family_id, description=body.description)
        return ops.family_detail(db, family_id)
    except LookupError as exc:
        raise _http(exc) from None


@router.delete("/artifact-families/{family_id}", dependencies=[_write])
def delete_family(family_id: str, request: Request) -> dict[str, Any]:
    try:
        ops.delete_family(get_db(request), family_id)
    except LookupError as exc:
        raise _http(exc) from None
    return {"deleted": family_id}


@router.get("/artifact-families/{family_id}/versions")
def list_versions(family_id: str, request: Request) -> dict[str, Any]:
    """``{versions: [version]}``, newest first."""
    try:
        return {"versions": ops.list_versions(get_db(request), family_id)}
    except LookupError as exc:
        raise _http(exc) from None


# ---------------------------------------------------------------------------
# Versions
# ---------------------------------------------------------------------------

class CreateVersionBody(BaseModel):
    """Register an uploaded manifest blob as the next version of ``name``."""

    name: str
    type: str = "artifact"
    #: Digest of the manifest blob (uploaded with every file it names first).
    digest: str
    description: str | None = None
    metadata: dict[str, Any] | None = None
    step: int | None = None
    created_by_run: str | None = None
    #: User aliases moved to the new version (``latest`` always moves).
    aliases: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    #: Client-generated id: replaying the request returns the same version.
    version_id: str | None = None


@router.post("/projects/{project_id}/artifact-versions", dependencies=[_write])
def create_version(project_id: str, body: CreateVersionBody, request: Request) -> dict[str, Any]:
    """Create a version -> the version."""
    try:
        return ops.create_version(
            get_db(request), get_blobs(request), project_id=_project(project_id),
            **body.model_dump(),
        )
    except (LookupError, ValueError) as exc:
        raise _http(exc) from None


class ResolveRefBody(BaseModel):
    ref: str


@router.post("/projects/{project_id}/resolve-artifact-ref")
def resolve_ref(project_id: str, body: ResolveRefBody, request: Request) -> dict[str, Any]:
    """``[project/]name[:alias|:vN]`` (bare name = ``latest``) -> the version."""
    try:
        return ops.resolve_ref(get_db(request), _project(project_id), body.ref)
    except (ValueError, LookupError) as exc:
        raise _http(exc) from None


@router.get("/artifact-versions/{version_id}")
def get_version(version_id: str, request: Request) -> dict[str, Any]:
    try:
        return ops.get_version(get_db(request), version_id)
    except LookupError as exc:
        raise _http(exc) from None


class VersionUpdate(BaseModel):
    #: Replaces the description when given.
    description: str | None = None
    #: Merged key by key into the metadata when given.
    metadata: dict[str, Any] | None = None


@router.patch("/artifact-versions/{version_id}", dependencies=[_write])
def update_version(version_id: str, body: VersionUpdate, request: Request) -> dict[str, Any]:
    """Edit a version's description / merge into its metadata -> the version."""
    try:
        return ops.update_version(
            get_db(request), version_id, description=body.description, metadata=body.metadata,
        )
    except (LookupError, ValueError) as exc:
        raise _http(exc) from None


@router.delete("/artifact-versions/{version_id}", dependencies=[_write])
def delete_version(version_id: str, request: Request, force: bool = False) -> dict[str, Any]:
    """Delete a version. One that an alias names (``latest`` included) is a
    409 unless ``force=true``."""
    try:
        ops.delete_version(get_db(request), version_id, force=force)
    except LookupError as exc:
        raise _http(exc) from None
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    return {"deleted": version_id}


class TagBody(BaseModel):
    tag: str


@router.post("/artifact-versions/{version_id}/tags", dependencies=[_write])
def add_tag(version_id: str, body: TagBody, request: Request) -> dict[str, Any]:
    """Add a tag -> the version."""
    try:
        return ops.add_tag(get_db(request), version_id, body.tag)
    except (LookupError, ValueError) as exc:
        raise _http(exc) from None


@router.delete("/artifact-versions/{version_id}/tags/{tag}", dependencies=[_write])
def remove_tag(version_id: str, tag: str, request: Request) -> dict[str, Any]:
    """Remove a tag -> the version."""
    try:
        return ops.remove_tag(get_db(request), version_id, tag)
    except LookupError as exc:
        raise _http(exc) from None


@router.get("/artifact-versions/{version_id}/files")
def version_files(version_id: str, request: Request) -> dict[str, Any]:
    """``{files: [entry]}`` by path."""
    try:
        return {"files": ops.version_files(get_db(request), version_id)}
    except LookupError as exc:
        raise _http(exc) from None


@router.get("/artifact-versions/{version_id}/file")
def version_file_content(
    version_id: str,
    request: Request,
    path: str = Query(..., description="The entry's path inside the version."),
    range_header: str | None = Header(default=None, alias="range"),
    if_none_match: str | None = Header(default=None, alias="if-none-match"),
) -> Response:
    """One uploaded entry's bytes, served with the entry's mime type (Range
    aware). A reference entry is a 409: its bytes live at its ``uri``."""
    try:
        entry = ops.version_file(get_db(request), version_id, path)
    except LookupError as exc:
        raise _http(exc) from None
    if entry["digest"] is None:
        raise HTTPException(
            status_code=409,
            detail=f"entry {path!r} is a reference to {entry['uri']}; it is not stored here",
        )
    mime = entry["mime"] or None
    if _version_type(get_db(request), version_id) == VIEWER_TYPE:
        # A viewer's modules must load as JavaScript whatever the publishing
        # platform's mimetypes guessed.
        mime = mime_for(path)
    return serve_blob(
        request, entry["digest"], mime_type=mime,
        filename=path.rsplit("/", 1)[-1], range_header=range_header, if_none_match=if_none_match,
    )


@router.get("/artifact-versions/{version_id}/download")
def version_download(version_id: str, request: Request) -> StreamingResponse:
    """Every uploaded entry of the version as one zip, at its path, named
    ``<name>-v<N>.zip`` (as ``ArtifactVersion.download()`` names its
    directory). References are not included (their bytes live at their
    URIs); ``X-Cairn-Skipped-References`` says how many were left out."""
    db = get_db(request)
    try:
        ver = ops.get_version(db, version_id)
        entries = ops.version_files(db, version_id)
    except LookupError as exc:
        raise _http(exc) from None
    blobs = get_blobs(request)
    spool = tempfile.SpooledTemporaryFile(max_size=64 * 1024 * 1024)
    with zipfile.ZipFile(spool, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as zf:
        for e in entries:
            if e["digest"] is None:
                continue
            with blobs.open_stream(e["digest"]) as src, zf.open(e["path"], "w", force_zip64=True) as dst:
                shutil.copyfileobj(src, dst, 1024 * 1024)
    size = spool.tell()
    spool.seek(0)

    def chunks() -> Iterator[bytes]:
        try:
            while chunk := spool.read(1024 * 1024):
                yield chunk
        finally:
            spool.close()

    filename = f"{ver['name']}-v{ver['version']}.zip"
    return StreamingResponse(
        chunks(), media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
            "Content-Length": str(size),
            "X-Cairn-Skipped-References": str(sum(1 for e in entries if e["digest"] is None)),
        },
    )


@router.get("/artifact-versions/{version_id}/consumers")
def version_consumers(version_id: str, request: Request) -> dict[str, Any]:
    """``{consumers: [{run, role, used_at}], count}``, oldest use first."""
    try:
        consumers = ops.version_consumers(get_db(request), version_id)
    except LookupError as exc:
        raise _http(exc) from None
    return {"consumers": consumers, "count": len(consumers)}


class AliasBody(BaseModel):
    alias: str


@router.post("/artifact-versions/{version_id}/aliases", dependencies=[_write])
def add_alias(version_id: str, body: AliasBody, request: Request) -> dict[str, Any]:
    """Point a user alias at this version (moving it) -> the version.
    ``latest`` and ``vN`` are reserved (400)."""
    try:
        return ops.add_alias(get_db(request), version_id, body.alias)
    except (LookupError, ValueError) as exc:
        raise _http(exc) from None


@router.delete("/artifact-versions/{version_id}/aliases/{alias}", dependencies=[_write])
def remove_alias(version_id: str, alias: str, request: Request) -> dict[str, Any]:
    """Remove a user alias from this version -> the version."""
    try:
        return ops.remove_alias(get_db(request), version_id, alias)
    except (LookupError, ValueError) as exc:
        raise _http(exc) from None


@router.get("/artifact-versions/{version_id}/lineage")
def version_lineage(
    version_id: str, request: Request,
    depth: int | None = Query(default=None, ge=0),
    direction: str = Query(default="both", pattern="^(upstream|downstream|both)$"),
    cluster: int | None = Query(default=None, ge=1, description="Collapse sibling sets larger than this."),
) -> dict[str, Any]:
    """The lineage graph centred on the version."""
    try:
        return ops.lineage_graph(
            get_db(request), version_id=version_id, depth=depth, direction=direction,
            cluster=cluster,
        )
    except (LookupError, ValueError) as exc:
        raise _http(exc) from None


# ---------------------------------------------------------------------------
# Runs
# ---------------------------------------------------------------------------

class RecordInputBody(BaseModel):
    artifact_version_id: str
    role: str = "input"


@router.post("/runs/{run_id}/inputs", dependencies=[_write])
def record_input(run_id: str, body: RecordInputBody, request: Request) -> dict[str, Any]:
    db = get_db(request)
    try:
        ops.get_version(db, body.artifact_version_id)
    except LookupError as exc:
        raise _http(exc) from None
    ops.record_input(db, run_id=run_id, artifact_version_id=body.artifact_version_id, role=body.role)
    return {"run_id": run_id, "artifact_version_id": body.artifact_version_id}


@router.get("/runs/{run_id}/inputs")
def run_inputs(run_id: str, request: Request, role: str | None = None) -> dict[str, Any]:
    """``{inputs: [version + {role, used_at}]}`` in consumption order."""
    return {"inputs": ops.run_inputs(get_db(request), run_id, role)}


class RecordUseBody(BaseModel):
    run_id: str
    role: str | None = None


def _require_run_row(db: Any, run_id: str) -> None:
    if not db.read_columns("SELECT 1 FROM runs WHERE id = ?", [run_id]):
        raise HTTPException(status_code=404, detail=f"run {run_id} not found")


@router.post("/runs/{run_id}/uses", dependencies=[_write])
def record_run_use(run_id: str, body: RecordUseBody, request: Request) -> dict[str, Any]:
    """Record that ``run_id`` used the run ``body.run_id`` directly
    (idempotent; 404 when either run is unknown, 400 for a self-link)."""
    db = get_db(request)
    _require_run_row(db, run_id)
    _require_run_row(db, body.run_id)
    try:
        ops.record_run_use(db, run_id=run_id, used_run_id=body.run_id, role=body.role)
    except ValueError as exc:
        raise _http(exc) from None
    return {"run_id": run_id, "used_run_id": body.run_id}


@router.get("/runs/{run_id}/uses")
def run_uses(run_id: str, request: Request) -> dict[str, Any]:
    """``{uses: [{run_id, role}], used_by: [{run_id, role}]}``: the runs this
    run used and the runs that used it, in link order."""
    db = get_db(request)
    _require_run_row(db, run_id)
    return ops.run_uses(db, run_id)


@router.get("/runs/{run_id}/relations")
def run_relations(run_id: str, request: Request) -> dict[str, Any]:
    """The run page's Inputs / Used by: ``{inputs: {runs, artifacts},
    used_by: {runs}}`` (see ``artifact_registry_ops.run_relations``)."""
    db = get_db(request)
    _require_run_row(db, run_id)
    return ops.run_relations(db, run_id)


@router.get("/runs/{run_id}/outputs")
def run_outputs(
    run_id: str, request: Request,
    include: str | None = Query(default=None, description="'files' adds each version's entries."),
) -> dict[str, Any]:
    """``{outputs: [version]}`` in creation order (with ``files`` when asked:
    the run page's artifact cards render from these)."""
    db = get_db(request)
    outputs = ops.run_outputs(db, run_id)
    if include and "files" in include.split(","):
        with_files(db, outputs)
    return {"outputs": outputs}


def with_files(db: Database, versions: list[dict[str, Any]]) -> None:
    """Add each version's entries (``files``), one query per 500 versions."""
    files = ops.versions_files(db, [v["id"] for v in versions])
    for v in versions:
        v["files"] = files[v["id"]]


@router.get("/runs/{run_id}/lineage")
def run_lineage(
    run_id: str, request: Request,
    depth: int | None = Query(default=None, ge=0),
    direction: str = Query(default="both", pattern="^(upstream|downstream|both)$"),
    cluster: int | None = Query(default=None, ge=1, description="Collapse sibling sets larger than this."),
) -> dict[str, Any]:
    """The lineage graph centred on the run."""
    try:
        return ops.lineage_graph(
            get_db(request), run_id=run_id, depth=depth, direction=direction, cluster=cluster,
        )
    except (LookupError, ValueError) as exc:
        raise _http(exc) from None


@router.get("/projects/{project_id}/lineage")
def project_lineage(
    project_id: str, request: Request, family_id: str | None = None,
    cluster: int | None = Query(default=None, ge=1, description="Collapse sibling sets larger than this."),
) -> dict[str, Any]:
    """The project-wide lineage graph (``family_id``: one family's versions)."""
    return ops.project_lineage(
        get_db(request), _project(project_id), family_id=family_id, cluster=cluster,
    )
