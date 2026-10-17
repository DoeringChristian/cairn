"""Run archives: the ZIP that ``POST /api/export`` writes and both
``POST /api/import`` and ``cairn.Reader("runs.zip")`` read.

Layout:

```text
manifest.json                  {cairn_export_version, exported_at, run_ids}
sweeps.json                    [{sweep: row, trials: [row]}] for the runs' sweeps
artifact_registry.json         {families, versions, entries, aliases, inputs}: the
                               versions the runs produced or consumed, their
                               families, entries and aliases, and the runs'
                               input records
run_links.json                 run_links rows (``use_run``) with either end in
                               the archive; restored when both ends resolve
artifacts/{hash}{ext}          blob bytes
artifacts/{hash}.meta.json     the artifacts row
{run_id}/run.json              {run}: the runs row, with its config / summary
                               documents (the flat index is rebuilt on restore)
{run_id}/sequences.json        sequences rows (without run_id)
{run_id}/metric_defs.json      metric_defs rows (without run_id)
{run_id}/alerts.json           alerts rows
{run_id}/logs.json             authoritative captured console rows
{run_id}/logs/*, {run_id}/source/*
```

Table rows are written whole (``SELECT *``) and restored by column name,
keeping only the columns the target table has — a column added to ``runs``
or ``sequences`` round-trips without touching this module. What does need
code here is anything that REFERENCES an id: a restore either keeps the
archive's ids (``keep_ids``, the Reader's fresh temp repo) or mints new ones
(an import into a live repo), and in the latter case every run→run and
run→sweep reference is remapped through the id map, kept when the target
already exists in the repo, and set to NULL otherwise.

Registry rows merge into the target by name: a family matching an existing
``(project, name)`` is that family. Versions are appended (keeping their
number when free); equal content does not collapse distinct versions.
Existing aliases are never moved, except ``latest`` follows the newest version.
"""

from __future__ import annotations

import json
import hashlib
import logging
import mimetypes
import os
from pathlib import PurePosixPath
import re
import secrets
import stat
import zipfile
from typing import Any, Callable

from cairn.backend import config_doc, ingest_ops, progress
from cairn.backend.artifact_refs import referenced_hashes
from cairn.backend.common import utc_now
from cairn.backend.storage.blobs import BlobStore
from cairn.backend.storage.datadir import DataDir
from cairn.backend.storage.db import Database
from cairn.backend.storage.metric_stats import rebuild_metric_stats

