"""Source archives: immutable blob bytes plus transactional run bindings."""
import json
from .source_cache import SOURCE_CACHE


def bind(db, run_id, archive_hash, manifest):
    if not isinstance(manifest, dict):
        raise ValueError('source manifest must be a mapping')
    db.write('''INSERT INTO run_sources (run_id, archive_hash, manifest) VALUES (?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET archive_hash=excluded.archive_hash, manifest=excluded.manifest''',
        [run_id, archive_hash, json.dumps(manifest)])


def get(db, run_id):
    row = db.read_one('SELECT archive_hash, manifest FROM run_sources WHERE run_id=?', [run_id])
    if row is None:
        raise LookupError('no source archive for run')
    return row[0], json.loads(row[1])


def file(db, blobs, run_id, path):
    digest, _ = get(db, run_id)
    tree = SOURCE_CACHE.get(blobs.path_for(digest))
    if path in tree.others:
        raise ValueError("source path is not a regular file")
    return tree.files.get(path)
