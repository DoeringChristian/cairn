"""Published reports are immutable artifact versions with a small catalog entry."""
import hashlib
import json
import re
from datetime import datetime, timezone
from cairn.backend import artifact_registry_ops

SLUG = re.compile(r'[a-z0-9][a-z0-9_-]{0,62}')

class PublicationConflict(ValueError):
    """The current publication changed while this build was running."""


def report_id(project_id, slug):
    return hashlib.sha256(f'{project_id}/{slug}'.encode()).hexdigest()[:32]


def current_version(db, project_id, slug):
    row = db.read_one('SELECT payload FROM reports WHERE id=?', [report_id(project_id, slug)])
    return json.loads(row[0]).get('compiled', {}).get('version_id') if row else None


def publish(db, project_id, slug, name, source, version_id, expected_version=None, build_id=None):
    if not SLUG.fullmatch(slug):
        raise ValueError('report slug must use lower-case letters, numbers, hyphens or underscores')
    with db.transaction(immediate=True):
        workspace_id = None
        if build_id is not None:
            row = db.read_one('SELECT workspace_id FROM report_builds WHERE id=?', [build_id])
            if row:
                workspace_id = row[0]
                db.lock_resource('report-workspace', workspace_id)
        db.lock_resource('report', report_id(project_id, slug))
        if build_id is not None:
            import time
            job = db.read_one('''SELECT b.status,b.lease_until,b.revision,w.revision
                FROM report_builds b JOIN report_workspaces w ON w.id=b.workspace_id WHERE b.id=?''', [build_id])
            if job is None or job[0] != 'running' or (job[1] or 0) < time.time() or job[2] != job[3]:
                raise PublicationConflict('build ownership expired or its source copy changed; submit a fresh build')
        current = current_version(db, project_id, slug)
        if current != expected_version:
            raise PublicationConflict('report changed since build started; rebuild against the current publication')
        db.lock_resource('artifact-family', f'{project_id}/report-{slug}')
        version = artifact_registry_ops.get_version(db, version_id)
        if version['project_id'] != project_id or version['type'] != 'report' or version['name'] != 'report-'+slug:
            raise ValueError('publication must name a report artifact version in this project')
        files = artifact_registry_ops.version_files(db, version_id)
        if not any(f['path'] == f'{slug}/index.html' for f in files):
            raise ValueError('report build has no entry page')
        rid = report_id(project_id, slug)
        now = datetime.now(timezone.utc).isoformat()
        payload = json.dumps({'source': source, 'compiled': {'version_id': version_id,
                              'entry': f'{slug}/index.html', 'slug': slug}})
        db.write('''INSERT INTO reports (id, project_id, name, created_at, updated_at, payload)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at,
                    payload=excluded.payload''', [rid, project_id, name, now, now, payload])
        db.write('INSERT INTO report_publications (report_id, version_id, published_at, source) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', [rid, version_id, now, source])
        result = {'id': rid, 'project_id': project_id, 'version_id': version_id,
                  'url': f'/p/{project_id}/reports/{rid}'}
        if workspace_id is not None:
            origin = json.dumps({'report_id': rid, 'version_id': version_id,
                                 'base_version': version_id, 'fork': False})
            db.write('UPDATE report_workspaces SET origin=? WHERE id=?', [origin, workspace_id])
        if build_id is not None:
            db.write("UPDATE report_builds SET status='completed',result=?,ended_at=? WHERE id=?",
                     [json.dumps(result), now, build_id])
        return result


def remove(db, report_id, *, expected_version):
    from .reports import delete
    return delete(db, report_id, expected_version=expected_version)