EXPORT_VERSION = 1
log = logging.getLogger(__name__)


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
    _validate_run_ids(run_ids)
    zf.writestr("manifest.json", json.dumps({
        "cairn_export_version": EXPORT_VERSION,
        "exported_at": utc_now().isoformat(),
        "run_ids": run_ids,
    }))

    seen_artifacts: set[str] = set()
    sweep_ids: set[str] = set()

    def write_blobs(pending: list[str]) -> None:
        """Artifact blobs (deduped across runs). An artifact can name others —
        a figure its source, a gallery its items, a manifest its files — so
        the queue grows as referenced blobs are discovered."""
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
            pending.extend(referenced_hashes(blobs, h, meta_rows[0] if meta_rows else None))
            mime = meta_rows[0]["mime_type"] if meta_rows else "application/octet-stream"
            ext = mimetypes.guess_extension(mime) or ""
            data = blobs.get(h)
            zf.writestr(f"artifacts/{h}{ext}", data)
            if meta_rows:
                zf.writestr(f"artifacts/{h}.meta.json", json.dumps(meta_rows[0], default=str))

    for run_id in run_ids:
        rows = db.read_columns("SELECT * FROM runs WHERE id = ?", [run_id])
        if not rows:
            raise LookupError(f"run {run_id} not found")
        run = rows[0]
        if run.get("sweep_id"):
            sweep_ids.add(run["sweep_id"])

        prefix = f"{run_id}/"
        zf.writestr(prefix + "run.json", json.dumps({"run": run}, default=str, indent=2))

        seq_rows = _without(db.read_columns(
            "SELECT * FROM sequences WHERE run_id = ? ORDER BY name, step", [run_id],
        ), "run_id")
        zf.writestr(prefix + "sequences.json", json.dumps(seq_rows, default=str))
        record_rows = _without(db.read_columns(
            'SELECT * FROM run_records WHERE run_id=? ORDER BY event_id', [run_id]), 'run_id')
        zf.writestr(prefix + 'records.json', json.dumps(record_rows))
        from .records import media_hashes
        for record in record_rows:
            write_blobs(list(media_hashes(json.loads(record['values_json']))))

        metric_defs = _without(db.read_columns(
            "SELECT * FROM metric_defs WHERE run_id = ?", [run_id],
        ), "run_id")
        zf.writestr(prefix + "metric_defs.json", json.dumps(metric_defs, default=str))

        alerts = db.read_columns("SELECT * FROM alerts WHERE run_id = ?", [run_id])
        zf.writestr(prefix + "alerts.json", json.dumps(alerts, default=str))
        console = _without(db.read_columns(
            'SELECT * FROM log_lines WHERE run_id=? ORDER BY wall_time, label, line_no', [run_id],
        ), 'run_id')
        zf.writestr(prefix + 'logs.json', json.dumps(console, default=str))

        write_blobs([r["artifact_hash"] for r in seq_rows if r.get("artifact_hash")])

        log_dir = data_dir.logs_dir / run_id
        if not data_dir.logs_dir.is_symlink() and not log_dir.is_symlink() and log_dir.is_dir():
            for log_file in log_dir.iterdir():
                if not log_file.is_symlink() and log_file.is_file():
                    zf.write(log_file, prefix + "logs/" + log_file.name)

        source = db.read_one('SELECT archive_hash, manifest FROM run_sources WHERE run_id=?', [run_id])
        if source:
            zf.writestr(prefix + 'source/tree.tar.zst', blobs.get(source[0]))
            zf.writestr(prefix + 'source/manifest.json', source[1])
            diff_hash = json.loads(source[1]).get('diff_hash')
            if diff_hash:
                write_blobs([diff_hash])


    sweeps = []
    for sweep_id in sorted(sweep_ids):
        rows = db.read_columns("SELECT * FROM sweeps WHERE id = ?", [sweep_id])
        if rows:
            trials = db.read_columns(
                "SELECT * FROM sweep_trials WHERE sweep_id = ? ORDER BY created_at", [sweep_id],
            )
            sweeps.append({"sweep": rows[0], "trials": trials})
    zf.writestr("sweeps.json", json.dumps(sweeps, default=str))

    registry = _registry_rows(db, run_ids)
    write_blobs([v["hash"] for v in registry["versions"]])
    zf.writestr("artifact_registry.json", json.dumps(registry, default=str))

    holes = ",".join("?" * len(run_ids))
    links = db.read_columns(
        f"""SELECT * FROM run_links
             WHERE run_id IN ({holes}) OR used_run_id IN ({holes})
             ORDER BY created_at, run_id, used_run_id""",
        [*run_ids, *run_ids],
    ) if run_ids else []
    zf.writestr("run_links.json", json.dumps(links, default=str))


