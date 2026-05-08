"""Export and import runs as ZIP archives.

Export bundles run metadata, params, sequences, artifacts, logs, and
source code into a single ZIP that can be imported into another Cairn
instance.
"""

from __future__ import annotations

import io
import json
import mimetypes
import secrets
import zipfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ._common import get_blobs, get_data_dir, get_db, utc_now

router = APIRouter(prefix="/api", tags=["import-export"])

EXPORT_VERSION = 1


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

class ExportRequest(BaseModel):
    run_ids: list[str]


@router.post("/export")
def export_runs(body: ExportRequest, request: Request) -> StreamingResponse:
    db = get_db(request)
    blobs = get_blobs(request)
    data_dir = get_data_dir(request)

    if not body.run_ids:
        raise HTTPException(status_code=400, detail="run_ids must not be empty")

    buf = io.BytesIO()
    seen_artifacts: set[str] = set()

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # Write manifest.
        zf.writestr("manifest.json", json.dumps({
            "cairn_export_version": EXPORT_VERSION,
            "exported_at": utc_now().isoformat(),
            "run_ids": body.run_ids,
        }))

        for run_id in body.run_ids:
            rows = db.read_columns("SELECT * FROM runs WHERE id = ?", [run_id])
            if not rows:
                raise HTTPException(status_code=404, detail=f"run {run_id} not found")
            run = rows[0]

            params = db.read_columns(
                "SELECT key, value, value_type FROM params WHERE run_id = ?", [run_id],
            )

            prefix = f"{run_id}/"

            # run.json — metadata + params.
            zf.writestr(prefix + "run.json", json.dumps({
                "run": run,
                "params": params,
            }, default=str, indent=2))

            # sequences.json — all sequence points.
            seq_rows = db.read_columns(
                """SELECT name, step, wall_time, context, context_hash,
                          object_type, scalar_value, artifact_hash
                   FROM sequences WHERE run_id = ?
                   ORDER BY name, step""",
                [run_id],
            )
            zf.writestr(prefix + "sequences.json", json.dumps(seq_rows, default=str))

            # Artifacts — collect unique hashes from sequences + run_artifacts.
            art_hashes: set[str] = set()
            for row in seq_rows:
                h = row.get("artifact_hash")
                if h:
                    art_hashes.add(h)

            named_arts = db.read_columns(
                "SELECT name, hash, step FROM run_artifacts WHERE run_id = ?", [run_id],
            )
            for row in named_arts:
                art_hashes.add(row["hash"])
            zf.writestr(prefix + "run_artifacts.json", json.dumps(named_arts, default=str))

            # Write artifact blobs (deduped across runs).
            for h in art_hashes:
                if h in seen_artifacts:
                    continue
                seen_artifacts.add(h)
                if not blobs.exists(h):
                    continue
                meta_rows = db.read_columns(
                    "SELECT mime_type, metadata, object_type FROM artifacts WHERE hash = ?", [h],
                )
                mime = meta_rows[0]["mime_type"] if meta_rows else "application/octet-stream"
                ext = mimetypes.guess_extension(mime) or ""
                data, _ = blobs.get(h)
                zf.writestr(f"artifacts/{h}{ext}", data)
                # Also store artifact DB metadata.
                if meta_rows:
                    zf.writestr(f"artifacts/{h}.meta.json", json.dumps(meta_rows[0], default=str))

            # Logs.
            log_dir = data_dir.logs_dir / run_id
            if log_dir.is_dir():
                for log_file in log_dir.iterdir():
                    if log_file.is_file():
                        zf.write(log_file, prefix + "logs/" + log_file.name)

            # Source archive.
            src_dir = data_dir.sources_dir / run_id
            if src_dir.is_dir():
                for src_file in src_dir.iterdir():
                    if src_file.is_file():
                        zf.write(src_file, prefix + "source/" + src_file.name)

    buf.seek(0)
    timestamp = utc_now().strftime("%Y%m%d_%H%M%S")
    filename = f"cairn_export_{timestamp}.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------

