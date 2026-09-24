"""Run archives: the ZIP that ``POST /api/export`` writes and both
``POST /api/import`` and ``cairn.Reader("runs.zip")`` read.

Layout::

    manifest.json                  {cairn_export_version, exported_at, run_ids}
    sweeps.json                    [{sweep: row, trials: [row]}] for the runs' sweeps
    artifacts/{hash}{ext}          blob bytes
    artifacts/{hash}.meta.json     the artifacts row
    {run_id}/run.json              {run, params, summary}
    {run_id}/sequences.json        sequences rows (without run_id)
    {run_id}/run_artifacts.json    run_artifacts rows (without run_id)
    {run_id}/metric_defs.json      metric_defs rows (without run_id)
    {run_id}/alerts.json           alerts rows
    {run_id}/logs/*, {run_id}/source/*

Table rows are written whole (``SELECT *``) and restored by column name,
keeping only the columns the target table has — a column added to ``runs``
or ``sequences`` round-trips without touching this module. What does need
code here is anything that REFERENCES an id: a restore either keeps the
archive's ids (``keep_ids``, the Reader's fresh temp repo) or mints new ones
(an import into a live repo), and in the latter case every run→run and
run→sweep reference is remapped through the id map, kept when the target
already exists in the repo, and set to NULL otherwise.
"""

from __future__ import annotations

import json
import mimetypes
import secrets
import zipfile
from typing import Any

from .routes._common import utc_now
from .storage.blobs import BlobStore
from .storage.datadir import DataDir
from .storage.db import Database

EXPORT_VERSION = 1

#: An image gallery's manifest blob — it names its images by hash. The same
#: wire constant as ``cairn.sdk.handlers.image.GALLERY_MIME`` (the server may
#: not import the SDK; a unit test pins the two together).
GALLERY_MIME = "application/vnd.cairn.image-gallery+json"


def _referenced_hashes(blobs: BlobStore, h: str, row: dict[str, Any] | None) -> list[str]:
    """Hashes of other artifacts this one names: a figure's ``source_hash``, a gallery's images."""
    if row is None:
        return []
    meta = row.get("metadata")
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except json.JSONDecodeError:
            meta = None
    refs = [meta["source_hash"]] if isinstance(meta, dict) and meta.get("source_hash") else []
    if row.get("mime_type") == GALLERY_MIME:
        data, _ = blobs.get(h)
        refs += [item["hash"] for item in json.loads(data)["images"]]
    return refs


def _without(rows: list[dict[str, Any]], key: str) -> list[dict[str, Any]]:
    for r in rows:
        r.pop(key, None)
    return rows


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------


def write_archive(
    db: Database,
    blobs: BlobStore,
    data_dir: DataDir,
    run_ids: list[str],
    zf: zipfile.ZipFile,
) -> None:
    """Write ``run_ids`` into ``zf``. Raises ``LookupError`` for an unknown run."""
    zf.writestr("manifest.json", json.dumps({
        "cairn_export_version": EXPORT_VERSION,
        "exported_at": utc_now().isoformat(),
        "run_ids": run_ids,
    }))

    seen_artifacts: set[str] = set()
    sweep_ids: set[str] = set()

    for run_id in run_ids:
        rows = db.read_columns("SELECT * FROM runs WHERE id = ?", [run_id])
        if not rows:
            raise LookupError(f"run {run_id} not found")
        run = rows[0]
        if run.get("sweep_id"):
            sweep_ids.add(run["sweep_id"])

        params = db.read_columns(
            "SELECT key, value, value_type FROM params WHERE run_id = ?", [run_id],
        )
        summary = db.read_columns(
            "SELECT key, value, value_type FROM summary WHERE run_id = ?", [run_id],
        )
        prefix = f"{run_id}/"
        zf.writestr(prefix + "run.json", json.dumps({
            "run": run,
            "params": params,
            "summary": summary,
        }, default=str, indent=2))

        seq_rows = _without(db.read_columns(
            "SELECT * FROM sequences WHERE run_id = ? ORDER BY name, step", [run_id],
        ), "run_id")
        zf.writestr(prefix + "sequences.json", json.dumps(seq_rows, default=str))

        named_arts = _without(db.read_columns(
            "SELECT * FROM run_artifacts WHERE run_id = ?", [run_id],
        ), "run_id")
        zf.writestr(prefix + "run_artifacts.json", json.dumps(named_arts, default=str))

        metric_defs = _without(db.read_columns(
            "SELECT * FROM metric_defs WHERE run_id = ?", [run_id],
        ), "run_id")
        zf.writestr(prefix + "metric_defs.json", json.dumps(metric_defs, default=str))

        alerts = db.read_columns("SELECT * FROM alerts WHERE run_id = ?", [run_id])
        zf.writestr(prefix + "alerts.json", json.dumps(alerts, default=str))

        # Artifact blobs (deduped across runs). An artifact can name others —
        # a figure its source, a gallery its images — so the queue grows as
        # referenced blobs are discovered.
        pending = [r["artifact_hash"] for r in seq_rows if r.get("artifact_hash")]
        pending += [r["hash"] for r in named_arts]
        while pending:
            h = pending.pop()
            if h in seen_artifacts:
                continue
            seen_artifacts.add(h)
            if not blobs.exists(h):
                continue
            meta_rows = db.read_columns(
                "SELECT mime_type, metadata, object_type FROM artifacts WHERE hash = ?", [h],
            )
            pending.extend(_referenced_hashes(blobs, h, meta_rows[0] if meta_rows else None))
            mime = meta_rows[0]["mime_type"] if meta_rows else "application/octet-stream"
            ext = mimetypes.guess_extension(mime) or ""
            data, _ = blobs.get(h)
            zf.writestr(f"artifacts/{h}{ext}", data)
            if meta_rows:
                zf.writestr(f"artifacts/{h}.meta.json", json.dumps(meta_rows[0], default=str))

        log_dir = data_dir.logs_dir / run_id
        if log_dir.is_dir():
            for log_file in log_dir.iterdir():
                if log_file.is_file():
                    zf.write(log_file, prefix + "logs/" + log_file.name)

        src_dir = data_dir.sources_dir / run_id
        if src_dir.is_dir():
            for src_file in src_dir.iterdir():
                if src_file.is_file():
                    zf.write(src_file, prefix + "source/" + src_file.name)

    sweeps = []
    for sweep_id in sorted(sweep_ids):
        rows = db.read_columns("SELECT * FROM sweeps WHERE id = ?", [sweep_id])
        if rows:
            trials = db.read_columns(
                "SELECT * FROM sweep_trials WHERE sweep_id = ? ORDER BY created_at", [sweep_id],
            )
            sweeps.append({"sweep": rows[0], "trials": trials})
    zf.writestr("sweeps.json", json.dumps(sweeps, default=str))