def _registry_rows(db: Database, run_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    """The registry rows an archive of ``run_ids`` carries: every version the
    runs produced or consumed, those versions' families, the families' aliases
    that point at a carried version, and the runs' input records."""
    if not run_ids:
        return {"families": [], "versions": [], "entries": [], "aliases": [], "inputs": []}
    holes = ", ".join("?" * len(run_ids))
    inputs = db.read_columns(f"SELECT * FROM run_inputs WHERE run_id IN ({holes})", run_ids)
    versions = db.read_columns(
        f"""SELECT * FROM artifact_versions
            WHERE created_by_run IN ({holes})
               OR id IN (SELECT artifact_version_id FROM run_inputs WHERE run_id IN ({holes}))
            ORDER BY family_id, version""",
        run_ids + run_ids,
    )
    family_ids = sorted({v["family_id"] for v in versions})
    version_ids = {v["id"] for v in versions}
    families, aliases = [], []
    for fid in family_ids:
        families += db.read_columns("SELECT * FROM artifact_families WHERE id = ?", [fid])
        aliases += [
            a for a in db.read_columns("SELECT * FROM artifact_aliases WHERE family_id = ?", [fid])
            if a["version_id"] in version_ids
        ]
    entries = []
    creation_requests = []
    from . import revisions
    for v in versions:
        entries += db.read_columns("SELECT * FROM artifact_entries WHERE version_id = ?", [v["id"]])
        try:
            payload = revisions.get(db, 'artifact-created', v['id'], 1)
        except LookupError:
            continue
        creation_requests.append({'version_id': v['id'], 'payload': payload})
    return {
        "families": families, "versions": versions, "entries": entries,
        "aliases": aliases, "inputs": inputs,
        "creation_requests": creation_requests,
    }


# ---------------------------------------------------------------------------
# Restore
# ---------------------------------------------------------------------------


def _columns(db: Database, table: str) -> list[str]:
    generated = {"sequences": {"event_id"}, "sweep_trials": {"ordinal"}}.get(table, set())
    return [name for name in db.columns(table) if name not in generated]


def _insert(db: Database, table: str, columns: list[str], row: dict[str, Any], *, merge=False) -> None:
    """Insert known columns; only explicit alias merges may ignore a collision."""
    cols = [c for c in columns if c in row]
    quoted = ", ".join('"' + c + '"' for c in cols)
    holes = ", ".join("?" * len(cols))
    db.write(
        f"INSERT INTO {table} ({quoted}) VALUES ({holes})" + (' ON CONFLICT DO NOTHING' if merge else ''),
        [row[c] for c in cols],
    )


def _read_json(zf: zipfile.ZipFile, name: str, default: Any) -> Any:
    if name not in zf.namelist():
        return default
    try:
        return json.loads(zf.read(name))
    except (ValueError, UnicodeDecodeError, zipfile.BadZipFile) as exc:
        raise ValueError(f'Invalid JSON in archive member {name!r}') from exc


def _safe_path(name: str) -> PurePosixPath:
    path = PurePosixPath(name)
    if (not name or '\\' in name or '\0' in name or path.is_absolute() or ':' in name.split('/', 1)[0]
            or any(part in ('', '.', '..') for part in name.split('/')) or str(path) != name):
        raise ValueError('Unsafe archive member path')
    return path


def _validate_run_ids(run_ids):
    if not isinstance(run_ids, list) or not run_ids:
        raise ValueError('Archive run_ids must be a nonempty list')
    if any(not isinstance(rid, str) or not re.fullmatch(r'[A-Za-z0-9_-][A-Za-z0-9_.-]*', rid)
           for rid in run_ids):
        raise ValueError('Invalid archive run id')
    if len(run_ids) != len(set(run_ids)):
        raise ValueError('Duplicate archive run id')


def _rows(value, name):
    if not isinstance(value, list) or any(not isinstance(row, dict) for row in value):
        raise ValueError(f'Archive {name} must contain a list of rows')
    return value


def _validate_archive(zf):
    """Read every authoritative document and verify bytes before any mutation."""
    names = set()
    for info in zf.infolist():
        if info.filename in names:
            raise ValueError('Duplicate archive member name')
        names.add(info.filename)
        _safe_path(info.filename[:-1] if info.is_dir() else info.filename)
        if info.orig_filename != info.filename or stat.S_ISLNK(info.external_attr >> 16):
            raise ValueError('Unsafe archive member path')
    manifest = _read_json(zf, 'manifest.json', None)
    if not isinstance(manifest, dict):
        raise ValueError('Missing or invalid manifest.json')
    if type(manifest.get('cairn_export_version')) is not int or manifest['cairn_export_version'] != EXPORT_VERSION:
        raise ValueError('Unsupported Cairn archive version')
    _validate_run_ids(manifest.get('run_ids'))
    for rid in manifest['run_ids']:
        run = _read_json(zf, f'{rid}/run.json', None)
        if not isinstance(run, dict) or not isinstance(run.get('run'), dict) or run['run'].get('id') != rid:
            raise ValueError('Archive run document does not match its run id')
        for column in ingest_ops.DOC_COLUMN.values():
            value = run['run'].get(column)
            if value is not None and (not isinstance(value, str) or not isinstance(json.loads(value), dict)):
                raise ValueError('Invalid run document in archive')
        for table in ('sequences', 'records', 'metric_defs', 'alerts', 'logs'):
            rows = _rows(_read_json(zf, f'{rid}/{table}.json', []), table)
            if table == 'records':
                from .records import encode
                for row in rows:
                    encode(json.loads(row['values_json']))
        source = _read_json(zf, f'{rid}/source/manifest.json', {})
        if not isinstance(source, dict):
            raise ValueError('Invalid source manifest in archive')
    sweeps = _rows(_read_json(zf, 'sweeps.json', []), 'sweeps')
    sweep_ids = []
    for sweep in sweeps:
        if not isinstance(sweep.get('sweep'), dict) or not isinstance(sweep['sweep'].get('id'), str):
            raise ValueError('Invalid sweep in archive')
        sweep_ids.append(sweep['sweep']['id'])
        _rows(sweep.get('trials'), 'sweep trials')
    if len(sweep_ids) != len(set(sweep_ids)):
        raise ValueError('Duplicate archive sweep id')
    _rows(_read_json(zf, 'run_links.json', []), 'run links')
    registry = _read_json(zf, 'artifact_registry.json', {})
    if not isinstance(registry, dict):
        raise ValueError('Invalid artifact registry in archive')
    for key in ('families', 'versions', 'entries', 'aliases', 'inputs', 'creation_requests'):
        _rows(registry.get(key, []), key)
    for entry in registry.get('entries', []):
        _safe_path(entry['path'])
    for receipt in registry.get('creation_requests', []):
        if not isinstance(receipt.get('payload'), dict):
            raise ValueError('Invalid artifact creation request in archive')
    hashes = set()
    for name in sorted(names):
        if not name.startswith('artifacts/') or name.endswith('/'):
            continue
        basename = name.removeprefix('artifacts/')
        if basename.endswith('.meta.json'):
            if not re.fullmatch(r'[0-9a-f]{64}\.meta\.json', basename):
                raise ValueError('Invalid archive blob name')
            metadata = _read_json(zf, name, {})
            if not isinstance(metadata, dict):
                raise ValueError('Invalid archive blob metadata')
            if isinstance(metadata.get('metadata'), str):
                json.loads(metadata['metadata'])
            continue
        match = re.fullmatch(r'([0-9a-f]{64})(?:\.[A-Za-z0-9.+-]+)?', basename)
        if not match or match[1] in hashes:
            raise ValueError('Invalid or duplicate archive blob name')
        digest = match[1]
        hashes.add(digest)
        if hashlib.sha256(zf.read(name)).hexdigest() != digest:
            raise ValueError('Archive blob checksum mismatch')
    # Read all remaining members now too: damaged ZIP CRCs must fail before
    # SQL writes, including optional source archives and log projections.
    for name in names:
        if not name.endswith('/'):
            with zf.open(name) as stream:
                while stream.read(1024 * 1024):
                    pass
    return manifest, names


def _check_projection(data_dir, run_id, relative):
    parts = ('logs', run_id, *_safe_path(relative).parts)
    path = data_dir.root
    for part in parts:
        path = path / part
        if path.is_symlink():
            raise ValueError('Unsafe archive log destination')
    return path


def _write_projection(data_dir, run_id, relative, content):
    """Derived logs are written only after commit, without following symlinks."""
    path = _check_projection(data_dir, run_id, relative)
    # Anchor each directory operation to a no-follow descriptor on POSIX.
    # Replacing the final entry also cannot follow an existing file symlink.
    if os.name != 'nt':
        fd = os.open(data_dir.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        temporary = '.import-'+secrets.token_hex(8)
        try:
            for part in ('logs', run_id, *_safe_path(relative).parts[:-1]):
                try:
                    os.mkdir(part, dir_fd=fd)
                except FileExistsError:
                    pass
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd)
                fd = child
            out = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=fd)
            with os.fdopen(out, 'wb') as stream:
                stream.write(content)
            os.replace(temporary, path.name, src_dir_fd=fd, dst_dir_fd=fd)
        finally:
            try:
                os.unlink(temporary, dir_fd=fd)
            except FileNotFoundError:
                pass
            os.close(fd)
    else:
        import tempfile
        path.parent.mkdir(parents=True, exist_ok=True)
        _check_projection(data_dir, run_id, relative)
        fd, temporary = tempfile.mkstemp(prefix='.import-', dir=path.parent)
        try:
            with os.fdopen(fd, 'wb') as stream:
                stream.write(content)
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)


