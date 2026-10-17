"""Read-only published reports and their retained publication history.

Authoring happens in source workspaces. A publication selects an immutable build;
there is no mutable report-document editor in this domain.
"""
from __future__ import annotations

import json
from pathlib import PurePosixPath

from . import artifact_registry_ops
from .common import slugify
from .report_publications import PublicationConflict


def read(db, report_id, *, project=None):
    rows = db.read_columns('SELECT * FROM reports WHERE id=?', [report_id])
    if not rows or (project is not None and rows[0]['project_id'] != slugify(project)):
        raise LookupError(f'report {report_id} not found')
    row = rows[0]
    payload = json.loads(row['payload'])
    compiled = payload.get('compiled')
    if not compiled or not db.read_one(
        'SELECT 1 FROM report_publications WHERE report_id=? AND version_id=?',
        [report_id, compiled['version_id']],
    ):
        raise LookupError(f'published report {report_id} not found')
    return {**row, 'payload': payload, 'version_id': compiled['version_id'], 'read_only': True}


def list_page(db, project=None, *, limit=200, offset=0):
    if type(limit) is not int or not 1 <= limit <= 1000 or type(offset) is not int or offset < 0:
        raise ValueError('report pagination requires limit 1–1000 and nonnegative offset')
    where = 'WHERE EXISTS (SELECT 1 FROM report_publications p WHERE p.report_id=r.id)'
    params = []
    if project is not None:
        where += ' AND r.project_id=?'
        params.append(slugify(project))
    total = db.read_one(f'SELECT COUNT(*) FROM reports r {where}', params)[0]
    rows = db.read_columns(
        f'SELECT r.id,r.project_id,r.name,r.created_at,r.updated_at,r.payload FROM reports r {where} ORDER BY r.updated_at DESC,r.id LIMIT ? OFFSET ?',
        [*params, limit, offset],
    )
    result=[]
    for row in rows:
        compiled=json.loads(row.pop('payload'))['compiled']
        result.append({**row,'version_id':compiled['version_id'],'read_only':True})
    if result:
        ids=[row['version_id'] for row in result]
        versions=dict(db.read('SELECT id,version FROM artifact_versions WHERE id IN ('+','.join('?' for _ in ids)+')',ids))
        for row in result:
            row['version']=versions.get(row['version_id'])
    return {'reports':result,'total':total,'limit':limit,'offset':offset}


def history(db, report_id, *, limit=200, offset=0):
    report=read(db,report_id)
    if type(limit) is not int or not 1 <= limit <= 1000 or type(offset) is not int or offset < 0:
        raise ValueError('report pagination requires limit 1–1000 and nonnegative offset')
    rows=db.read_columns('''SELECT p.version_id,p.published_at,v.version
        FROM report_publications p JOIN artifact_versions v ON v.id=p.version_id
        WHERE p.report_id=? ORDER BY p.published_at DESC,p.version_id LIMIT ? OFFSET ?''',
        [report_id,limit,offset])
    total=db.read_one('SELECT COUNT(*) FROM report_publications WHERE report_id=?',[report_id])[0]
    return {'versions':[{**row,'current':row['version_id']==report['version_id']} for row in rows],
            'total':total,'limit':limit,'offset':offset}


def file_entry(db, report_id, path, *, version_id=None):
    report=read(db,report_id)
    compiled=report['payload']['compiled']
    path=path or compiled['entry']
    if not isinstance(path,str) or '..' in PurePosixPath(path).parts or PurePosixPath(path).is_absolute() or '\\' in path:
        raise LookupError('report file not found')
    target=version_id or compiled['version_id']
    if not db.read_one('SELECT 1 FROM report_publications WHERE report_id=? AND version_id=?',[report_id,target]):
        raise LookupError('build was not published')
    version=artifact_registry_ops.get_version(db,target)
    if version['project_id']!=report['project_id'] or version['name']!='report-'+compiled['slug'] or version['type']!='report':
        raise LookupError('report build not found')
    for entry in artifact_registry_ops.version_files(db,target):
        if entry['path']==path and entry.get('digest'):
            return entry
    raise LookupError('report file not found')


def delete(db, report_id, *, expected_version, project=None):
    with db.transaction(immediate=True):
        db.lock_resource('report',report_id)
        report=read(db,report_id,project=project)
        if expected_version != report['version_id']:
            raise PublicationConflict('report changed since it was read; reload before removing it')
        for table in ('comments','report_publications'):
            db.write(f'DELETE FROM {table} WHERE report_id=?',[report_id])
        db.write('DELETE FROM reports WHERE id=?',[report_id])
    # Build artifacts remain explicitly addressable in the artifact registry.
    return {'deleted':report_id}