# ---------------------------------------------------------------------------
# Restore
# ---------------------------------------------------------------------------


def _columns(db: Database, table: str) -> list[str]:
    return [r[1] for r in db.read(f"PRAGMA table_info({table})")]


def _insert(db: Database, table: str, columns: list[str], row: dict[str, Any]) -> None:
    """INSERT the keys of ``row`` that are columns of ``table``.

    ``ON CONFLICT DO NOTHING`` rather than ``INSERT OR IGNORE``: a duplicate
    key is skipped, but a NOT NULL violation still raises instead of silently
    dropping the row.
    """
    cols = [c for c in columns if c in row]
    quoted = ", ".join('"' + c + '"' for c in cols)
    holes = ", ".join("?" * len(cols))
    db.write(
        f"INSERT INTO {table} ({quoted}) VALUES ({holes}) ON CONFLICT DO NOTHING",
        [row[c] for c in cols],
    )


def _read_json(zf: zipfile.ZipFile, name: str, default: Any) -> Any:
    if name not in zf.namelist():
        return default
    try:
        return json.loads(zf.read(name))
    except json.JSONDecodeError:
        return default


def _ensure_project(db: Database, project_id: str) -> None:
    db.write(
        "INSERT OR IGNORE INTO projects (id, name, created_at) VALUES (?, ?, ?)",
        [project_id, project_id, utc_now()],
    )


def _exists(db: Database, table: str, row_id: str) -> bool:
    return bool(db.read_columns(f"SELECT 1 FROM {table} WHERE id = ?", [row_id]))