def _ensure_project(db: Database, project_id: str) -> None:
    db.write(
        'INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
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
    project: str | None = None,
) -> list[dict[str, str]]:
    """Restore every run in ``zf``. Returns ``[{original_id, new_id, name}]``.

    ``project`` (a project id) puts everything the archive holds into that
    project: its runs, their alerts and sweeps, and its registry families.

    Invalid archives and identity collisions raise ``ValueError`` without
    changing authoritative rows. Failed imports may leave unreferenced,
    content-addressed blob bytes, which are eligible for ordinary GC.
    """
    try:
        manifest, names = _validate_archive(zf)
    except (KeyError, TypeError, UnicodeDecodeError, zipfile.BadZipFile, RuntimeError) as exc:
        raise ValueError('Invalid Cairn archive') from exc
    with db.transaction(immediate=True):
        db.lock_resource('archive-import', 'runs')
        if keep_ids:
            for table, ids in (
                ('runs', manifest['run_ids']),
                ('sweeps', [s['sweep']['id'] for s in _read_json(zf, 'sweeps.json', [])]),
            ):
                for ident in sorted(ids):
                    if _exists(db, table, ident):
                        raise ValueError(f'Cannot keep archive ids: {table} id already exists')
        try:
            return _restore_archive(db, blobs, data_dir, zf, manifest, names,
                                    keep_ids=keep_ids, project=project)
        except (KeyError, TypeError, *db.integrity_errors) as exc:
            raise ValueError('Archive rows conflict or are incomplete') from exc


