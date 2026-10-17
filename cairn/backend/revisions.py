"""Optimistic updates and immutable history shared by distinct domain services.

This is a persistence primitive, not a public universal-resource model. Callers
hold a transaction and the resource lock for read/check/write/history as a unit.
"""
import hashlib
import json
from .common import utc_now


class RevisionConflict(ValueError):
    def __init__(self, expected, actual):
        self.expected = expected
        self.actual = actual
        super().__init__(f'revision changed: expected {expected}, current {actual}; reload before editing')


def current(db, kind, ident):
    row = db.read_one('SELECT revision FROM resource_heads WHERE kind=? AND id=?', [kind, ident])
    return int(row[0]) if row else 0


def check(db, kind, ident, expected):
    actual = current(db, kind, ident)
    if expected != actual:
        raise RevisionConflict(expected, actual)
    return actual


def record(db, kind, ident, payload):
    """Append history only when the resource document changed."""
    encoded = json.dumps(payload, sort_keys=True, separators=(',', ':'), default=str)
    digest = hashlib.sha256(encoded.encode()).hexdigest()
    row = db.read_one('SELECT revision, payload FROM resource_heads WHERE kind=? AND id=?', [kind, ident])
    if row and row[1] == encoded:
        return int(row[0])
    revision = int(row[0]) + 1 if row else 1
    db.write('''INSERT INTO resource_revisions(kind,id,revision,payload,digest,created_at)
                VALUES (?,?,?,?,?,?)''', [kind, ident, revision, encoded, digest, utc_now().isoformat()])
    db.write('''INSERT INTO resource_heads(kind,id,revision,payload) VALUES (?,?,?,?)
        ON CONFLICT(kind,id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload''',
        [kind, ident, revision, encoded])
    return revision


def history(db, kind, ident, *, limit=100, before=None):
    limit = max(1, min(int(limit), 1000))
    where = '' if before is None else ' AND revision < ?'
    params = [kind, ident] + ([] if before is None else [before]) + [limit]
    rows = db.read_columns(f'''SELECT revision,digest,created_at,payload FROM resource_revisions
        WHERE kind=? AND id=?{where} ORDER BY revision DESC LIMIT ?''', params)
    return [{**r, 'payload': json.loads(r['payload'])} for r in rows]


def get(db, kind, ident, revision):
    row = db.read_one('SELECT payload FROM resource_revisions WHERE kind=? AND id=? AND revision=?', [kind, ident, revision])
    if not row:
        raise LookupError('revision not found')
    return json.loads(row[0])
