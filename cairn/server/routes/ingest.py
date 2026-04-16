"""Ingest endpoints: SDK → server.

All endpoints are POST except ``HEAD /api/artifacts/{hash}`` for dedup.
"""

from __future__ import annotations

import json
import secrets
from typing import Any

from fastapi import (
    APIRouter,
    File,
    Form,
    HTTPException,
    Request,
    Response,
    UploadFile,
)
from pydantic import BaseModel, Field

from ..storage.migrations import hash_context
from ._common import (
    flatten,
    get_blobs,
    get_data_dir,
    get_db,
    require_run,
    slugify,
    utc_now,
    value_type,
)

router = APIRouter(prefix="/api", tags=["ingest"])


# ---------- Pydantic request models -----------------------------------------


class GitInfo(BaseModel):
    sha: str | None = None
    branch: str | None = None
    dirty: bool | None = None


class CreateRunRequest(BaseModel):
    project: str
    task: str
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


# ---------- Routes ----------------------------------------------------------


@router.post("/runs")
def create_run(body: CreateRunRequest, request: Request) -> dict[str, Any]:
    db = get_db(request)
    try:
        project_id = slugify(body.project)
        task_slug = slugify(body.task)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    task_id = f"{project_id}/{task_slug}"
    run_id = secrets.token_hex(6)
    now = utc_now()

    with db.transaction() as con:
        con.execute(
            """
            INSERT INTO projects (id, name, created_at, description, tags)
            VALUES (?, ?, ?, NULL, NULL)
            ON CONFLICT (id) DO NOTHING
            """,
            [project_id, body.project, now],
        )
        con.execute(
            """
            INSERT INTO tasks (id, project_id, name, created_at, description, tags)
            VALUES (?, ?, ?, ?, NULL, NULL)
            ON CONFLICT (id) DO NOTHING
            """,
            [task_id, project_id, body.task, now],
        )
        con.execute(
            """
            INSERT INTO runs (
                id, project_id, task_id, display_name, created_at, ended_at,
                status, exit_code, git_sha, git_dirty, git_branch,
                cli_args, env_snapshot, hostname, "user", tags, notes
            ) VALUES (?, ?, ?, ?, ?, NULL, 'running', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                run_id,
                project_id,
                task_id,
                body.name,
                now,
                body.git.sha if body.git else None,
                body.git.dirty if body.git else None,
                body.git.branch if body.git else None,
                json.dumps(body.cli_args) if body.cli_args is not None else None,
                json.dumps(body.env) if body.env is not None else None,
                body.hostname,
                body.user,
                json.dumps(body.tags) if body.tags is not None else None,
                body.notes,
            ],
        )

    return {
        "run_id": run_id,
        "project_id": project_id,
        "task_id": task_id,
        "url": f"/p/{project_id}/r/{run_id}",
    }


@router.post("/runs/{run_id}/params")
def set_params(run_id: str, body: ParamsRequest, request: Request) -> dict[str, Any]:
    db = get_db(request)
    require_run(db, run_id)
    flat = flatten(body.params)
    rows = [
        (run_id, k, json.dumps(v), value_type(v))
        for k, v in flat.items()
    ]
    # INSERT OR REPLACE (DuckDB uses ON CONFLICT DO UPDATE)
    with db.transaction() as con:
        for row in rows:
            con.execute(
                """
                INSERT INTO params (run_id, key, value, value_type)
                VALUES (?, ?, ?, ?)
                ON CONFLICT (run_id, key) DO UPDATE
                  SET value = EXCLUDED.value, value_type = EXCLUDED.value_type
                """,
                list(row),
            )
    return {"updated": len(rows)}


@router.post("/runs/{run_id}/batch")
def post_batch(run_id: str, body: BatchRequest, request: Request) -> dict[str, Any]:
    db = get_db(request)
    require_run(db, run_id)
    rows = []
    for p in body.points:
        ctx_json = json.dumps(p.context) if p.context is not None else None
        rows.append(
            (
                run_id,
                p.name,
                p.step,
                p.wall_time,
                ctx_json,
                hash_context(p.context),
                p.object_type,
                p.scalar_value,
                p.artifact_hash,
            )
        )
    sql = """
        INSERT INTO sequences (
            run_id, name, step, wall_time, context, context_hash,
            object_type, scalar_value, artifact_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """
    # Plain bulk insert; duplicate (run_id, name, step, context_hash) keys
    # will raise a constraint violation, which is the correct behavior for
    # a client that mis-emits the same step twice.
    try:
        db.executemany(sql, rows)
    except Exception as exc:  # noqa: BLE001
        # Re-raise as 409 rather than 500 so the client sees a distinguishable
        # error; we still log so server operators can see the offender.
        raise HTTPException(status_code=409, detail=str(exc)) from None
    return {"accepted": len(rows)}


@router.post("/runs/{run_id}/logs")
def post_logs(run_id: str, body: LogsRequest, request: Request) -> dict[str, Any]:
    db = get_db(request)
    dd = get_data_dir(request)
    require_run(db, run_id)
    rows = [
        (run_id, line.stream, line.wall_time, line.line_no, line.content)
        for line in body.lines
    ]
    db.executemany("INSERT INTO log_lines VALUES (?, ?, ?, ?, ?)", rows)
    # Append to on-disk log files, preserving ANSI if provided.
    log_dir = dd.run_log_dir(run_id)
    combined_path = log_dir / "combined.log"
    stream_paths: dict[str, Any] = {
        "stdout": log_dir / "stdout.log",
        "stderr": log_dir / "stderr.log",
    }
    with combined_path.open("a", encoding="utf-8") as comb_fh:
        for line in body.lines:
            raw = line.content_raw if line.content_raw is not None else line.content
            stream_path = stream_paths.get(line.stream)
            if stream_path is not None:
                with stream_path.open("a", encoding="utf-8") as fh:
                    fh.write(raw + "\n")
            comb_fh.write(f"[{line.stream}] {raw}\n")
    return {"accepted": len(rows)}


@router.head("/artifacts/{digest}")
def head_artifact(digest: str, request: Request) -> Response:
    blobs = get_blobs(request)
    if blobs.exists(digest):
        return Response(status_code=200)
    return Response(status_code=404)


@router.post("/artifacts")
async def post_artifact(
    request: Request,
    file: UploadFile = File(...),
    mime_type: str = Form(...),
    metadata: str = Form("{}"),
) -> dict[str, Any]:
    db = get_db(request)
    blobs = get_blobs(request)
    data = await file.read()
    try:
        meta_dict = json.loads(metadata) if metadata else {}
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="metadata must be JSON") from None
    digest, size = blobs.put(data, mime_type, meta_dict)
    db.write(
        """
        INSERT INTO artifacts (hash, mime_type, size_bytes, metadata, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (hash) DO NOTHING
        """,
        [digest, mime_type, size, json.dumps(meta_dict), utc_now()],
    )
    return {"hash": digest, "size_bytes": size}


@router.post("/runs/{run_id}/artifacts")
def attach_run_artifact(
    run_id: str, body: RunArtifactRequest, request: Request
) -> dict[str, Any]:
    """Attach a named (non-sequence) artifact to a run — backs ``run.log_artifact``."""
    db = get_db(request)
    blobs = get_blobs(request)
    require_run(db, run_id)
    if not blobs.exists(body.hash):
        raise HTTPException(status_code=404, detail=f"artifact {body.hash} unknown")
    step_val = -1 if body.step is None else body.step
    db.write(
        """
        INSERT INTO run_artifacts (run_id, name, hash, step, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (run_id, name, step) DO UPDATE
          SET hash = EXCLUDED.hash, created_at = EXCLUDED.created_at
        """,
        [run_id, body.name, body.hash, step_val, utc_now()],
    )
    return {"run_id": run_id, "name": body.name, "hash": body.hash}


@router.post("/runs/{run_id}/source")
async def post_source(
    run_id: str,
    request: Request,
    archive: UploadFile = File(...),
    manifest: str = Form(...),
) -> dict[str, Any]:
    db = get_db(request)
    dd = get_data_dir(request)
    require_run(db, run_id)
    try:
        manifest_dict = json.loads(manifest)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="manifest must be JSON") from None
    src_dir = dd.run_source_dir(run_id)
    archive_path = src_dir / "tree.tar.zst"
    manifest_path = src_dir / "manifest.json"
    data = await archive.read()
    archive_path.write_bytes(data)
    manifest_path.write_text(json.dumps(manifest_dict))
    return {
        "run_id": run_id,
        "archive_bytes": len(data),
        "num_files": len(manifest_dict.get("files", [])),
    }


@router.post("/runs/{run_id}/finish")
def finish_run(
    run_id: str, body: FinishRequest, request: Request
) -> dict[str, Any]:
    db = get_db(request)
    require_run(db, run_id)
    db.write(
        "UPDATE runs SET status = ?, ended_at = ?, exit_code = ? WHERE id = ?",
        [body.status, utc_now(), body.exit_code, run_id],
    )
    return {"run_id": run_id, "status": body.status}


@router.post("/runs/{run_id}/tags")
def set_tags(run_id: str, body: TagsRequest, request: Request) -> dict[str, Any]:
    db = get_db(request)
    require_run(db, run_id)
    db.write(
        "UPDATE runs SET tags = ? WHERE id = ?", [json.dumps(body.tags), run_id]
    )
    return {"run_id": run_id, "tags": body.tags}


@router.post("/runs/{run_id}/notes")
def set_notes(run_id: str, body: NotesRequest, request: Request) -> dict[str, Any]:
    db = get_db(request)
    require_run(db, run_id)
    db.write("UPDATE runs SET notes = ? WHERE id = ?", [body.notes, run_id])
    return {"run_id": run_id, "notes": body.notes}


@router.delete("/runs/{run_id}")
def delete_run(run_id: str, request: Request) -> dict[str, Any]:
    """Delete a run, its params, sequences, logs, and run-level artifact rows.

    Shared artifact blobs are NOT reference-counted — they remain on disk. That
    matches the spec's "no automatic deletion" retention policy.
    """
    db = get_db(request)
    dd = get_data_dir(request)
    require_run(db, run_id)
    # DuckDB FK enforcement inside an explicit transaction doesn't recognize
    # deleted child rows; run each DELETE as its own auto-committed statement.
    db.write("DELETE FROM sequences WHERE run_id = ?", [run_id])
    db.write("DELETE FROM params WHERE run_id = ?", [run_id])
    db.write("DELETE FROM log_lines WHERE run_id = ?", [run_id])
    db.write("DELETE FROM run_artifacts WHERE run_id = ?", [run_id])
    db.write("DELETE FROM runs WHERE id = ?", [run_id])
    # Remove per-run on-disk dirs (best-effort).
    import shutil

    for d in (dd.logs_dir / run_id, dd.sources_dir / run_id):
        if d.exists():
            shutil.rmtree(d, ignore_errors=True)
    return {"deleted": run_id}
