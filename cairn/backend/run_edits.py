"""One run edit contract shared by HTTP and the direct SDK."""
import json
from . import ingest_ops, revisions

_FIELDS = {'display_name', 'group', 'job_type', 'notes', 'tags', 'config', 'summary'}


def metadata(db, ident):
    row = ingest_ops._require_run(db, ident)
    fields = ('project_id','display_name','run_group','job_type','status','ended_at','exit_code',
              'tags','notes','config','summary','archived_at','version')
    payload = {name: row.get(name) for name in fields}
    for name in ('tags', 'config', 'summary'):
        if isinstance(payload[name], str):
            payload[name] = json.loads(payload[name])
    return payload


def record(db, ident):
    return revisions.record(db, 'run', ident, metadata(db, ident))


def read(db, ident):
    with db.transaction(immediate=True):
        db.lock_resource('run', ident)
        payload = metadata(db, ident)
        revision = record(db, ident)
        return {'run_id': ident, 'revision': revision, **payload}


def edit(db, ident, *, expected_revision, changes, delete=None):
    unknown = set(changes) - _FIELDS
    if unknown:
        raise ValueError(f'unsupported run edit fields: {sorted(unknown)}')
    if delete and set(delete) - {'config', 'summary'}:
        raise ValueError('only config and summary support key deletion')
    with db.transaction(immediate=True):
        db.lock_resource('run', ident)
        record(db, ident)
        revisions.check(db, 'run', ident, expected_revision)
        if any(k in changes for k in ('display_name', 'group', 'job_type')):
            args = {('name' if k == 'display_name' else k): changes[k]
                    for k in ('display_name','group','job_type') if k in changes}
            ingest_ops._move_series(db, ident, **args)
        if 'notes' in changes:
            if not isinstance(changes['notes'], str):
                raise ValueError('notes must be text')
            ingest_ops.set_notes(db, ident, changes['notes'])
        if 'tags' in changes:
            if not isinstance(changes['tags'], list) or any(not isinstance(t, str) for t in changes['tags']):
                raise ValueError('tags must be a list of strings')
            ingest_ops.set_tags(db, ident, changes['tags'])
        for name, table in (('config', 'params'), ('summary', 'summary')):
            if name in changes:
                if not isinstance(changes[name], dict):
                    raise ValueError(f'{name} must be a mapping')
                ingest_ops._merge_doc(db, table, ident, changes[name])
            if delete and name in delete:
                if not isinstance(delete[name], list) or any(not isinstance(k,str) for k in delete[name]):
                    raise ValueError('deleted keys must be a list of strings')
                ingest_ops.delete_keys(db, ident, table, delete[name])
        revision = record(db, ident)
        return {'run_id': ident, 'revision': revision, **metadata(db, ident)}
