"""Ingest endpoints: SDK → server.

Thin HTTP wrappers around ``cairn.server.ingest_ops``. All actual DB logic
lives there so it can be reused by the local-mode SDK transport.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import (
    APIRouter,
    HTTPException,
    Request,
    Response,
)
from pydantic import BaseModel, Field

from .. import ingest_ops
from ._common import get_blobs, get_data_dir, get_db

router = APIRouter(prefix="/api", tags=["ingest"])


# ---------- Pydantic request models -----------------------------------------


class GitInfo(BaseModel):
    sha: str | None = None
    branch: str | None = None
    dirty: bool | None = None


class CreateRunRequest(BaseModel):
    project: str
    name: str | None = None
    tags: list[str] | None = None
    notes: str | None = None
    env: dict[str, Any] | None = None
    git: GitInfo | None = None
    cli_args: list[str] | None = None
    hostname: str | None = None
    user: str | None = None


class ParamsRequest(BaseModel):
    params: dict[str, Any]


class SequencePoint(BaseModel):
    name: str
    step: int
    wall_time: str
    context: Any | None = None
    object_type: str
    scalar_value: float | None = None
    artifact_hash: str | None = None


class BatchRequest(BaseModel):
    points: list[SequencePoint]


class LogLine(BaseModel):
    stream: str
    wall_time: str
    line_no: int
    content: str
    content_raw: str | None = None  # optional ANSI-preserved for on-disk file


class LogsRequest(BaseModel):
    lines: list[LogLine]


class FinishRequest(BaseModel):
    status: str = Field(default="completed")
    exit_code: int | None = None


class TagsRequest(BaseModel):
    tags: list[str]


class NotesRequest(BaseModel):
    notes: str


class RunArtifactRequest(BaseModel):
    name: str
    hash: str
    step: int | None = None


# ---------- Helpers ---------------------------------------------------------


def _run_not_found(exc: ingest_ops.RunNotFound) -> HTTPException:
    return HTTPException(status_code=404, detail=str(exc))


# ---------- Routes ----------------------------------------------------------


@router.post("/runs")
def create_run(body: CreateRunRequest, request: Request) -> dict[str, Any]:
    db = get_db(request)
    try:
        return ingest_ops.create_run(
            db,
            project=body.project,
            name=body.name,
            tags=body.tags,
            notes=body.notes,
            env=body.env,
            git=body.git.model_dump() if body.git else None,
            cli_args=body.cli_args,
            hostname=body.hostname,
            user=body.user,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None


@router.post("/runs/{run_id}/params")
def set_params(run_id: str, body: ParamsRequest, request: Request) -> dict[str, Any]:
    db = get_db(request)
    try:
        updated = ingest_ops.set_params(db, run_id, body.params)
    except ingest_ops.RunNotFound as exc:
        raise _run_not_found(exc) from None
    return {"updated": updated}


@router.post("/runs/{run_id}/batch")
def post_batch(run_id: str, body: BatchRequest, request: Request) -> dict[str, Any]:
    db = get_db(request)
    points = [p.model_dump() for p in body.points]
    try:
        accepted = ingest_ops.insert_batch(db, run_id, points)
    except ingest_ops.RunNotFound as exc:
        raise _run_not_found(exc) from None
    except Exception as exc:  # noqa: BLE001
        # Duplicate (run_id, name, step, context_hash) → 409.
        raise HTTPException(status_code=409, detail=str(exc)) from None
    return {"accepted": accepted}


@router.post("/runs/{run_id}/logs")
def post_logs(run_id: str, body: LogsRequest, request: Request) -> dict[str, Any]:
    db = get_db(request)
    dd = get_data_dir(request)
    lines = [line.model_dump() for line in body.lines]
    try:
        accepted = ingest_ops.insert_logs(db, dd, run_id, lines)
    except ingest_ops.RunNotFound as exc:
        raise _run_not_found(exc) from None
    return {"accepted": accepted}


@router.head("/artifacts/{digest}")
def head_artifact(digest: str, request: Request) -> Response:
    blobs = get_blobs(request)
    if blobs.exists(digest):
        return Response(status_code=200)
    return Response(status_code=404)


#: Largest permitted multipart-part size. Starlette's default is 1 MiB,
#: which trips on videos, tensors, large figure sources, and on the source
#: manifest JSON for repos with many files (~150 bytes/entry × thousands of
#: files easily exceeds 1 MiB). 256 MiB is generous enough for any artifact
#: we realistically accept and still bounds memory on hostile input.
MAX_MULTIPART_PART_BYTES = 256 * 1024 * 1024


@router.post("/artifacts")
async def post_artifact(request: Request) -> dict[str, Any]:
    db = get_db(request)
    blobs = get_blobs(request)
    try:
        form = await request.form(max_part_size=MAX_MULTIPART_PART_BYTES)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"multipart error: {exc}") from None
    file = form.get("file")
    mime_type = form.get("mime_type")
    metadata = form.get("metadata", "{}")
    if file is None or not hasattr(file, "read"):
        raise HTTPException(status_code=400, detail="missing `file` multipart field")
    if not isinstance(mime_type, str):
        raise HTTPException(status_code=400, detail="missing `mime_type` form field")
    data = await file.read()
    try:
        meta_dict = json.loads(metadata) if metadata else {}
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="metadata must be JSON") from None
    return ingest_ops.put_artifact(db, blobs, data, mime_type, meta_dict)


@router.post("/runs/{run_id}/artifacts")
def attach_run_artifact(
    run_id: str, body: RunArtifactRequest, request: Request
) -> dict[str, Any]:
    db = get_db(request)
    blobs = get_blobs(request)
    try:
        ingest_ops.attach_artifact(db, blobs, run_id, body.name, body.hash, body.step)
    except ingest_ops.RunNotFound as exc:
        raise _run_not_found(exc) from None
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None
    return {"run_id": run_id, "name": body.name, "hash": body.hash}


@router.post("/runs/{run_id}/source")
async def post_source(run_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    dd = get_data_dir(request)
    try:
        form = await request.form(max_part_size=MAX_MULTIPART_PART_BYTES)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"multipart error: {exc}") from None
    archive = form.get("archive")
    manifest = form.get("manifest")
    if archive is None or not hasattr(archive, "read"):
        raise HTTPException(status_code=400, detail="missing `archive` multipart field")
    if not isinstance(manifest, str):
        raise HTTPException(status_code=400, detail="missing `manifest` form field")
    try:
        manifest_dict = json.loads(manifest)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="manifest must be JSON") from None
    data = await archive.read()
    try:
        return ingest_ops.save_source(db, dd, run_id, data, manifest_dict)
    except ingest_ops.RunNotFound as exc:
        raise _run_not_found(exc) from None


@router.post("/runs/{run_id}/finish")
def finish_run(
    run_id: str, body: FinishRequest, request: Request
) -> dict[str, Any]:
    db = get_db(request)
    try:
        ingest_ops.finish_run(db, run_id, body.status, body.exit_code)
    except ingest_ops.RunNotFound as exc:
        raise _run_not_found(exc) from None
    return {"run_id": run_id, "status": body.status}


@router.post("/runs/{run_id}/tags")
def set_tags(run_id: str, body: TagsRequest, request: Request) -> dict[str, Any]:
    db = get_db(request)
    try:
        ingest_ops.set_tags(db, run_id, body.tags)
    except ingest_ops.RunNotFound as exc:
        raise _run_not_found(exc) from None
    return {"run_id": run_id, "tags": body.tags}


@router.post("/runs/{run_id}/notes")
def set_notes(run_id: str, body: NotesRequest, request: Request) -> dict[str, Any]:
    db = get_db(request)
    try:
        ingest_ops.set_notes(db, run_id, body.notes)
    except ingest_ops.RunNotFound as exc:
        raise _run_not_found(exc) from None
    return {"run_id": run_id, "notes": body.notes}


@router.post("/runs/{run_id}/heartbeat")
def run_heartbeat(run_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    ingest_ops.heartbeat(db, run_id)
    return {"run_id": run_id}


@router.post("/runs/{run_id}/archive")
def archive_run(run_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    try:
        ingest_ops._require_run(db, run_id)
    except ingest_ops.RunNotFound as exc:
        raise _run_not_found(exc) from None
    db.write("UPDATE runs SET status = 'archived' WHERE id = ?", [run_id])
    return {"run_id": run_id, "status": "archived"}


@router.post("/runs/{run_id}/unarchive")
def unarchive_run(run_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    try:
        ingest_ops._require_run(db, run_id)
    except ingest_ops.RunNotFound as exc:
        raise _run_not_found(exc) from None
    db.write("UPDATE runs SET status = 'completed' WHERE id = ?", [run_id])
    return {"run_id": run_id, "status": "completed"}


@router.delete("/runs/{run_id}")
def delete_run(run_id: str, request: Request) -> dict[str, Any]:
    """Delete a run. Shared artifact blobs are not reference-counted."""
    db = get_db(request)
    dd = get_data_dir(request)
    try:
        ingest_ops.delete_run(db, dd, run_id)
    except ingest_ops.RunNotFound as exc:
        raise _run_not_found(exc) from None
    return {"deleted": run_id}
