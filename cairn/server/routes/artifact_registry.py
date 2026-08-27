"""Artifact registry routes -- versioned artifact families, versions, aliases, lineage."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Form
from pydantic import BaseModel

from ._common import get_blobs, get_db
from .. import artifact_registry_ops as ops
from .. import auth

router = APIRouter(prefix="/api", tags=["artifact-registry"])
_write = Depends(auth.require_role("write"))


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class FamilyCreate(BaseModel):
    name: str
    type: str = "artifact"
    description: str | None = None


class FamilyUpdate(BaseModel):
    description: str | None = None


class AliasSet(BaseModel):
    alias: str
    version_id: str


class RecordInputBody(BaseModel):
    artifact_version_id: str
    role: str = "input"


class ResolveRefBody(BaseModel):
    ref: str


# ---------------------------------------------------------------------------
# Families
# ---------------------------------------------------------------------------

@router.get("/projects/{project_id}/artifact-families")
def list_families(
    project_id: str, request: Request, type: str | None = None,
) -> dict[str, Any]:
    db = get_db(request)
    families = ops.list_families(db, project_id, type_filter=type)
    return {"families": families}


@router.post("/projects/{project_id}/artifact-families", dependencies=[_write])
def create_family(
    project_id: str, body: FamilyCreate, request: Request,
) -> dict[str, Any]:
    db = get_db(request)
    family = ops.get_or_create_family(
        db,
        project_id=project_id,
        name=body.name,
        type=body.type,
        description=body.description,
    )
    return family


@router.get("/projects/{project_id}/artifact-families/by-name/{name:path}")
def get_family_by_name(
    project_id: str, name: str, request: Request,
) -> dict[str, Any]:
    db = get_db(request)
    family = ops.get_family_by_name(db, project_id, name)
    if family is None:
        raise HTTPException(status_code=404, detail=f"family '{name}' not found")
    return family


@router.get("/artifact-families/{family_id}")
def get_family(family_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    try:
        family = ops.get_family(db, family_id)
        family["versions"] = ops.list_versions(db, family_id)
        # Add aliases
        alias_rows = db.read_columns(
            """SELECT a.alias, v.version
               FROM artifact_aliases a
               JOIN artifact_versions v ON v.id = a.version_id
               WHERE a.family_id = ?
               ORDER BY a.alias""",
            [family_id],
        )
        family["aliases"] = [r["alias"] for r in alias_rows]
        # Add aggregate fields the UI expects
        versions = family["versions"]
        family["total_versions"] = len(versions)
        family["latest_version"] = max((v["version"] for v in versions), default=None)
        family["total_size"] = sum(v["size_bytes"] for v in versions)
        return family
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.patch("/artifact-families/{family_id}", dependencies=[_write])
def update_family(
    family_id: str, body: FamilyUpdate, request: Request,
) -> dict[str, Any]:
    db = get_db(request)
    try:
        ops.update_family(db, family_id, description=body.description)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {"updated": family_id}


@router.delete("/artifact-families/{family_id}", dependencies=[_write])
def delete_family(family_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    try:
        ops.delete_family(db, family_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {"deleted": family_id}


# ---------------------------------------------------------------------------
# Versions
# ---------------------------------------------------------------------------

@router.get("/artifact-families/{family_id}/versions")
def list_versions(family_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    versions = ops.list_versions(db, family_id)
    return {"versions": versions}


class CreateVersionBody(BaseModel):
    """R0 contract fix: a version REFERENCES an already-uploaded blob by
    digest (content-addressed, single upload) — the shape the SDK always
    sent. The old multipart re-upload form is gone."""

    hash: str
    size_bytes: int | None = None
    metadata: dict[str, Any] | None = None
    created_by_run: str | None = None
    aliases: list[str] | None = None


@router.post("/artifact-families/{family_id}/versions", dependencies=[_write])
def create_version(
    family_id: str, body: CreateVersionBody, request: Request,
) -> dict[str, Any]:
    db = get_db(request)
    try:
        return ops.create_version_from_digest(
            db,
            family_id=family_id,
            digest=body.hash,
            size_bytes=body.size_bytes,
            metadata=body.metadata,
            created_by_run=body.created_by_run,
            aliases=body.aliases,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/artifact-versions/{version_id}")
def get_version(version_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    try:
        return ops.get_version(db, version_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/artifact-families/{family_id}/versions/{version_num}")
def get_version_by_number(
    family_id: str, version_num: int, request: Request,
) -> dict[str, Any]:
    db = get_db(request)
    ver = ops.get_version_by_number(db, family_id, version_num)
    if ver is None:
        raise HTTPException(
            status_code=404,
            detail=f"version {version_num} not found in family {family_id}",
        )
    return ver


# ---------------------------------------------------------------------------
# Aliases
# ---------------------------------------------------------------------------

@router.put("/artifact-families/{family_id}/aliases", dependencies=[_write])
def set_alias(
    family_id: str, body: AliasSet, request: Request,
) -> dict[str, Any]:
    db = get_db(request)
    try:
        ops.set_alias(db, family_id, body.alias, body.version_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {"family_id": family_id, "alias": body.alias, "version_id": body.version_id}


@router.delete("/artifact-families/{family_id}/aliases/{alias}", dependencies=[_write])
def delete_alias(
    family_id: str, alias: str, request: Request,
) -> dict[str, Any]:
    db = get_db(request)
    ops.delete_alias(db, family_id, alias)
    return {"deleted": alias}


# ---------------------------------------------------------------------------
# Ref resolution
# ---------------------------------------------------------------------------

@router.post("/projects/{project_id}/resolve-artifact-ref")
def resolve_ref(
    project_id: str, body: ResolveRefBody, request: Request,
) -> dict[str, Any]:
    db = get_db(request)
    try:
        return ops.resolve_ref(db, project_id, body.ref)
    except (ValueError, LookupError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))


# ---------------------------------------------------------------------------
# Run inputs / outputs / lineage
# ---------------------------------------------------------------------------

@router.post("/runs/{run_id}/inputs", dependencies=[_write])
def record_input(
    run_id: str, body: RecordInputBody, request: Request,
) -> dict[str, Any]:
    db = get_db(request)
    ops.record_input(
        db,
        run_id=run_id,
        artifact_version_id=body.artifact_version_id,
        role=body.role,
    )
    return {"run_id": run_id, "artifact_version_id": body.artifact_version_id}


@router.get("/runs/{run_id}/inputs")
def get_run_inputs(run_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    return {"inputs": ops.get_run_inputs(db, run_id)}


@router.get("/runs/{run_id}/outputs")
def get_run_outputs(run_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    return {"outputs": ops.get_run_outputs(db, run_id)}


@router.get("/projects/{project_id}/lineage")
def get_lineage(
    project_id: str,
    request: Request,
    family_id: str | None = None,
    depth: int | None = None,
) -> dict[str, Any]:
    db = get_db(request)
    return ops.get_lineage_graph(db, project_id, family_id=family_id, depth=depth)
