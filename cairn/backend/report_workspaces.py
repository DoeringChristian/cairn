"""Editable source copies and immutable queued builds, independent of HTTP.

Only source copies are mutable. Published reports and queued source manifests are
never edited in place. Bytes enter the blob store before a SQL binding commits.
"""
import base64
import json
import uuid
from pathlib import PurePosixPath

from . import artifact_registry_ops, report_publications
from .common import utc_now, slugify

MAX_BYTES = 32 * 1024 * 1024
MAX_FILES = 1000


class Conflict(ValueError):
    pass


def _path(value):
    path = PurePosixPath(value)
    if (not value or str(path) != value or path.is_absolute() or '\\' in value
            or any(p.startswith('.') for p in path.parts)):
        raise ValueError(f'unsafe report source path: {value}')
    return value


def _validate(files):
    if len(files) > MAX_FILES or sum(f['size'] for f in files.values()) > MAX_BYTES:
        raise ValueError('report source exceeds 1000 files or 32 MiB')
    entries = [name for name in ('report.qmd', 'report.md') if name in files]
    if len(entries) != 1:
        raise ValueError('source needs exactly one report.qmd (or report.md) entry')
    return entries[0]


def _capture(blobs, files, assets=None):
    captured = {}
    if set(files) & set(assets or {}):
        raise ValueError('source paths must be unique')
    raw = {name: value.encode('utf-8') for name, value in files.items()}
    raw.update({name: base64.b64decode(value, validate=True) for name, value in (assets or {}).items()})
    if len(raw) > MAX_FILES or sum(map(len, raw.values())) > MAX_BYTES:
        raise ValueError('report source exceeds 1000 files or 32 MiB')
    for name, data in raw.items():
        _path(name)
        digest, size = blobs.put(data)
        captured[name] = {'hash': digest, 'size': size}
    _validate(captured)
    return captured


def _row(db, ident):
    rows = db.read_columns('SELECT * FROM report_workspaces WHERE id=?', [ident])
    if not rows:
        raise LookupError('report source copy not found')
    row = rows[0]
    row['files'] = json.loads(row['files'])
    return row


def get(db, blobs, ident):
    row = _row(db, ident)
    row['entry'] = _validate(row['files'])
    files = []
    for path, info in sorted(row['files'].items()):
        data = blobs.get(info['hash'])
        try:
            text = data.decode('utf-8') if b'\0' not in data else None
        except UnicodeDecodeError:
            text = None
        files.append({'path': path, 'text': text, **info})
    row['files'] = files
    latest = db.read_one('''SELECT id FROM report_builds WHERE workspace_id=?
        ORDER BY created_at DESC,id DESC LIMIT 1''', [ident])
    row['latest_build'] = build_status(db, latest[0]) if latest else None
    return row


def create(db, blobs, *, report_id=None, version_id=None, project_id='default', slug=None, files=None, assets=None, fork=False):
    origin = None
    if fork and not report_id:
        raise ValueError('fork requires a published report_id')
    if report_id:
        with db.transaction():
            rows = db.read_columns('SELECT * FROM reports WHERE id=?', [report_id])
            if not rows:
                raise LookupError('report not found')
            report = rows[0]
            compiled = json.loads(report['payload']).get('compiled')
            if not compiled:
                raise ValueError('only published source reports can be copied')
            version_id = version_id or compiled['version_id']
            if not db.read_one('SELECT 1 FROM report_publications WHERE report_id=? AND version_id=?', [report_id, version_id]):
                raise LookupError('report version was not published')
            entries = artifact_registry_ops.version_files(db, version_id)
            version = artifact_registry_ops.get_version(db, version_id)
            captured = {_path(f['path'][8:]): {'hash': f['digest'], 'size': f['size']}
                        for f in entries if f['path'].startswith('sources/') and f.get('digest')}
            project_id = report['project_id']
            if fork:
                slug = slug or compiled['slug'][:50] + '-copy-' + uuid.uuid4().hex[:6]
                if slug == compiled['slug']:
                    raise ValueError('a fork needs a different report slug')
                base_version = None
            else:
                if slug is not None and slug != compiled['slug']:
                    raise ValueError('use fork=true to create a different report')
                slug = compiled['slug']
                base_version = compiled['version_id']
            origin = json.dumps({'report_id': report_id, 'version_id': version_id,
                                 'base_version': base_version, 'fork': fork})
            # Copies keep the exact evidence used by the original publication.
            # The source remains editable; changing an input explicitly opts into
            # capturing different evidence on the next build.
            pins = version.get('metadata', {}).get('inputs', {})
            if pins:
                import yaml
                entry = _validate(captured)
                text = blobs.get(captured[entry]['hash']).decode('utf-8')
                lines = text.splitlines(keepends=True)
                if lines and lines[0].strip() == '---':
                    end = next((i for i in range(1,len(lines)) if lines[i].strip() == '---'), None)
                    if end is not None:
                        meta = yaml.safe_load(''.join(lines[1:end])) or {}
                        for role, pin in pins.items():
                            if meta.get('inputs', {}).get(role) == pin.get('requested'):
                                meta['inputs'][role] = pin['resolved']
                        text = '---\n'+yaml.safe_dump(meta,sort_keys=False)+'---\n'+''.join(lines[end+1:])
                        digest, size = blobs.put(text.encode())
                        captured[entry] = {'hash':digest, 'size':size}
    else:
        if files is None:
            raise ValueError('provide a published report_id or source files')
        captured = _capture(blobs, files, assets)
    _validate(captured)
    if not slug or not report_publications.SLUG.fullmatch(slug):
        raise ValueError('invalid report slug')
    if origin is None:
        origin = json.dumps({'base_version': report_publications.current_version(db, slugify(project_id), slug)})
    elif fork and report_publications.current_version(db, project_id, slug) is not None:
        raise Conflict('fork target already exists; choose a new report slug')
    ident = uuid.uuid4().hex
    now = utc_now().isoformat()
    db.write('''INSERT INTO report_workspaces
        (id, project_id, slug, revision, files, origin, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?, ?, ?)''',
        [ident, slugify(project_id), slug, json.dumps(captured), origin, now, now])
    return get(db, blobs, ident)


