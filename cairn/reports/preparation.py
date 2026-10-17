"""Capture source, evidence, and environment before accepting a queued build."""
import base64
import json
from pathlib import Path
import tempfile

from cairn.backend import report_workspaces as workspaces, revisions
from .build import source_entry
from .config import load_config
from .engine import _read_source
from .environment import _resolve_environment
from .inputs import materialize


def submit(storage, ident, *, expected_revision, slug=None):
    db, blobs, directory = storage.open()
    try:
        row = workspaces._row(db, ident)
        if row['revision'] != expected_revision:
            raise workspaces.Conflict('source changed; reload before building')
        with tempfile.TemporaryDirectory(prefix='cairn-prepare-') as tmp:
            root = Path(tmp)
            source = root/'sources'
            source.mkdir()
            for name, info in row['files'].items():
                target = source/workspaces._path(name)
                target.parent.mkdir(parents=True,exist_ok=True)
                target.write_bytes(blobs.get(info['hash']))
            meta, _ = _read_source(source, source_entry(source))
            environment, lock = _resolve_environment(meta.get('environment'))
            lock_hash, _ = blobs.put(lock)
            captured = {'environment': environment, 'lock_hash': lock_hash, 'inputs': {}}
            config = load_config(root, repo=storage, namespace=row['project_id'])
            for role, ref in meta.get('inputs', {}).items():
                item = materialize(ref, config)
                files = {}
                for path in item['path'].rglob('*'):
                    if path.is_file():
                        digest, size = blobs.put(path.read_bytes())
                        files[path.relative_to(item['path']).as_posix()] = {'hash':digest,'size':size}
                captured['inputs'][role] = {**{k:v for k,v in item.items() if k != 'path'}, 'captured_files':files}
            # Recheck the source revision at the acceptance boundary. The queued
            # job and its immutable evidence/environment commit together.
            with db.transaction(immediate=True):
                result = workspaces.submit(db, ident, expected_revision=expected_revision, slug=slug)
                # submit reuses an identical queued/running attempt. Its first
                # accepted evidence and environment must remain immutable even
                # if a mutable input changed before the repeated request.
                if not revisions.current(db, 'report-prepared', result['id']):
                    revisions.record(db, 'report-prepared', result['id'], captured)
            return result
    finally:
        db.close()


def restore(db, blobs, ident, root):
    prepared = revisions.get(db, 'report-prepared', ident, 1)
    result = {'environment':prepared['environment'], 'lock':blobs.get(prepared['lock_hash']), 'inputs':{}}
    for role, info in prepared['inputs'].items():
        folder = root/'prepared-inputs'/role
        folder.mkdir(parents=True)
        for name, entry in info['captured_files'].items():
            target = folder/workspaces._path(name)
            target.parent.mkdir(parents=True,exist_ok=True)
            data = blobs.get(entry['hash'])
            if blobs.hash_bytes(data) != entry['hash']:
                raise ValueError('captured evidence checksum mismatch')
            target.write_bytes(data)
        result['inputs'][role] = {**{k:v for k,v in info.items() if k != 'captured_files'}, 'path':folder}
    return result
