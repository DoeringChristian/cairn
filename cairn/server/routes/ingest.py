"""Ingest endpoints: SDK → server.

Thin HTTP wrappers around ``cairn.server.ingest_ops``. All actual DB logic
lives there so it can be reused by the local-mode SDK transport.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
from typing import Any, Callable, TypeVar

import anyio
import anyio.to_thread
from fastapi import (
    APIRouter,
    BackgroundTasks,
    HTTPException,
    Request,
    Response,
)
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, Field, ValidationError

from .. import ingest_ops
from ._common import get_blobs, get_data_dir, get_db

router = APIRouter(prefix="/api", tags=["ingest"])


# ---------- Pydantic request models -----------------------------------------


class GitInfo(BaseModel):
    sha: str | None = None
    branch: str | None = None
    dirty: bool | None = None
    remote: str | None = None


class CreateRunRequest(BaseModel):
    project: str
    run_id: str | None = None
    name: str | None = None
    tags: list[str] | None = None
    notes: str | None = None
    env: dict[str, Any] | None = None
    git: GitInfo | None = None
    cli_args: list[str] | None = None
    hostname: str | None = None
    user: str | None = None
    #: ISO-8601; backdates the run (imports). Default: now.
    created_at: str | None = None
    group: str | None = None
    job_type: str | None = None
    sweep_id: str | None = None
    parent_run_id: str | None = None
    fork_step: int | None = None


class ParamsRequest(BaseModel):
    params: dict[str, Any]


class SummaryRequest(BaseModel):
    summary: dict[str, Any]


class SequencePoint(BaseModel):
    name: str
    step: int
    wall_time: str
    object_type: str
    scalar_value: float | None = None
    artifact_hash: str | None = None
    metadata: dict[str, Any] | None = None


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
    #: ISO-8601; when the run actually ended (imports). Default: now.
    ended_at: str | None = None


class TagsRequest(BaseModel):
    tags: list[str]


class NotesRequest(BaseModel):
    notes: str


class RunPatchRequest(BaseModel):
    display_name: str | None = None
    notes: str | None = None


class DeleteKeysRequest(BaseModel):
    keys: list[str]

class AlertRequest(BaseModel):
    title: str
    text: str = ""
    level: str = "info"
    #: Client-generated (idempotent WAL replay). Default: a fresh id.
    alert_id: str | None = None
    created_at: str | None = None


# ---------- Helpers ---------------------------------------------------------

T = TypeVar("T")
M = TypeVar("M", bound=BaseModel)

#: Threads that do the bulk ingest work (points, logs, uploads). It all
#: queues on the database's one write lock anyway, so more threads would
#: only wait there -- while holding threads of the shared pool that every
#: page load needs. A request beyond these waits on the event loop instead.
INGEST_THREADS = 4


def _ingest_limiter(request: Request) -> anyio.CapacityLimiter:
    state = request.app.state
    limiter = getattr(state, "ingest_limiter", None)
    if limiter is None:  # created on first use, inside the app's event loop
        limiter = state.ingest_limiter = anyio.CapacityLimiter(INGEST_THREADS)
    return limiter


async def _ingest_thread(request: Request, fn: Callable[[], T]) -> T:
    """Run ``fn`` on an ingest thread: never on the event loop, where a wait
    for the write lock (or a large body's parse) would stall every request."""
    return await anyio.to_thread.run_sync(fn, limiter=_ingest_limiter(request))


def _parse(model: type[M], body: bytes) -> M:
    """``body`` as ``model``, or the 422 FastAPI gives a declared body."""
    try:
        return model.model_validate_json(body)
    except ValidationError as exc:
        raise RequestValidationError(exc.errors(include_url=False)) from None


def _json_body(model: type[BaseModel]) -> dict[str, Any]:
    """OpenAPI for a route that parses its JSON body itself (``_parse``)."""
    return {"requestBody": {"required": True, "content": {
        "application/json": {"schema": model.model_json_schema()},
    }}}


def _run_not_found(exc: ingest_ops.RunNotFound) -> HTTPException:
    return HTTPException(status_code=404, detail=str(exc))


# ---------- Routes ----------------------------------------------------------


@router.post("/runs")
def create_run(body: CreateRunRequest, request: Request) -> dict[str, Any]:
    db = get_db(request)
    try:
        return ingest_ops.create_run(db, **body.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None


@router.post("/runs/{run_id}/params")
def set_params(run_id: str, body: ParamsRequest, request: Request) -> dict[str, Any]:
    db = get_db(request)
    try:
        updated = ingest_ops.set_params(db, run_id, body.params)
    except ingest_ops.RunNotFound as exc:
        raise _run_not_found(exc) from None
    except (TypeError, ValueError) as exc:  # non-JSON value, flat-key collision
        raise HTTPException(status_code=400, detail=str(exc)) from None
    return {"updated": updated}


@router.post("/runs/{run_id}/summary")
def set_summary(run_id: str, body: SummaryRequest, request: Request) -> dict[str, Any]:
    db = get_db(request)
    try:
        updated = ingest_ops.set_summary(db, run_id, body.summary)
    except ingest_ops.RunNotFound as exc:
        raise _run_not_found(exc) from None
    except (TypeError, ValueError) as exc:  # non-JSON value, flat-key collision
        raise HTTPException(status_code=400, detail=str(exc)) from None
    return {"updated": updated}


@router.post("/runs/{run_id}/batch", openapi_extra=_json_body(BatchRequest))
async def post_batch(run_id: str, request: Request) -> dict[str, Any]:
    # The body is parsed on the ingest thread too: a large batch's JSON and
    # validation would otherwise hold the event loop.
    body = await request.body()
    db = get_db(request)

    def work() -> int:
        points = [p.model_dump() for p in _parse(BatchRequest, body).points]
        return ingest_ops.insert_batch(db, run_id, points)

    try:
        accepted = await _ingest_thread(request, work)
    except ingest_ops.RunNotFound as exc:
        raise _run_not_found(exc) from None
    except sqlite3.IntegrityError as exc:
        # A constraint the batch violates: final, so 409. Anything else (a
        # locked database, say) stays a 5xx, which a client may retry.
        raise HTTPException(status_code=409, detail=str(exc)) from None
    return {"accepted": accepted}


@router.post("/runs/{run_id}/logs", openapi_extra=_json_body(LogsRequest))
async def post_logs(run_id: str, request: Request) -> dict[str, Any]:
    body = await request.body()
    db = get_db(request)
    dd = get_data_dir(request)

    def work() -> int:
        lines = [line.model_dump() for line in _parse(LogsRequest, body).lines]
        return ingest_ops.insert_logs(db, dd, run_id, lines)

    try:
        accepted = await _ingest_thread(request, work)
    except ingest_ops.RunNotFound as exc:
        raise _run_not_found(exc) from None
    return {"accepted": accepted}


@router.head("/artifacts/{digest}")
def head_artifact(digest: str, request: Request) -> Response:
    """200 if the blob is stored. A client that gets 200 skips the upload and
    names the hash later, so this refreshes the blob's mtime like a ``put``:
    garbage collection spares it for its grace period."""
    blobs = get_blobs(request)
    if blobs.touch(digest):
        return Response(status_code=200)
    return Response(status_code=404)


@router.post("/ingest/pending")
async def ingest_pending(request: Request) -> dict[str, Any]:
    """Apply every pending run log now (``wal_ingest.ingest_all``), for a
    local run that needs an answer that depends on its own log (resume,
    ``use_artifact``). Only the lease-holding app ingests."""
    from ..wal_ingest import has_pending, ingest_all

    lease = getattr(request.app.state, "lease", None)
    if lease is None:
        raise HTTPException(status_code=409, detail="this app does not ingest run logs")
    db = get_db(request)
    dd = get_data_dir(request)
    blobs = get_blobs(request)
    ops = await anyio.to_thread.run_sync(
        lambda: ingest_all(dd, db, blobs) if has_pending(dd, db) else 0,
    )
    return {"ops": ops}


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
    object_type = form.get("object_type")
    if file is None or not hasattr(file, "read"):
        raise HTTPException(status_code=400, detail="missing `file` multipart field")
    if not isinstance(mime_type, str):
        raise HTTPException(status_code=400, detail="missing `mime_type` form field")
    data = await file.read()
    try:
        meta_dict = json.loads(metadata) if metadata else {}
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="metadata must be JSON") from None
    obj_type = object_type if isinstance(object_type, str) else None
    # Hashing, the blob write and the row insert (which waits for the write
    # lock) all block: off the event loop.
    return await _ingest_thread(request, lambda: ingest_ops.put_artifact(
        db, blobs, data, mime_type, meta_dict, object_type=obj_type,
    ))


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
        return await _ingest_thread(
            request, lambda: ingest_ops.save_source(db, dd, run_id, data, manifest_dict),
        )
    except ingest_ops.RunNotFound as exc:
        raise _run_not_found(exc) from None


@router.post("/runs/{run_id}/finish")
def finish_run(
    run_id: str, body: FinishRequest, request: Request
) -> dict[str, Any]:
    db = get_db(request)
    try:
        ingest_ops.finish_run(db, run_id, body.status, body.exit_code, body.ended_at)
    except ingest_ops.RunNotFound as exc:
        raise _run_not_found(exc) from None
    except ValueError as exc:  # unparseable ended_at
        raise HTTPException(status_code=400, detail=str(exc)) from None
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


@router.patch("/runs/{run_id}")
def patch_run(run_id: str, body: RunPatchRequest, request: Request) -> dict[str, Any]:
    """Edit a run's name and/or notes; omitted fields stay as they are."""
    db = get_db(request)
    try:
        if body.display_name is not None:
            ingest_ops.rename_run(db, run_id, body.display_name)
        if body.notes is not None:
            ingest_ops.set_notes(db, run_id, body.notes)
    except ingest_ops.RunNotFound as exc:
        raise _run_not_found(exc) from None
    return {"run_id": run_id, **body.model_dump(exclude_none=True)}


@router.delete("/runs/{run_id}/params")
def delete_params(run_id: str, body: DeleteKeysRequest, request: Request) -> dict[str, Any]:
    return _delete_keys(request, run_id, "params", body.keys)


@router.delete("/runs/{run_id}/summary")
def delete_summary(run_id: str, body: DeleteKeysRequest, request: Request) -> dict[str, Any]:
    return _delete_keys(request, run_id, "summary", body.keys)


def _delete_keys(request: Request, run_id: str, table: str, keys: list[str]) -> dict[str, Any]:
    try:
        ingest_ops.delete_keys(get_db(request), run_id, table, keys)
    except ingest_ops.RunNotFound as exc:
        raise _run_not_found(exc) from None
    return {"run_id": run_id, "deleted": keys}


@router.post("/runs/{run_id}/heartbeat")
def run_heartbeat(run_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    return {"run_id": run_id, "stop_requested": ingest_ops.heartbeat(db, run_id)}


@router.post("/runs/{run_id}/alerts")
def create_alert(run_id: str, body: AlertRequest, request: Request) -> dict[str, Any]:
    """Record an alert; the server's background task delivers it."""
    db = get_db(request)
    try:
        alert_id = ingest_ops.insert_alert(
            db, run_id, body.title, body.text, body.level,
            alert_id=body.alert_id, created_at=body.created_at,
        )
    except ingest_ops.RunNotFound as exc:
        raise _run_not_found(exc) from None
    except ValueError as exc:  # bad level / timestamp
        raise HTTPException(status_code=400, detail=str(exc)) from None
    return {"id": alert_id, "run_id": run_id}


@router.post("/runs/{run_id}/stop")
def stop_run(run_id: str, request: Request) -> dict[str, Any]:
    """Ask a running run to stop (the SDK polls this on its heartbeat)."""
    db = get_db(request)
    try:
        stop_requested = ingest_ops.request_stop(db, run_id)
    except ingest_ops.RunNotFound as exc:
        raise _run_not_found(exc) from None
    if stop_requested is None:
        raise HTTPException(status_code=409, detail="run is not running")
    return {"run_id": run_id, "stop_requested": stop_requested}


class MetricRuleRequest(BaseModel):
    name: str
    x: str | None = None
    summary: str | None = None


@router.post("/runs/{run_id}/metric-rules")
def set_metric_rule(run_id: str, body: MetricRuleRequest, request: Request) -> dict[str, Any]:
    try:
        ingest_ops.set_metric_rule(
            get_db(request), run_id, body.name, body.x, body.summary,
        )
    except ingest_ops.RunNotFound as exc:
        raise _run_not_found(exc) from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    return {"run_id": run_id, **body.model_dump()}


class RewindRequest(BaseModel):
    step: int


class ForkRequest(BaseModel):
    """The fork step, the child's id, and the child's own create fields."""

    step: int
    new_id: str | None = None
    name: str | None = None
    tags: list[str] | None = None
    notes: str | None = None
    env: dict[str, Any] | None = None
    git: GitInfo | None = None
    cli_args: list[str] | None = None
    hostname: str | None = None
    user: str | None = None
    group: str | None = None
    job_type: str | None = None
    sweep_id: str | None = None


@router.post("/runs/{run_id}/resume")
def resume_run(run_id: str, request: Request) -> dict[str, Any]:
    try:
        return ingest_ops.resume_run(get_db(request), run_id)
    except ingest_ops.RunNotFound as exc:
        raise _run_not_found(exc) from None


@router.post("/runs/{run_id}/rewind")
def rewind_run(run_id: str, body: RewindRequest, request: Request) -> dict[str, Any]:
    try:
        return ingest_ops.rewind_run(get_db(request), run_id, body.step)
    except ingest_ops.RunNotFound as exc:
        raise _run_not_found(exc) from None


@router.post("/runs/{run_id}/fork")
def fork_run(run_id: str, body: ForkRequest, request: Request) -> dict[str, Any]:
    fields = body.model_dump(exclude={"step", "new_id"})
    try:
        return ingest_ops.fork_run(
            get_db(request), parent_id=run_id, step=body.step, run_id=body.new_id,
            **fields,
        )
    except ingest_ops.RunNotFound as exc:
        raise _run_not_found(exc) from None


@router.post("/runs/{run_id}/archive")
def archive_run(run_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    try:
        ingest_ops._require_run(db, run_id)
    except ingest_ops.RunNotFound as exc:
        raise _run_not_found(exc) from None
    archived_at = ingest_ops.set_archived(db, run_id, True)
    return {"run_id": run_id, "archived": True, "archived_at": archived_at}


@router.post("/runs/{run_id}/unarchive")
def unarchive_run(run_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    try:
        ingest_ops._require_run(db, run_id)
    except ingest_ops.RunNotFound as exc:
        raise _run_not_found(exc) from None
    ingest_ops.set_archived(db, run_id, False)
    return {"run_id": run_id, "archived": False, "archived_at": None}


@router.delete("/runs/{run_id}")
def delete_run(run_id: str, request: Request, background: BackgroundTasks) -> dict[str, Any]:
    """Delete a run. Its blobs may be shared: the server collects the ones
    nothing references any more in the background (``gc.collect``)."""
    db = get_db(request)
    dd = get_data_dir(request)
    try:
        ingest_ops.delete_run(db, dd, run_id)
    except ingest_ops.RunNotFound as exc:
        raise _run_not_found(exc) from None
    if getattr(request.app.state, "lease", None) is not None:
        background.add_task(_collect_garbage, request.app)
    return {"deleted": run_id}


_gc_lock = threading.Lock()
_gc_again = threading.Event()


def _collect_garbage(app: Any) -> None:
    """Background GC after run deletions: one at a time; deletions during a
    collection make it run once more."""
    from .. import gc

    _gc_again.set()
    if not _gc_lock.acquire(blocking=False):
        return
    try:
        while _gc_again.is_set():
            _gc_again.clear()
            lease = getattr(app.state, "lease", None)
            if lease is None or not lease.valid():
                return
            gc.collect(app.state.db, app.state.data_dir, app.state.blobs)
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).exception("garbage collection failed")
    finally:
        _gc_lock.release()


@router.post("/gc")
async def collect_garbage(request: Request, dry_run: bool = False) -> dict[str, Any]:
    """Delete blobs nothing references that are older than a day (``cairn gc``).
    Returns the count and bytes freed (what would be, with ``dry_run``)."""
    from .. import gc

    db = get_db(request)
    dd = get_data_dir(request)
    blobs = get_blobs(request)
    return await anyio.to_thread.run_sync(lambda: gc.collect(db, dd, blobs, dry_run=dry_run))