def update(db, blobs, ident, *, files, expected_revision):
    # Validate and stage every changed byte before entering the transaction.
    changes = {}
    for name, value in files.items():
        _path(name)
        if value is None:
            changes[name] = None
        else:
            data = value.encode('utf-8')
            if len(data) > MAX_BYTES:
                raise ValueError('source file exceeds 32 MiB')
            digest, size = blobs.put(data)
            changes[name] = {'hash': digest, 'size': size}
    with db.transaction(immediate=True):
        db.lock_resource('report-workspace', ident)
        row = _row(db, ident)
        if row['revision'] != expected_revision:
            raise Conflict('source changed; reload the copy before saving')
        for name, info in changes.items():
            if info is None:
                row['files'].pop(name, None)
            else:
                row['files'][name] = info
        _validate(row['files'])
        db.write('UPDATE report_workspaces SET files=?, revision=revision+1, updated_at=? WHERE id=?',
                 [json.dumps(row['files']), utc_now().isoformat(), ident])
    return get(db, blobs, ident)


def submit(db, ident, *, expected_revision, slug=None):
    with db.transaction(immediate=True):
        db.lock_resource('report-workspace', ident)
        db.lock_resource('report-queue', 'claim')
        row = _row(db, ident)
        if row['revision'] != expected_revision:
            raise Conflict('source changed; reload before building')
        if slug is not None and slug != row['slug']:
            raise ValueError('create an explicit fork before changing the report slug')
        slug = row['slug']
        origin = json.loads(row['origin'] or '{}')
        if 'base_version' not in origin:
            raise Conflict('source copy predates revision tracking; reopen the published report')
        expected_version = origin['base_version']
        if report_publications.current_version(db, row['project_id'], slug) != expected_version:
            raise Conflict('report changed since this edit started; reopen the current publication')
        if not report_publications.SLUG.fullmatch(slug):
            raise ValueError('invalid report slug')
        # Repeated clicks/retries while a build is active refer to the same
        # publication attempt. Queueing them again would execute the same code
        # twice and fail the later publication against the first one's version.
        active = db.read_columns('''SELECT id, expected_version FROM report_builds
            WHERE workspace_id=? AND revision=? AND status IN ('queued','running')
            ORDER BY created_at,id''', [ident, row['revision']])
        for build in active:
            if build['expected_version'] == expected_version:
                return build_status(db, build['id'])
        if db.read_one("SELECT count(*) FROM report_builds WHERE status IN ('queued','running')")[0] >= 32:
            raise Conflict('report build queue is full; try again after a build finishes')
        job = uuid.uuid4().hex
        db.write('''INSERT INTO report_builds
            (id, workspace_id, revision, project_id, slug, files, expected_version, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)''',
            [job, ident, row['revision'], row['project_id'], slug, json.dumps(row['files']),
             expected_version, utc_now().isoformat()])
    return build_status(db, job)


def build_status(db, ident, *, include_files=False):
    rows = db.read_columns('SELECT * FROM report_builds WHERE id=?', [ident])
    if not rows:
        raise LookupError('report build not found')
    row = rows[0]
    if include_files:
        row['files'] = json.loads(row['files'])
    else:
        row.pop('files')
    row['result'] = json.loads(row['result']) if row['result'] else None
    return row


def finish(db, ident, *, result=None, error=None):
    db.write("UPDATE report_builds SET status=?, result=?, error=?, ended_at=? WHERE id=? AND status='running'",
             ['failed' if error else 'completed', json.dumps(result) if result else None,
              error, utc_now().isoformat(), ident])