def _restore_archive(db, blobs, data_dir, zf, manifest, names, *, keep_ids, project):
    run_ids = manifest['run_ids']
    run_map = {rid: rid if keep_ids else secrets.token_hex(16) for rid in run_ids}
    projections = []
    for original_id, new_id in run_map.items():
        prefix = original_id+'/logs/'
        for name in sorted(names):
            if name.startswith(prefix) and not name.endswith('/'):
                relative = name.removeprefix(prefix)
                _check_projection(data_dir, new_id, relative)
                projections.append((new_id, relative, zf.read(name)))

    # Artifacts first (shared across runs).
    for name in sorted(names):
        if not name.startswith("artifacts/") or name.endswith(".meta.json") or name.endswith("/"):
            continue
        basename = name.split("/", 1)[1]
        h = basename[:64]
        meta_info = _read_json(zf, f"artifacts/{h}.meta.json", {})
        mime = meta_info.get("mime_type", "application/octet-stream")
        metadata = meta_info.get("metadata")
        if isinstance(metadata, str):
            try:
                metadata = json.loads(metadata)
            except json.JSONDecodeError:
                metadata = None
        ingest_ops.put_artifact(db, blobs, zf.read(name), mime, metadata,
                                object_type=meta_info.get("object_type"))

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
        if project is not None:
            sweep["project_id"] = project
        _ensure_project(db, sweep["project_id"])
        _insert(db, "sweeps", sweep_cols, sweep)

    run_cols = _columns(db, "runs")
    seq_cols = _columns(db, "sequences")
    md_cols = _columns(db, "metric_defs")
    alert_cols = _columns(db, "alerts")
    imported: list[dict[str, str]] = []

    for original_id in run_ids:
        new_id = run_map[original_id]
        prefix = f"{original_id}/"
        run_data = _read_json(zf, prefix + "run.json", {})
        run = dict(run_data["run"])
        project_id = project or run.get("project_id") or "imported"
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
        # The run takes the next number of its series here; the exported
        # number is not kept.
        with db.transaction() as con:
            run["version"] = ingest_ops.next_version(
                con, project_id, run.get("run_group"), run.get("job_type"),
                run["display_name"],
            )
        _insert(db, "runs", run_cols, run)

        with db.transaction() as con:
            for table in ingest_ops.KEY_TABLES:
                doc = config_doc.loads(run.get(ingest_ops.DOC_COLUMN[table]))
                ingest_ops.write_doc(con, table, new_id, doc)

        for row in _read_json(zf, prefix + "sequences.json", []):
            row.setdefault("object_type", "scalar")
            row.setdefault("wall_time", "")
            _insert(db, "sequences", seq_cols, dict(row, run_id=new_id))
        for row in _read_json(zf, prefix + 'records.json', []):
            from .records import encode
            row['values_json'] = encode(json.loads(row['values_json']))
            _insert(db, 'run_records', _columns(db, 'run_records'), dict(row, run_id=new_id))
        for row in _read_json(zf, prefix + 'logs.json', []):
            _insert(db, 'log_lines', _columns(db, 'log_lines'), dict(row, run_id=new_id))
        with db.transaction() as con:
            rebuild_metric_stats(con, [new_id])
            progress.recompute_max_step(con, new_id)

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

        archive_name = prefix + 'source/tree.tar.zst'
        if archive_name in names:
            from . import sources
            digest, _ = blobs.put(zf.read(archive_name))
            sources.bind(db, new_id, digest, _read_json(zf, prefix + 'source/manifest.json', {}))

        imported.append({
            "original_id": original_id,
            "new_id": new_id,
            "name": run["display_name"],
        })

    _restore_registry(
        db, _read_json(zf, "artifact_registry.json", {}), keep_ids=keep_ids,
        remap_run=lambda ref: remap("runs", run_map, ref), project=project,
    )

    # Run links: each end remapped like any run reference; a link with an
    # end that resolves to nothing is dropped.
    link_cols = _columns(db, "run_links")
    for link in _read_json(zf, "run_links.json", []):
        run_id = remap("runs", run_map, link.get("run_id"))
        used = remap("runs", run_map, link.get("used_run_id"))
        if run_id and used and run_id != used:
            _insert(db, "run_links", link_cols, dict(link, run_id=run_id, used_run_id=used))

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

    def project_logs():
        for new_id, relative, content in projections:
            try:
                _write_projection(data_dir, new_id, relative, content)
            except (OSError, ValueError):
                # The console remains available from authoritative SQL rows.
                log.warning('Could not restore derived log file for run %s', new_id)
    db.after_commit(project_logs)
    return imported


