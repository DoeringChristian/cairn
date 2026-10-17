"""Materialize a report's declared evidence into a content-addressed build cache.

run:<full id> pins the captured run data. artifact:<project>/<name>:vN
pins a tracker artifact version. Mutable references resolve once per build.
The snapshot digest records the actual bytes, even if a finished run is edited later.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
from urllib.parse import quote
from ..sdk.reader import Reader
from ..sdk.artifacts import _entry_path

def materialize(reference, config):
    cache = config.cairn_dir/'report-inputs'
    cache.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix='.input-', dir=cache))
    try:
        with Reader(config.tracking_uri) as reader:
            if reference.startswith('run:'):
                ident, _, revision = reference[4:].partition('@')
                backend = reader._backend
                snapshot_data = backend.capture_run(ident, revision or None)
                run = snapshot_data['run']['run']
                docs = snapshot_data['documents']
                (tmp/'config.json').write_text(json.dumps(docs['config'], sort_keys=True))
                (tmp/'summary.json').write_text(json.dumps(docs['summary'], sort_keys=True))
                records = snapshot_data.get('records', [])
                (tmp/'records.jsonl').write_text(''.join(json.dumps(row, sort_keys=True)+'\n' for row in records))
                from cairn.backend.records import media_hashes
                for digest in set(media_hashes(records)):
                    target = tmp/'blobs'/digest
                    target.parent.mkdir(parents=True, exist_ok=True)
                    data = backend.get_artifact_bytes(digest)
                    if hashlib.sha256(data).hexdigest() != digest:
                        raise ValueError(f'input media checksum mismatch: {digest}')
                    target.write_bytes(data)
                events = []
                media = []
                for point in snapshot_data['points']:
                    if point['object_type'] != 'scalar':
                        digest = point.get('artifact_hash')
                        if not digest:
                            continue
                        import mimetypes
                        extension = mimetypes.guess_extension(point.get('artifact_mime') or '') or '.bin'
                        path = _entry_path(f"media/{quote(point['name'], safe='')}/{point['step']}{extension}")
                        target = tmp/path
                        target.parent.mkdir(parents=True, exist_ok=True)
                        data = backend.get_artifact_bytes(digest)
                        if hashlib.sha256(data).hexdigest() != digest:
                            raise ValueError(f'input media checksum mismatch: {digest}')
                        target.write_bytes(data)
                        media.append({'name': point['name'], 'step': point['step'], 'path': path,
                                      'hash': digest, 'type': point['object_type']})
                    else:
                        events.append({'name': point['name'], 'value': point['scalar_value'],
                                       'step': point['step'], 'time': point['wall_time']})
                (tmp/'media.json').write_text(json.dumps(media, sort_keys=True))
                (tmp/'metrics.jsonl').write_text(''.join(json.dumps(e, sort_keys=True)+'\n' for e in events))
                (tmp/'run.json').write_text(json.dumps(snapshot_data['run'], sort_keys=True))
                # Published run outputs are immutable tracker artifact versions.
                outputs = snapshot_data['outputs']
                (tmp/'outputs.json').write_text(json.dumps(outputs, sort_keys=True))
                ident, name, version = run['id'], run.get('display_name') or run['id'], run.get('version')
                resolved = 'run:'+ident+'@'+snapshot_data['snapshot_id']
                href = f"/p/{quote(run['project_id'], safe='')}/r/{ident}"
            else:
                ref = reference.removeprefix('artifact:')
                artifact = reader.artifact(ref, project=config.namespace)
                for entry in artifact.files():
                    if entry.uri is not None:
                        raise ValueError(f'external input file {entry.path!r} must be imported before report building')
                    target = tmp/_entry_path(entry.path)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    data = artifact._read_entry(entry)
                    if entry.digest and hashlib.sha256(data).hexdigest() != entry.digest:
                        raise ValueError(f'input file checksum mismatch: {entry.path}')
                    target.write_bytes(data)
                ident, name, version = artifact.id, artifact.name, artifact.version
                resolved = 'artifact:'+artifact.qualified_ref
                href = f'/p/{quote(artifact.project, safe="")}/artifacts/{quote(artifact.name, safe="")}/v{version}'
        hashes = {p.relative_to(tmp).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                  for p in sorted(tmp.rglob('*')) if p.is_file()}
        snapshot = hashlib.sha256(json.dumps(hashes, sort_keys=True).encode()).hexdigest()
        folder = cache/snapshot
        try:
            tmp.rename(folder)
        except OSError:
            if not folder.is_dir():
                raise
            actual = {p.relative_to(folder).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                      for p in sorted(folder.rglob('*')) if p.is_file()}
            if actual != hashes:
                raise ValueError(f'cached report evidence {snapshot} was modified; remove {folder} and rebuild')
        return {'requested': reference, 'resolved': resolved, 'id': ident, 'name': name,
                'version': version, 'files': len(hashes), 'snapshot': snapshot, 'path': folder, 'href': href}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def verify_snapshot(folder, snapshot):
    hashes = {p.relative_to(folder).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in sorted(folder.rglob('*')) if p.is_file()}
    actual = hashlib.sha256(json.dumps(hashes, sort_keys=True).encode()).hexdigest()
    if actual != snapshot:
        raise ValueError(f'report code modified captured evidence {snapshot}; input files must be read-only')