def restore_archive(
    db: Database,
    blobs: BlobStore,
    data_dir: DataDir,
    zf: zipfile.ZipFile,
    *,
    keep_ids: bool,
) -> list[dict[str, str]]:
    """Restore every run in ``zf``. Returns ``[{original_id, new_id, name}]``.

    Raises ``ValueError`` when the archive has no readable manifest.
    """
    try:
        manifest = json.loads(zf.read("manifest.json"))
    except (KeyError, json.JSONDecodeError) as exc:
        raise ValueError("Missing or invalid manifest.json") from exc
    names = set(zf.namelist())

    # Artifacts first (shared across runs).
    for name in sorted(names):
        if not name.startswith("artifacts/") or name.endswith(".meta.json") or name.endswith("/"):
            continue
        basename = name.split("/", 1)[1]
        h = basename.rsplit(".", 1)[0] if "." in basename else basename
        if blobs.exists(h):
            continue
        meta_info = _read_json(zf, f"artifacts/{h}.meta.json", {})
        mime = meta_info.get("mime_type", "application/octet-stream")
        metadata = meta_info.get("metadata")
        if isinstance(metadata, str):
            try:
                metadata = json.loads(metadata)
            except json.JSONDecodeError:
                metadata = None
        digest, size = blobs.put(zf.read(name), mime, metadata)
        db.write(
            """INSERT OR IGNORE INTO artifacts
               (hash, mime_type, size_bytes, metadata, object_type, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            [digest, mime, size, json.dumps(metadata) if metadata else "{}",
             meta_info.get("object_type"), utc_now()],
        )

    run_ids = [rid for rid in manifest.get("run_ids", []) if f"{rid}/run.json" in names]
    run_map = {rid: rid if keep_ids else secrets.token_hex(16) for rid in run_ids}
    sweeps = _read_json(zf, "sweeps.json", [])
    sweep_map = {
        s["sweep"]["id"]: s["sweep"]["id"] if keep_ids else secrets.token_hex(8)
        for s in sweeps
    }

    def remap(table: str, id_map: dict[str, str], ref: str | None) -> str | None:
        if ref is None:
            return None
        if ref in id_map:
            return id_map[ref]
        return ref if _exists(db, table, ref) else None

    sweep_cols = _columns(db, "sweeps")
    for s in sweeps:
        sweep = dict(s["sweep"], id=sweep_map[s["sweep"]["id"]])
        _ensure_project(db, sweep["project_id"])
        _insert(db, "sweeps", sweep_cols, sweep)

    run_cols = _columns(db, "runs")
    seq_cols = _columns(db, "sequences")
    ra_cols = _columns(db, "run_artifacts")
    md_cols = _columns(db, "metric_defs")
    alert_cols = _columns(db, "alerts")
    imported: list[dict[str, str]] = []

    for original_id in run_ids:
        new_id = run_map[original_id]
        prefix = f"{original_id}/"
        run_data = _read_json(zf, prefix + "run.json", {})
        run = dict(run_data["run"])
        project_id = run.get("project_id") or "imported"
        _ensure_project(db, project_id)

        run.update(
            id=new_id,
            project_id=project_id,
            display_name=run.get("display_name") or original_id,
            created_at=run.get("created_at") or utc_now(),
            status=run.get("status") or "completed",
            parent_run_id=remap("runs", run_map, run.get("parent_run_id")),
            sweep_id=remap("sweeps", sweep_map, run.get("sweep_id")),
        )
        _insert(db, "runs", run_cols, run)

        for table in ("params", "summary"):
            for p in run_data.get(table, []):
                db.write(
                    f"INSERT OR IGNORE INTO {table} (run_id, key, value, value_type) VALUES (?, ?, ?, ?)",
                    [new_id, p["key"], p["value"], p.get("value_type", "str")],
                )

        for row in _read_json(zf, prefix + "sequences.json", []):
            row.setdefault("context_hash", "")
            row.setdefault("object_type", "scalar")
            row.setdefault("wall_time", "")
            _insert(db, "sequences", seq_cols, dict(row, run_id=new_id))

        for ra in _read_json(zf, prefix + "run_artifacts.json", []):
            _insert(db, "run_artifacts", ra_cols, dict(
                ra,
                run_id=new_id,
                step=ra["step"] if ra.get("step") is not None else -1,
                created_at=ra.get("created_at") or utc_now(),
            ))

        for md in _read_json(zf, prefix + "metric_defs.json", []):
            _insert(db, "metric_defs", md_cols, dict(md, run_id=new_id))

        for alert in _read_json(zf, prefix + "alerts.json", []):
            _insert(db, "alerts", alert_cols, dict(
                alert,
                id=alert["id"] if keep_ids else secrets.token_hex(16),
                run_id=new_id,
                project_id=project_id,
                # Imported alerts are history: never (re)deliver them.
                delivered_at=alert.get("delivered_at") or utc_now().isoformat(),
            ))

        for sub, target in (("logs/", data_dir.logs_dir), ("source/", data_dir.sources_dir)):
            sub_prefix = prefix + sub
            for name in names:
                if name.startswith(sub_prefix) and not name.endswith("/"):
                    dest = target / new_id
                    dest.mkdir(parents=True, exist_ok=True)
                    (dest / name[len(sub_prefix):]).write_bytes(zf.read(name))

        imported.append({
            "original_id": original_id,
            "new_id": new_id,
            "name": run["display_name"],
        })

    # Trials last: their run references resolve against the restored runs.
    trial_cols = _columns(db, "sweep_trials")
    for s in sweeps:
        for trial in s["trials"]:
            _insert(db, "sweep_trials", trial_cols, dict(
                trial,
                id=trial["id"] if keep_ids else secrets.token_hex(8),
                sweep_id=sweep_map[s["sweep"]["id"]],
                run_id=remap("runs", run_map, trial.get("run_id")),
            ))

    return imported
