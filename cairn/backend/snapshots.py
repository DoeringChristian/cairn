"""Immutable run evidence captured under the run's write boundary."""
import json
from .run_reads import run_details
from .ingest_ops import run_docs
from .artifact_registry_ops import run_outputs
from . import revisions


def capture_run(db, run_id, revision=None):
    with db.transaction(immediate=True):
        db.lock_resource('run', run_id)
        if revision is not None:
            row = db.read_one('''SELECT revision,digest,payload FROM resource_revisions
                WHERE kind='run-snapshot' AND id=? AND digest=?''', [run_id, revision])
            if row is None:
                raise LookupError('run snapshot not found')
            payload = json.loads(row[2])
            return {**payload, 'snapshot_revision': row[0], 'snapshot_id': row[1]}
        details = run_details(db, [run_id])
        if run_id not in details:
            raise LookupError(f'run {run_id} not found')
        detail = details[run_id]
        if detail['run']['status'] not in ('completed', 'failed', 'crashed', 'killed', 'stopped'):
            raise ValueError('report inputs must be finished runs')
        points = db.read_columns('''SELECT s.name, s.step, s.wall_time, s.scalar_value,
            s.artifact_hash, s.object_type, s.metadata, a.mime_type AS artifact_mime
            FROM sequences s LEFT JOIN artifacts a ON a.hash=s.artifact_hash
            WHERE s.run_id=? ORDER BY s.name, s.step''', [run_id])
        payload = {'run': detail, 'documents': run_docs(db, run_id),
                   'points': points, 'outputs': run_outputs(db, run_id)}
        payload['records'] = [{**row, 'values': json.loads(row['values_json'])}
                              for row in db.read_columns('SELECT event_id,writer_id,sequence,timestamp,values_json FROM run_records WHERE run_id=? ORDER BY event_id', [run_id])]
        for record in payload['records']:
            record.pop('values_json')
        number = revisions.record(db, 'run-snapshot', run_id, payload)
        digest = db.read_one("SELECT digest FROM resource_revisions WHERE kind='run-snapshot' AND id=? AND revision=?", [run_id, number])[0]
        return {**payload, 'snapshot_revision': number, 'snapshot_id': digest}