@router.post("/import")
async def import_runs(request: Request, file: UploadFile = File(...)) -> dict[str, Any]:
    db = get_db(request)
    blobs = get_blobs(request)
    data_dir = get_data_dir(request)

    content = await file.read()
    try:
        zf = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Invalid ZIP file")

    # Read manifest.
    try:
        manifest = json.loads(zf.read("manifest.json"))
    except (KeyError, json.JSONDecodeError):
        raise HTTPException(status_code=400, detail="Missing or invalid manifest.json")

    run_ids = manifest.get("run_ids", [])
    imported: list[dict[str, str]] = []

    # First pass: restore artifacts (shared across runs).
    for name in zf.namelist():
        if name.startswith("artifacts/") and not name.endswith(".meta.json") and not name.endswith("/"):
            # Extract hash from filename: artifacts/{hash}.{ext}
            basename = name.split("/", 1)[1]
            h = basename.rsplit(".", 1)[0] if "." in basename else basename
            if blobs.exists(h):
                continue
            data = zf.read(name)
            # Read meta if available.
            meta_name = f"artifacts/{h}.meta.json"
            mime = "application/octet-stream"
            metadata: dict[str, Any] | None = None
            if meta_name in zf.namelist():
                try:
                    meta_info = json.loads(zf.read(meta_name))
                    mime = meta_info.get("mime_type", mime)
                    metadata = json.loads(meta_info["metadata"]) if isinstance(meta_info.get("metadata"), str) else meta_info.get("metadata")
                except (json.JSONDecodeError, KeyError):
                    pass
            digest, size = blobs.put(data, mime, metadata)
            # Insert into artifacts table.
            db.write(
                """INSERT OR IGNORE INTO artifacts (hash, mime_type, size_bytes, metadata, created_at)
                   VALUES (?, ?, ?, ?, ?)""",
                [digest, mime, size, json.dumps(metadata) if metadata else "{}", utc_now().isoformat()],
            )

    # Second pass: restore each run.
    for original_id in run_ids:
        prefix = f"{original_id}/"
        run_json_name = prefix + "run.json"
        if run_json_name not in zf.namelist():
            continue

        run_data = json.loads(zf.read(run_json_name))
        run = run_data["run"]
        params = run_data.get("params", [])

        new_id = secrets.token_hex(6)

        # Ensure project exists.
        project_id = run.get("project_id", "imported")
        existing = db.read_columns("SELECT id FROM projects WHERE id = ?", [project_id])
        if not existing:
            db.write(
                "INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)",
                [project_id, project_id, utc_now().isoformat()],
            )

        # Insert run.
        db.write(
            """INSERT INTO runs (id, project_id, display_name, created_at, ended_at,
                                 status, exit_code, git_sha, git_dirty, git_branch,
                                 cli_args, env_snapshot, hostname, "user", tags, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                new_id,
                project_id,
                run.get("display_name") or run.get("id", original_id),
                run.get("created_at", utc_now().isoformat()),
                run.get("ended_at"),
                run.get("status", "completed"),
                run.get("exit_code"),
                run.get("git_sha"),
                run.get("git_dirty"),
                run.get("git_branch"),
                run.get("cli_args"),
                run.get("env_snapshot"),
                run.get("hostname"),
                run.get("user"),
                run.get("tags"),
                run.get("notes"),
            ],
        )

        # Insert params.
        for p in params:
            db.write(
                "INSERT OR IGNORE INTO params (run_id, key, value, value_type) VALUES (?, ?, ?, ?)",
                [new_id, p["key"], p["value"], p.get("value_type", "str")],
            )

        # Insert sequences.
        seq_json_name = prefix + "sequences.json"
        if seq_json_name in zf.namelist():
            seq_rows = json.loads(zf.read(seq_json_name))
            for row in seq_rows:
                db.write(
                    """INSERT OR IGNORE INTO sequences
                       (run_id, name, step, wall_time, context, context_hash,
                        object_type, scalar_value, artifact_hash)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    [
                        new_id,
                        row["name"],
                        row["step"],
                        row.get("wall_time", ""),
                        row.get("context"),
                        row.get("context_hash", ""),
                        row.get("object_type", "scalar"),
                        row.get("scalar_value"),
                        row.get("artifact_hash"),
                    ],
                )

        # Restore run_artifacts.
        ra_name = prefix + "run_artifacts.json"
        if ra_name in zf.namelist():
            try:
                named_arts = json.loads(zf.read(ra_name))
                for ra in named_arts:
                    db.write(
                        "INSERT OR IGNORE INTO run_artifacts (run_id, name, hash, step) VALUES (?, ?, ?, ?)",
                        [new_id, ra["name"], ra["hash"], ra.get("step", -1)],
                    )
            except (json.JSONDecodeError, KeyError):
                pass

        # Restore logs.
        log_prefix = prefix + "logs/"
        run_log_dir = data_dir.logs_dir / new_id
        for name in zf.namelist():
            if name.startswith(log_prefix) and not name.endswith("/"):
                fname = name[len(log_prefix):]
                run_log_dir.mkdir(parents=True, exist_ok=True)
                (run_log_dir / fname).write_bytes(zf.read(name))

        # Restore source.
        src_prefix = prefix + "source/"
        for name in zf.namelist():
            if name.startswith(src_prefix) and not name.endswith("/"):
                fname = name[len(src_prefix):]
                run_src_dir = data_dir.sources_dir / new_id
                run_src_dir.mkdir(parents=True, exist_ok=True)
                (run_src_dir / fname).write_bytes(zf.read(name))

        imported.append({
            "original_id": original_id,
            "new_id": new_id,
            "name": run.get("display_name") or original_id,
        })

    return {"imported": imported}