def _restore_registry(
    db: Database,
    registry: dict[str, list[dict[str, Any]]],
    *,
    keep_ids: bool,
    remap_run: Callable[[str | None], str | None],
    project: str | None = None,
) -> None:
    """Merge an archive's registry rows into ``db`` (see the module docstring);
    ``project`` moves every family into that project."""
    fam_cols = _columns(db, "artifact_families")
    fam_map: dict[str, str] = {}
    for fam in sorted(registry.get("families", []), key=lambda row: (row['project_id'], row['name'])):
        if project is not None:
            fam = dict(fam, project_id=project)
        _ensure_project(db, fam["project_id"])
        db.lock_resource('artifact-family', f"{fam['project_id']}/{fam['name']}")
        existing = db.read_columns(
            "SELECT id, type FROM artifact_families WHERE project_id = ? AND name = ?",
            [fam["project_id"], fam["name"]],
        )
        if existing:
            if existing[0]['type'] != fam['type']:
                raise ValueError('Archive artifact family type conflicts with the destination')
            fam_map[fam["id"]] = existing[0]["id"]
            continue
        new_id = fam["id"] if keep_ids and not _exists(db, "artifact_families", fam["id"]) else secrets.token_hex(8)
        _insert(db, "artifact_families", fam_cols, dict(fam, id=new_id))
        fam_map[fam["id"]] = new_id

    ver_cols = _columns(db, "artifact_versions")
    ver_map: dict[str, str] = {}
    added: set[str] = set()
    creation = {r['version_id']: r['payload'] for r in registry.get('creation_requests', [])}
    for v in registry.get("versions", []):
        family_id = fam_map.get(v["family_id"])
        if family_id is None or not db.read_columns("SELECT 1 FROM artifacts WHERE hash = ?", [v["hash"]]):
            raise ValueError('Archive artifact version is missing its family or manifest')
        taken = db.read_columns(
            "SELECT 1 FROM artifact_versions WHERE family_id = ? AND version = ?", [family_id, v["version"]],
        )
        number = v["version"]
        if taken:
            number = db.read_one(
                "SELECT COALESCE(MAX(version), 0) + 1 FROM artifact_versions WHERE family_id = ?", [family_id],
            )[0]
        new_id = v['id'] if keep_ids else secrets.token_hex(8)
        db.lock_resource('artifact-version', new_id)
        if _exists(db, 'artifact_versions', new_id):
            raise ValueError('Cannot keep archive ids: artifact version id already exists')
        _insert(db, "artifact_versions", ver_cols, dict(
            v, id=new_id, family_id=family_id, version=number,
            created_by_run=remap_run(v.get("created_by_run")),
        ))
        ver_map[v["id"]] = new_id
        added.add(new_id)
        family = db.read_columns('SELECT * FROM artifact_families WHERE id=?', [family_id])[0]
        request = dict(creation.get(v['id']) or {
            'description': v.get('description'), 'metadata': json.loads(v.get('metadata') or '{}'),
            'step': v.get('step'), 'tags': json.loads(v.get('tags') or '[]'),
            'aliases': [a['alias'] for a in registry.get('aliases', [])
                        if a['version_id'] == v['id'] and a['alias'] != 'latest'],
        })
        request.update(project_id=family['project_id'], name=family['name'], type=family['type'],
                       digest=v['hash'], created_by_run=remap_run(v.get('created_by_run')))
        from . import revisions
        revisions.record(db, 'artifact-created', new_id, request)

    entry_cols = _columns(db, "artifact_entries")
    for e in registry.get("entries", []):
        if ver_map.get(e["version_id"]) in added:
            _insert(db, "artifact_entries", entry_cols, dict(e, version_id=ver_map[e["version_id"]]))

    alias_cols = _columns(db, "artifact_aliases")
    for a in registry.get("aliases", []):
        if a["family_id"] in fam_map and a["version_id"] in ver_map:
            _insert(db, "artifact_aliases", alias_cols, dict(
                a, family_id=fam_map[a["family_id"]], version_id=ver_map[a["version_id"]],
            ), merge=True)

    input_cols = _columns(db, "run_inputs")
    for i in registry.get("inputs", []):
        run_id = remap_run(i["run_id"])
        if run_id is not None and i["artifact_version_id"] in ver_map:
            _insert(db, "run_inputs", input_cols, dict(
                i, run_id=run_id, artifact_version_id=ver_map[i["artifact_version_id"]],
                created_at=i.get("created_at") or utc_now(),
            ))

    # ``latest`` always names a family's newest version, also after appending.
    for family_id in set(fam_map.values()):
        db.write(
            "UPDATE artifact_families SET last_version = CASE WHEN last_version > "
            "(SELECT COALESCE(MAX(version), 0) FROM artifact_versions WHERE family_id = ?) THEN last_version ELSE "
            "(SELECT COALESCE(MAX(version), 0) FROM artifact_versions WHERE family_id = ?) END "
            "WHERE id = ?",
            [family_id, family_id, family_id],
        )
        newest = db.read_columns(
            "SELECT id FROM artifact_versions WHERE family_id = ? ORDER BY version DESC LIMIT 1",
            [family_id],
        )
        if newest:
            db.write(
                """INSERT INTO artifact_aliases (family_id, alias, version_id) VALUES (?, 'latest', ?)
                   ON CONFLICT (family_id, alias) DO UPDATE SET version_id = EXCLUDED.version_id""",
                [family_id, newest[0]["id"]],
            )
