"""Pure artifact-registry operations, independent of HTTP.

An artifact VERSION is an immutable manifest of entries (uploaded files,
serialized objects, external references) identified by
``project/name:vN``. Its manifest is a content-addressed blob
(``MANIFEST_MIME``) that the client uploads first, with every file it names;
``create_version`` then registers it, indexing the entries in
``artifact_entries`` for the explorer.

Aliases: ``latest`` always names the newest version of a family (maintained
here, never set or removed by hand); ``v<digits>`` are reserved too. User
aliases are unique per family and MOVE when assigned to another version.

Same pattern as ``ingest_ops.py``: functions taking ``Database`` (and
``BlobStore``), raising ``ValueError`` / ``LookupError`` on user errors.
Callers translate those to HTTP status codes.
"""

from __future__ import annotations

import json
import re
import secrets
from collections import deque
from typing import Any, Iterable

from .routes._common import slugify, utc_now
from .storage.blobs import BlobStore
from .storage.db import Database
from . import viewer_defaults
from .viewer_manifest import VIEWER_TYPE

_RESERVED_ALIAS = re.compile(r"^(latest|v\d+)$")


def _new_id() -> str:
    return secrets.token_hex(8)


def _now_iso() -> str:
    return utc_now().isoformat()


def _holes(items: list[Any]) -> str:
    return ",".join("?" * len(items))


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def validate_name(name: str) -> str:
    """An artifact name: non-empty, without ``:`` or ``/`` (ref syntax)."""
    if not isinstance(name, str) or not name.strip():
        raise ValueError("artifact name must be a non-empty string")
    if ":" in name or "/" in name:
        raise ValueError(f"artifact name {name!r} must not contain ':' or '/'")
    return name


def validate_user_alias(alias: str) -> str:
    """A user alias: not ``latest`` / ``v<N>`` (reserved), no ``:`` or ``/``."""
    if not isinstance(alias, str) or not alias.strip():
        raise ValueError("alias must be a non-empty string")
    if _RESERVED_ALIAS.match(alias):
        raise ValueError(
            f"alias {alias!r} is reserved ('latest' always names the newest version, "
            "'vN' names version N)"
        )
    if ":" in alias or "/" in alias:
        raise ValueError(f"alias {alias!r} must not contain ':' or '/'")
    return alias


def validate_tags(tags: Any) -> list[str]:
    """Version tags: non-empty strings, deduplicated in order."""
    if tags is None:
        return []
    if isinstance(tags, str) or not isinstance(tags, (list, tuple)):
        raise ValueError("tags must be a list of strings")
    out: list[str] = []
    for t in tags:
        if not isinstance(t, str) or not t.strip():
            raise ValueError(f"a tag must be a non-empty string, got {t!r}")
        if t not in out:
            out.append(t)
    return out


def parse_ref(ref: str, project_id: str | None) -> tuple[str, str, str]:
    """``[project/]name[:alias|:vN]`` -> ``(project_id, name, qualifier)``.

    A bare name means ``name:latest``. The project part is slugified like
    every project id.
    """
    if not isinstance(ref, str) or not ref:
        raise ValueError("artifact ref must be a non-empty string")
    body = ref
    project = project_id
    if "/" in body:
        proj, _, body = body.partition("/")
        if not proj or "/" in body:
            raise ValueError(f"invalid artifact ref {ref!r}: expected [project/]name[:alias|:vN]")
        project = slugify(proj)
    name, sep, qualifier = body.partition(":")
    if not name or (sep and not qualifier) or ":" in qualifier:
        raise ValueError(f"invalid artifact ref {ref!r}: expected [project/]name[:alias|:vN]")
    if project is None:
        raise ValueError(f"artifact ref {ref!r} needs a project")
    return project, name, qualifier or "latest"


# ---------------------------------------------------------------------------
# Families
# ---------------------------------------------------------------------------

def get_family(db: Database, family_id: str) -> dict[str, Any]:
    rows = db.read_columns("SELECT * FROM artifact_families WHERE id = ?", [family_id])
    if not rows:
        raise LookupError(f"artifact family {family_id} not found")
    return rows[0]


def get_family_by_name(db: Database, project_id: str, name: str) -> dict[str, Any] | None:
    rows = db.read_columns(
        "SELECT * FROM artifact_families WHERE project_id = ? AND name = ?",
        [project_id, name],
    )
    return rows[0] if rows else None


def _family_aliases(db: Database, family_ids: list[str]) -> dict[str, dict[str, int]]:
    """``{family_id: {alias: version number}}``."""
    out: dict[str, dict[str, int]] = {fid: {} for fid in family_ids}
    if family_ids:
        for r in db.read_columns(
            f"""SELECT aa.family_id, aa.alias, av.version FROM artifact_aliases aa
                JOIN artifact_versions av ON av.id = aa.version_id
                WHERE aa.family_id IN ({_holes(family_ids)}) ORDER BY aa.alias""",
            family_ids,
        ):
            out[r["family_id"]][r["alias"]] = r["version"]
    return out


def list_families(
    db: Database, project_id: str, *, type_filter: str | None = None,
    family_id: str | None = None,
) -> list[dict[str, Any]]:
    """A project's families, most recently updated first:
    ``{id, project_id, name, type, description, created_at, updated_at,
    version_count, latest_version, total_size, aliases: {alias: version}}``."""
    where = "WHERE af.project_id = ?"
    params: list[Any] = [project_id]
    if type_filter is not None:
        where += " AND af.type = ?"
        params.append(type_filter)
    if family_id is not None:
        where += " AND af.id = ?"
        params.append(family_id)
    rows = db.read_columns(
        f"""
        SELECT af.id, af.project_id, af.name, af.type, af.description,
               af.created_at, af.updated_at,
               COALESCE(MAX(av.version), 0)    AS latest_version,
               COUNT(av.id)                    AS version_count,
               COALESCE(SUM(av.size_bytes), 0) AS total_size
        FROM artifact_families af
        LEFT JOIN artifact_versions av ON av.family_id = af.id
        {where}
        GROUP BY af.id
        ORDER BY af.updated_at DESC
        """,
        params,
    )
    aliases = _family_aliases(db, [r["id"] for r in rows])
    for r in rows:
        r["aliases"] = aliases.get(r["id"], {})
    return rows


def family_detail(db: Database, family_id: str) -> dict[str, Any]:
    """One family as ``list_families`` shapes it, plus ``versions`` (newest first)."""
    fam = get_family(db, family_id)
    out = list_families(db, fam["project_id"], family_id=family_id)[0]
    out["versions"] = list_versions(db, family_id)
    return out


def update_family(db: Database, family_id: str, *, description: str | None = None) -> None:
    get_family(db, family_id)
    if description is not None:
        db.write(
            "UPDATE artifact_families SET description = ?, updated_at = ? WHERE id = ?",
            [description, _now_iso(), family_id],
        )


def delete_family(db: Database, family_id: str) -> None:
    """Delete a family and everything hanging off it (blobs stay: they are
    content-addressed and may be shared)."""
    get_family(db, family_id)
    sub = "SELECT id FROM artifact_versions WHERE family_id = ?"
    db.write(f"DELETE FROM run_inputs WHERE artifact_version_id IN ({sub})", [family_id])
    db.write(f"DELETE FROM artifact_entries WHERE version_id IN ({sub})", [family_id])
    db.write("DELETE FROM artifact_aliases WHERE family_id = ?", [family_id])
    db.write("DELETE FROM artifact_versions WHERE family_id = ?", [family_id])
    db.write("DELETE FROM artifact_families WHERE id = ?", [family_id])


# ---------------------------------------------------------------------------
# Manifests
# ---------------------------------------------------------------------------

def read_manifest(blobs: BlobStore, digest: str) -> list[dict[str, Any]]:
    """The entries of the manifest blob ``digest`` (validated)."""
    if not blobs.exists(digest):
        raise LookupError(f"manifest blob {digest} not found; upload it first")
    data = blobs.get(digest)
    try:
        files = json.loads(data)["files"]
    except (ValueError, KeyError, TypeError) as exc:
        raise ValueError(f"blob {digest} is not an artifact manifest") from exc
    if not isinstance(files, list):
        raise ValueError(f"blob {digest} is not an artifact manifest")
    paths = set()
    for f in files:
        if not isinstance(f, dict) or not isinstance(f.get("path"), str):
            raise ValueError("every manifest entry needs a 'path'")
        if ("hash" in f) == ("uri" in f):
            raise ValueError(f"manifest entry {f['path']!r} needs exactly one of 'hash' or 'uri'")
        if f["path"] in paths:
            raise ValueError(f"manifest has two entries at {f['path']!r}")
        paths.add(f["path"])
    return files


# ---------------------------------------------------------------------------
# Versions
# ---------------------------------------------------------------------------

_VERSION_SELECT = """
    SELECT av.*, af.name AS name, af.type AS type, af.project_id AS project_id
    FROM artifact_versions av
    JOIN artifact_families af ON af.id = av.family_id
"""


def _run_infos(db: Database, run_ids: Iterable[str]) -> dict[str, dict[str, Any]]:
    """``{id: {id, name, status, project_id, created_at, archived}}``; a
    deleted run keeps an entry with ``name`` / ``status`` None."""
    ids = list(run_ids)
    out = {rid: {"id": rid, "name": None, "status": None, "project_id": None,
                 "created_at": None, "archived": False} for rid in ids}
    for i in range(0, len(ids), 500):
        chunk = ids[i:i + 500]
        for r in db.read_columns(
            f"SELECT id, display_name, status, project_id, created_at, archived_at "
            f"FROM runs WHERE id IN ({_holes(chunk)})",
            chunk,
        ):
            out[r["id"]] = {
                "id": r["id"], "name": r["display_name"], "status": r["status"],
                "project_id": r["project_id"], "created_at": r["created_at"],
                "archived": r["archived_at"] is not None,
            }
    return out


def _shape_versions(db: Database, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Version rows -> API dicts (see ``get_version``), batched."""
    if not rows:
        return []
    ids = [r["id"] for r in rows]
    aliases: dict[str, list[str]] = {i: [] for i in ids}
    consumers: dict[str, int] = {}
    for i in range(0, len(ids), 500):
        chunk = ids[i:i + 500]
        for r in db.read_columns(
            f"SELECT version_id, alias FROM artifact_aliases WHERE version_id IN ({_holes(chunk)}) "
            "ORDER BY alias",
            chunk,
        ):
            aliases[r["version_id"]].append(r["alias"])
        for r in db.read_columns(
            f"SELECT artifact_version_id AS vid, COUNT(*) AS n FROM run_inputs "
            f"WHERE artifact_version_id IN ({_holes(chunk)}) GROUP BY artifact_version_id",
            chunk,
        ):
            consumers[r["vid"]] = r["n"]
    producers = _run_infos(db, sorted({r["created_by_run"] for r in rows if r.get("created_by_run")}))
    out = []
    for r in rows:
        meta = r.get("metadata")
        try:
            meta = json.loads(meta) if isinstance(meta, str) and meta else (meta or {})
        except ValueError:
            meta = {}
        ref = f"{r['name']}:v{r['version']}"
        names = aliases[r["id"]]
        # ``latest`` first, then the user aliases alphabetically.
        names = (["latest"] if "latest" in names else []) + [a for a in names if a != "latest"]
        producer = r.get("created_by_run")
        out.append({
            "id": r["id"],
            "family_id": r["family_id"],
            "project_id": r["project_id"],
            "name": r["name"],
            "type": r["type"],
            "version": r["version"],
            "ref": ref,
            "qualified_ref": f"{r['project_id']}/{ref}",
            "digest": r["hash"],
            "size": r["size_bytes"],
            "file_count": r["file_count"],
            "ref_count": r["ref_count"],
            "metadata": meta if isinstance(meta, dict) else {},
            "description": r.get("description"),
            "step": r.get("step"),
            "created_at": r["created_at"],
            "aliases": names,
            "tags": json.loads(r["tags"]) if r.get("tags") else [],
            "created_by_run": producer,
            "producer": producers.get(producer) if producer else None,
            "consumer_count": consumers.get(r["id"], 0),
        })
    return out


def _versions_by_ids(db: Database, ids: list[str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for i in range(0, len(ids), 500):
        chunk = ids[i:i + 500]
        out += _shape_versions(db, db.read_columns(
            _VERSION_SELECT + f" WHERE av.id IN ({_holes(chunk)})", chunk,
        ))
    return out


def get_version(db: Database, version_id: str) -> dict[str, Any]:
    """One version as an API dict:

    ``{id, family_id, project_id, name, type, version, ref ("name:vN"),
    qualified_ref ("project/name:vN"), digest (of the manifest), size
    (uploaded bytes; references excluded), file_count, ref_count, metadata,
    description, step, created_at, aliases (``latest`` first), tags, created_by_run,
    producer ({id, name, status, project_id, created_at, archived} | None),
    consumer_count}``.
    """
    rows = db.read_columns(_VERSION_SELECT + " WHERE av.id = ?", [version_id])
    if not rows:
        raise LookupError(f"artifact version {version_id} not found")
    return _shape_versions(db, rows)[0]


def list_versions(db: Database, family_id: str) -> list[dict[str, Any]]:
    """The family's versions, newest first."""
    get_family(db, family_id)
    return _shape_versions(db, db.read_columns(
        _VERSION_SELECT + " WHERE av.family_id = ? ORDER BY av.version DESC", [family_id],
    ))


def create_version(
    db: Database,
    blobs: BlobStore,
    *,
    project_id: str,
    name: str,
    type: str = "artifact",
    digest: str,
    description: str | None = None,
    metadata: dict[str, Any] | None = None,
    step: int | None = None,
    created_by_run: str | None = None,
    aliases: list[str] | None = None,
    tags: list[str] | None = None,
    version_id: str | None = None,
) -> dict[str, Any]:
    """Register the manifest ``digest`` as the next version of ``name``.

    Every call creates a new version (identical content included). The family
    is created on first use with ``type``; a later ``type`` that differs is a
    ``ValueError``. ``latest`` moves to the new version, and so do
    ``aliases`` (user aliases; reserved ones are a ``ValueError``).

    ``version_id`` is client-generated on the WAL path, which makes the op
    idempotent: replaying it finds the version and returns it.
    """
    if version_id is not None and db.read_columns(
        "SELECT 1 FROM artifact_versions WHERE id = ?", [version_id],
    ):
        return get_version(db, version_id)
    validate_name(name)
    user_aliases = [validate_user_alias(a) for a in dict.fromkeys(aliases or [])]
    tag_list = validate_tags(tags)
    files = read_manifest(blobs, digest)
    size = sum(int(f.get("size") or 0) for f in files if "hash" in f)
    n_refs = sum(1 for f in files if "uri" in f)
    now = _now_iso()
    version_id = version_id or _new_id()

    with db.transaction() as con:
        con.execute(
            "INSERT INTO projects (id, name, created_at, description, tags) "
            "VALUES (?, ?, ?, NULL, NULL) ON CONFLICT (id) DO NOTHING",
            [project_id, project_id, now],
        )
        fam = con.execute(
            "SELECT id, type FROM artifact_families WHERE project_id = ? AND name = ?",
            [project_id, name],
        ).fetchone()
        if fam is None:
            family_id = _new_id()
            con.execute(
                "INSERT INTO artifact_families (id, project_id, name, type, description, "
                "created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)",
                [family_id, project_id, name, type, now, now],
            )
        else:
            family_id, family_type = fam
            if family_type != type:
                raise ValueError(
                    f"artifact {name!r} has type {family_type!r}; cannot log a version of "
                    f"type {type!r} (a family keeps one type)"
                )
        (next_version,) = con.execute(
            "SELECT MAX(last_version, (SELECT COALESCE(MAX(version), 0) FROM artifact_versions "
            "WHERE family_id = ?)) + 1 FROM artifact_families WHERE id = ?",
            [family_id, family_id],
        ).fetchone()
        con.execute(
            "UPDATE artifact_families SET last_version = ? WHERE id = ?", [next_version, family_id],
        )
        con.execute(
            """INSERT INTO artifact_versions
                   (id, family_id, version, hash, size_bytes, file_count, ref_count,
                    metadata, description, step, tags, created_at, created_by_run)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [version_id, family_id, next_version, digest, size, len(files), n_refs,
             json.dumps(metadata or {}), description, step, json.dumps(tag_list), now,
             created_by_run or None],
        )
        con.executemany(
            """INSERT INTO artifact_entries
                   (version_id, path, hash, size, mime, object_type, uri, etag, meta)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [(version_id, f["path"], f.get("hash"), f.get("size"), f.get("mime"),
              f.get("object_type"), f.get("uri"), f.get("etag"),
              json.dumps(f["meta"]) if f.get("meta") else None) for f in files],
        )
        for alias in ["latest", *user_aliases]:
            con.execute(
                """INSERT INTO artifact_aliases (family_id, alias, version_id) VALUES (?, ?, ?)
                   ON CONFLICT (family_id, alias) DO UPDATE SET version_id = EXCLUDED.version_id""",
                [family_id, alias, version_id],
            )
        con.execute(
            "UPDATE artifact_families SET updated_at = ? WHERE id = ?", [now, family_id],
        )
        if type == VIEWER_TYPE and name.startswith("cairn."):
            raise ValueError(f"viewer names starting with 'cairn.' are reserved for built-in viewers: {name!r}")
        if type == VIEWER_TYPE and isinstance((metadata or {}).get("manifest"), dict):
            # A viewer: the defaults it declares, and the custom kinds it is the first for.
            viewer_defaults.apply_publish(
                con, project_id, name, metadata["manifest"], metadata.get("default_for"),
            )
    return get_version(db, version_id)


def version_files(db: Database, version_id: str) -> list[dict[str, Any]]:
    """The version's entries, by path: ``{path, size, digest, mime,
    object_type, uri, etag, meta}`` (``digest`` None for a reference, ``uri``
    None otherwise)."""
    get_version(db, version_id)
    return [
        {
            "path": r["path"], "size": r["size"], "digest": r["hash"], "mime": r["mime"],
            "object_type": r["object_type"], "uri": r["uri"], "etag": r["etag"],
            "meta": json.loads(r["meta"]) if r["meta"] else {},
        }
        for r in db.read_columns(
            "SELECT * FROM artifact_entries WHERE version_id = ? ORDER BY path", [version_id],
        )
    ]


def version_file(db: Database, version_id: str, path: str) -> dict[str, Any]:
    """One entry of the version (``version_files`` shape)."""
    get_version(db, version_id)
    rows = db.read_columns(
        "SELECT * FROM artifact_entries WHERE version_id = ? AND path = ?", [version_id, path],
    )
    if not rows:
        raise LookupError(f"no entry {path!r} in artifact version {version_id}")
    r = rows[0]
    return {
        "path": r["path"], "size": r["size"], "digest": r["hash"], "mime": r["mime"],
        "object_type": r["object_type"], "uri": r["uri"], "etag": r["etag"],
        "meta": json.loads(r["meta"]) if r["meta"] else {},
    }


def version_consumers(db: Database, version_id: str) -> list[dict[str, Any]]:
    """Runs that consumed the version, oldest consumption first:
    ``{run: {id, name, status, project_id, created_at, archived}, role, used_at}``."""
    get_version(db, version_id)
    rows = db.read_columns(
        "SELECT run_id, role, created_at FROM run_inputs WHERE artifact_version_id = ? "
        "ORDER BY created_at, run_id",
        [version_id],
    )
    infos = _run_infos(db, [r["run_id"] for r in rows])
    return [{"run": infos[r["run_id"]], "role": r["role"], "used_at": r["created_at"]} for r in rows]


# ---------------------------------------------------------------------------
# Aliases
# ---------------------------------------------------------------------------

def add_alias(db: Database, version_id: str, alias: str) -> dict[str, Any]:
    """Point the user alias at ``version_id``, moving it within the family."""
    validate_user_alias(alias)
    ver = get_version(db, version_id)
    db.write(
        """INSERT INTO artifact_aliases (family_id, alias, version_id) VALUES (?, ?, ?)
           ON CONFLICT (family_id, alias) DO UPDATE SET version_id = EXCLUDED.version_id""",
        [ver["family_id"], alias, version_id],
    )
    return get_version(db, version_id)


def remove_alias(db: Database, version_id: str, alias: str) -> dict[str, Any]:
    """Remove the user alias from ``version_id`` (a no-op when it is not there)."""
    validate_user_alias(alias)
    get_version(db, version_id)
    db.write(
        "DELETE FROM artifact_aliases WHERE version_id = ? AND alias = ?", [version_id, alias],
    )
    return get_version(db, version_id)


# ---------------------------------------------------------------------------
# Tags, edits, deletes
# ---------------------------------------------------------------------------

def _set_tags(db: Database, version_id: str, tags: list[str]) -> dict[str, Any]:
    db.write("UPDATE artifact_versions SET tags = ? WHERE id = ?", [json.dumps(tags), version_id])
    return get_version(db, version_id)


def add_tag(db: Database, version_id: str, tag: str) -> dict[str, Any]:
    """Add a tag to the version (a no-op when it has it)."""
    (tag,) = validate_tags([tag])
    tags = get_version(db, version_id)["tags"]
    return _set_tags(db, version_id, tags if tag in tags else [*tags, tag])


def remove_tag(db: Database, version_id: str, tag: str) -> dict[str, Any]:
    """Remove a tag from the version (a no-op when it does not have it)."""
    tags = get_version(db, version_id)["tags"]
    return _set_tags(db, version_id, [t for t in tags if t != tag])


def update_version(
    db: Database, version_id: str, *, description: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Replace the description and/or shallow-merge keys into the metadata
    (a key set to None is stored as None, not removed). The manifest is
    immutable; only these annotations change."""
    ver = get_version(db, version_id)
    if description is not None:
        db.write("UPDATE artifact_versions SET description = ? WHERE id = ?", [description, version_id])
    if metadata is not None:
        if not isinstance(metadata, dict):
            raise ValueError("metadata must be a dict")
        db.write(
            "UPDATE artifact_versions SET metadata = ? WHERE id = ?",
            [json.dumps({**ver["metadata"], **metadata}), version_id],
        )
    return get_version(db, version_id)


def _move_latest(con: Any, family_id: str) -> None:
    """Point ``latest`` at the family's newest version (or nowhere)."""
    con.execute("DELETE FROM artifact_aliases WHERE family_id = ? AND alias = 'latest'", [family_id])
    row = con.execute(
        "SELECT id FROM artifact_versions WHERE family_id = ? ORDER BY version DESC LIMIT 1",
        [family_id],
    ).fetchone()
    if row:
        con.execute(
            "INSERT INTO artifact_aliases (family_id, alias, version_id) VALUES (?, 'latest', ?)",
            [family_id, row[0]],
        )


def delete_version(db: Database, version_id: str, *, force: bool = False) -> None:
    """Delete one version (its entries, aliases and consumption records).

    A version that any alias names (``latest`` included, as in wandb) is
    refused with ``ValueError`` unless ``force``; forcing it drops its
    aliases and moves ``latest`` to the newest remaining version. Version
    numbers are never reused. Blobs stay (content-addressed, maybe shared).
    """
    ver = get_version(db, version_id)
    if ver["aliases"] and not force:
        raise ValueError(
            f"{ver['ref']} has aliases ({', '.join(ver['aliases'])}); remove them first or force"
        )
    with db.transaction() as con:
        con.execute("DELETE FROM run_inputs WHERE artifact_version_id = ?", [version_id])
        con.execute("DELETE FROM artifact_entries WHERE version_id = ?", [version_id])
        con.execute("DELETE FROM artifact_aliases WHERE version_id = ?", [version_id])
        con.execute("DELETE FROM artifact_versions WHERE id = ?", [version_id])
        _move_latest(con, ver["family_id"])
        con.execute(
            "UPDATE artifact_families SET updated_at = ? WHERE id = ?",
            [_now_iso(), ver["family_id"]],
        )


# ---------------------------------------------------------------------------
# Ref resolution
# ---------------------------------------------------------------------------

def resolve_ref(db: Database, project_id: str | None, ref: str) -> dict[str, Any]:
    """``[project/]name[:alias|:vN]`` -> the version dict (``get_version``)."""
    project, name, qualifier = parse_ref(ref, project_id)
    family = get_family_by_name(db, project, name)
    if family is None:
        raise LookupError(f"no artifact {name!r} in project {project!r}")
    if qualifier.startswith("v") and qualifier[1:].isdigit():
        rows = db.read_columns(
            "SELECT id FROM artifact_versions WHERE family_id = ? AND version = ?",
            [family["id"], int(qualifier[1:])],
        )
        if not rows:
            raise LookupError(f"artifact {name!r} has no version {qualifier}")
    else:
        rows = db.read_columns(
            "SELECT version_id AS id FROM artifact_aliases WHERE family_id = ? AND alias = ?",
            [family["id"], qualifier],
        )
        if not rows:
            raise LookupError(f"artifact {name!r} has no alias {qualifier!r}")
    return get_version(db, rows[0]["id"])


# ---------------------------------------------------------------------------
# Run inputs / outputs
# ---------------------------------------------------------------------------

def record_input(
    db: Database, *, run_id: str, artifact_version_id: str, role: str = "input",
) -> None:
    """Record that ``run_id`` consumed the version (idempotent: the first
    record, and its role, stay)."""
    db.write(
        """INSERT INTO run_inputs (run_id, artifact_version_id, role, created_at)
           VALUES (?, ?, ?, ?) ON CONFLICT (run_id, artifact_version_id) DO NOTHING""",
        [run_id, artifact_version_id, role, _now_iso()],
    )


def run_outputs(db: Database, run_id: str) -> list[dict[str, Any]]:
    """Versions the run logged, in creation order."""
    return _shape_versions(db, db.read_columns(
        _VERSION_SELECT + " WHERE av.created_by_run = ? ORDER BY av.created_at, av.version",
        [run_id],
    ))


def run_inputs(db: Database, run_id: str, role: str | None = None) -> list[dict[str, Any]]:
    """Versions the run consumed, in consumption order, each with ``role`` and
    ``used_at``; only ``role``'s when given."""
    sql = "SELECT artifact_version_id AS id, role, created_at FROM run_inputs WHERE run_id = ?"
    params: list[Any] = [run_id]
    if role is not None:
        sql += " AND role = ?"
        params.append(role)
    inputs = db.read_columns(sql + " ORDER BY created_at, artifact_version_id", params)
    by_id = {v["id"]: v for v in _versions_by_ids(db, [i["id"] for i in inputs])}
    return [
        {**by_id[i["id"]], "role": i["role"], "used_at": i["created_at"]}
        for i in inputs if i["id"] in by_id
    ]


# ---------------------------------------------------------------------------
# Run -> run links (``run.use_run``)
# ---------------------------------------------------------------------------

def record_run_use(
    db: Database, *, run_id: str, used_run_id: str, role: str | None = None,
) -> None:
    """Record that ``run_id`` used ``used_run_id`` directly (idempotent: the
    first record, and its role, stay). A self-link is refused."""
    if run_id == used_run_id:
        raise ValueError("a run cannot use itself")
    db.write(
        """INSERT INTO run_links (run_id, used_run_id, role, created_at)
           VALUES (?, ?, ?, ?) ON CONFLICT (run_id, used_run_id) DO NOTHING""",
        [run_id, used_run_id, role, _now_iso()],
    )


def run_uses(db: Database, run_id: str) -> dict[str, list[dict[str, Any]]]:
    """``{uses: [{run_id, role}], used_by: [{run_id, role}]}``: the runs
    ``run_id`` used and the runs that used it, in link order."""
    uses = db.read_columns(
        "SELECT used_run_id AS run_id, role FROM run_links WHERE run_id = ? "
        "ORDER BY created_at, used_run_id",
        [run_id],
    )
    used_by = db.read_columns(
        "SELECT run_id, role FROM run_links WHERE used_run_id = ? ORDER BY created_at, run_id",
        [run_id],
    )
    return {"uses": uses, "used_by": used_by}


# ---------------------------------------------------------------------------
# Lineage
# ---------------------------------------------------------------------------
#
# A lineage graph is ``{nodes, edges, groups[, center]}``:
#
# * version node: ``{kind: "artifact_version", id, label ("name:vN"), type
#   (the artifact type), name, family_id, project_id, version, ref,
#   qualified_ref, aliases, tags, step, created_at, file_count, size, degree,
#   group_key}``;
# * run node: ``{kind: "run", id, label (name, else the id's first 8), name,
#   status, tags, group, job_type, project_id, created_at, archived, degree,
#   group_key}``;
# * edge: ``{source, target, kind: "produced" (run -> version) | "consumed"
#   (version -> run, with ``role``) | "forked" (run -> run) | "used" (used
#   run -> using run, with ``role``: ``run.use_run``)}``.
#
# ``degree`` is ``{in, out}`` within the returned graph; ``full_degree`` is
# ``{in, out}`` over the node's produced/consumed/used edges in the whole repo
# (what one-hop expansions from it can add: a viewer compares the two to show
# "more upstream / downstream"). Clustering: nodes of
# one kind whose edges are identical (same neighbours, kinds, roles and
# directions) and, for versions, of one artifact name, are SIBLINGS and share
# a ``group_key`` (null for a node without siblings). With ``cluster=N``,
# every sibling set larger than N (the centre never included) is collapsed
# into one group node ``{kind: "group", id: "group:<key>", group_key,
# member_kind, count, members: [ids], label}``, which takes over the
# members' edges (deduplicated; ``count`` on each edge says how many member
# edges it stands for). ``groups`` lists every sibling set as ``{group_key,
# member_kind, members}`` either way, so a client can cluster or expand
# without asking again.

def _version_node(v: dict[str, Any]) -> dict[str, Any]:
    return {
        "kind": "artifact_version", "id": v["id"], "label": v["ref"], "type": v["type"],
        "name": v["name"], "family_id": v["family_id"], "project_id": v["project_id"],
        "version": v["version"], "ref": v["ref"], "qualified_ref": v["qualified_ref"],
        "aliases": v["aliases"], "tags": v["tags"], "step": v["step"],
        "created_at": v["created_at"], "file_count": v["file_count"], "size": v["size"],
    }


def _run_nodes(db: Database, run_ids: list[str]) -> list[dict[str, Any]]:
    """Run nodes; a deleted run keeps a node (its edges need an endpoint)."""
    info: dict[str, dict[str, Any]] = {}
    for i in range(0, len(run_ids), 500):
        chunk = run_ids[i:i + 500]
        for r in db.read_columns(
            f"SELECT id, display_name, status, tags, run_group, job_type, project_id, "
            f"created_at, archived_at FROM runs WHERE id IN ({_holes(chunk)})",
            chunk,
        ):
            info[r["id"]] = r
    out = []
    for rid in run_ids:
        r = info.get(rid)
        name = r["display_name"] if r else None
        out.append({
            "kind": "run", "id": rid, "label": name or rid[:8], "name": name,
            "status": r["status"] if r else None,
            "tags": json.loads(r["tags"]) if r and r["tags"] else [],
            "group": r["run_group"] if r else None,
            "job_type": r["job_type"] if r else None,
            "project_id": r["project_id"] if r else None,
            "created_at": str(r["created_at"]) if r else None,
            "archived": bool(r and r["archived_at"]),
            "deleted": r is None,
        })
    return out


def _produced(run_id: str, version_id: str) -> dict[str, Any]:
    return {"source": run_id, "target": version_id, "kind": "produced"}


def _consumed(version_id: str, run_id: str, role: str) -> dict[str, Any]:
    return {"source": version_id, "target": run_id, "kind": "consumed", "role": role}


def _used(used_run_id: str, run_id: str, role: str | None) -> dict[str, Any]:
    return {"source": used_run_id, "target": run_id, "kind": "used", "role": role}


def _full_degrees(
    db: Database, version_ids: list[str], run_ids: list[str],
) -> dict[str, dict[str, int]]:
    """``{id: {in, out}}`` over every produced/consumed/used edge in the
    repo: a version's producer (0 or 1) and consumers, a run's inputs and
    the runs it used, its outputs and the runs that used it."""
    out = {i: {"in": 0, "out": 0} for i in [*version_ids, *run_ids]}
    for i in range(0, len(version_ids), 500):
        chunk = version_ids[i:i + 500]
        for r in db.read_columns(
            f"SELECT id FROM artifact_versions WHERE id IN ({_holes(chunk)}) "
            "AND created_by_run IS NOT NULL",
            chunk,
        ):
            out[r["id"]]["in"] = 1
        for r in db.read_columns(
            f"SELECT artifact_version_id AS vid, COUNT(*) AS n FROM run_inputs "
            f"WHERE artifact_version_id IN ({_holes(chunk)}) GROUP BY artifact_version_id",
            chunk,
        ):
            out[r["vid"]]["out"] = r["n"]
    for i in range(0, len(run_ids), 500):
        chunk = run_ids[i:i + 500]
        for r in db.read_columns(
            f"SELECT run_id, COUNT(*) AS n FROM run_inputs WHERE run_id IN ({_holes(chunk)}) "
            "GROUP BY run_id",
            chunk,
        ):
            out[r["run_id"]]["in"] = r["n"]
        for r in db.read_columns(
            f"SELECT created_by_run AS rid, COUNT(*) AS n FROM artifact_versions "
            f"WHERE created_by_run IN ({_holes(chunk)}) GROUP BY created_by_run",
            chunk,
        ):
            out[r["rid"]]["out"] = r["n"]
        for r in db.read_columns(
            f"SELECT run_id, COUNT(*) AS n FROM run_links WHERE run_id IN ({_holes(chunk)}) "
            "GROUP BY run_id",
            chunk,
        ):
            out[r["run_id"]]["in"] += r["n"]
        for r in db.read_columns(
            f"SELECT used_run_id AS rid, COUNT(*) AS n FROM run_links "
            f"WHERE used_run_id IN ({_holes(chunk)}) GROUP BY used_run_id",
            chunk,
        ):
            out[r["rid"]]["out"] += r["n"]
    return out


def _graph(
    db: Database, version_ids: Iterable[str], run_ids: Iterable[str],
    edges: list[dict[str, Any]], *, center: str | None = None, cluster: int | None = None,
) -> dict[str, Any]:
    versions = _versions_by_ids(db, list(dict.fromkeys(version_ids)))
    nodes = [_version_node(v) for v in versions] + _run_nodes(db, list(dict.fromkeys(run_ids)))
    by_id = {n["id"]: n for n in nodes}
    ins: dict[str, list[tuple]] = {n["id"]: [] for n in nodes}
    full = _full_degrees(db, [n["id"] for n in nodes if n["kind"] == "artifact_version"],
                         [n["id"] for n in nodes if n["kind"] == "run"])
    for n in nodes:
        n["degree"] = {"in": 0, "out": 0}
        n["full_degree"] = full[n["id"]]
        n["group_key"] = None
    for e in edges:
        if e["source"] in by_id:
            by_id[e["source"]]["degree"]["out"] += 1
        if e["target"] in by_id:
            by_id[e["target"]]["degree"]["in"] += 1
            ins[e["target"]].append((e["source"], e["kind"], e.get("role")))
    import hashlib

    def key_of(parts: Any) -> str:
        return hashlib.sha1(json.dumps(parts, default=str).encode()).hexdigest()[:16]

    def collect(kind: str, keyf: Any) -> dict[str, list[str]]:
        sets: dict[str, list[str]] = {}
        for n in nodes:
            if n["kind"] != kind or n["id"] == center:
                continue
            k = keyf(n)
            if k is not None:
                sets.setdefault(k, []).append(n["id"])
        return {k: m for k, m in sets.items() if len(m) > 1}

    # Runs: siblings share their inputs (e.g. every run that used one dataset).
    run_sets = collect("run", lambda n: key_of(["run", sorted(ins[n["id"]], key=str)])
                       if ins[n["id"]] else None)
    for k, members in run_sets.items():
        for m in members:
            by_id[m]["group_key"] = k

    # Versions: siblings share their artifact name and producer, a producer in
    # a run group counting as the group (each sibling run's checkpoint).
    def version_key(n: dict[str, Any]) -> str | None:
        src = [(by_id[s_]["group_key"] or s_) if s_ in by_id else s_ for s_, _k, _r in ins[n["id"]]]
        if not src and not n["degree"]["out"]:
            return None
        return key_of(["artifact_version", n["name"], sorted(src)])

    version_sets = collect("artifact_version", version_key)
    for k, members in version_sets.items():
        for m in members:
            by_id[m]["group_key"] = k
    groups = [
        {"group_key": k, "member_kind": by_id[m[0]]["kind"], "members": m}
        for k, m in [*run_sets.items(), *version_sets.items()]
    ]

    out: dict[str, Any] = {"nodes": nodes, "edges": edges, "groups": groups}
    if cluster is not None:
        collapse = {g["group_key"]: g for g in groups if len(g["members"]) > cluster}
        member_of = {m: f"group:{k}" for k, g in collapse.items() for m in g["members"]}
        kept = [n for n in nodes if n["id"] not in member_of]
        for k, g in collapse.items():
            first = by_id[g["members"][0]]
            what = (f"{first['name']} versions" if g["member_kind"] == "artifact_version" else "runs")
            kept.append({
                "kind": "group", "id": f"group:{k}", "group_key": k,
                "member_kind": g["member_kind"], "count": len(g["members"]),
                "members": g["members"], "label": f"{len(g['members'])} {what}",
            })
        merged: dict[tuple, dict[str, Any]] = {}
        for e in edges:
            src, tgt = member_of.get(e["source"], e["source"]), member_of.get(e["target"], e["target"])
            k2 = (src, tgt, e["kind"], e.get("role"))
            if k2 in merged:
                merged[k2]["count"] += 1
            else:
                merged[k2] = {**e, "source": src, "target": tgt, "count": 1}
        out["nodes"], out["edges"] = kept, list(merged.values())
    if center is not None:
        out["center"] = center
    return out


def lineage_graph(
    db: Database,
    *,
    version_id: str | None = None,
    run_id: str | None = None,
    depth: int | None = None,
    direction: str = "both",
    cluster: int | None = None,
) -> dict[str, Any]:
    """The lineage around one version or run: ``{nodes, edges, groups, center}``
    (shapes and clustering: see the section comment above).

    Walks the run/version graph from the centre, at most ``depth`` hops
    (None: unbounded). ``upstream`` follows where the centre came from (a
    version's producing run, a run's inputs and the runs it used, their
    producers, ...), ``downstream`` what came of it (a version's consumers, a
    run's outputs and the runs that used it, ...); ``both`` is the union of the two walks (it never turns around, so
    siblings of the centre are not pulled in).
    """
    if direction not in ("upstream", "downstream", "both"):
        raise ValueError("direction must be upstream, downstream or both")
    if (version_id is None) == (run_id is None):
        raise ValueError("pass exactly one of version_id or run_id")
    if depth is not None and depth < 0:
        raise ValueError("depth must be >= 0")
    if cluster is not None and cluster < 1:
        raise ValueError("cluster must be >= 1")
    if version_id is not None:
        get_version(db, version_id)
        start = ("v", version_id)
    else:
        if not db.read_columns("SELECT 1 FROM runs WHERE id = ?", [run_id]):
            raise LookupError(f"run {run_id} not found")
        start = ("r", str(run_id))

    found: dict[tuple[str, str], None] = {start: None}
    edges: dict[tuple[str, str, str], dict[str, Any]] = {}

    def step(kind: str, ident: str, up: bool) -> list[tuple[str, str]]:
        out: list[tuple[str, str]] = []
        if kind == "v" and up:
            row = db.read_one("SELECT created_by_run FROM artifact_versions WHERE id = ?", [ident])
            if row and row[0]:
                edges[(row[0], ident, "produced")] = _produced(row[0], ident)
                out.append(("r", row[0]))
        elif kind == "v":
            for r in db.read_columns(
                "SELECT run_id, role FROM run_inputs WHERE artifact_version_id = ? "
                "ORDER BY created_at",
                [ident],
            ):
                edges[(ident, r["run_id"], "consumed")] = _consumed(ident, r["run_id"], r["role"])
                out.append(("r", r["run_id"]))
        elif up:
            for r in db.read_columns(
                "SELECT artifact_version_id AS vid, role FROM run_inputs WHERE run_id = ? "
                "ORDER BY created_at",
                [ident],
            ):
                edges[(r["vid"], ident, "consumed")] = _consumed(r["vid"], ident, r["role"])
                out.append(("v", r["vid"]))
            for r in db.read_columns(
                "SELECT used_run_id, role FROM run_links WHERE run_id = ? ORDER BY created_at",
                [ident],
            ):
                edges[(r["used_run_id"], ident, "used")] = _used(r["used_run_id"], ident, r["role"])
                out.append(("r", r["used_run_id"]))
        else:
            for r in db.read_columns(
                "SELECT id FROM artifact_versions WHERE created_by_run = ? ORDER BY created_at",
                [ident],
            ):
                edges[(ident, r["id"], "produced")] = _produced(ident, r["id"])
                out.append(("v", r["id"]))
            for r in db.read_columns(
                "SELECT run_id, role FROM run_links WHERE used_run_id = ? ORDER BY created_at",
                [ident],
            ):
                edges[(ident, r["run_id"], "used")] = _used(ident, r["run_id"], r["role"])
                out.append(("r", r["run_id"]))
        return out

    walks = {"upstream": [True], "downstream": [False], "both": [True, False]}[direction]
    for up in walks:
        seen = {start}
        queue: deque[tuple[tuple[str, str], int]] = deque([(start, 0)])
        while queue:
            node, d = queue.popleft()
            if depth is not None and d >= depth:
                continue
            for nxt in step(*node, up):
                found.setdefault(nxt)
                if nxt not in seen:
                    seen.add(nxt)
                    queue.append((nxt, d + 1))
    return _graph(
        db,
        [i for k, i in found if k == "v"],
        [i for k, i in found if k == "r"],
        list(edges.values()),
        center=start[1],
        cluster=cluster,
    )


def project_lineage(
    db: Database, project_id: str, *, family_id: str | None = None,
    cluster: int | None = None,
) -> dict[str, Any]:
    """The whole project's lineage (or one family's): every version with its
    producer and consumer edges, plus ``forked`` and ``used`` run -> run
    edges for the whole project (a ``used`` edge counts when the using run
    is in the project). Shapes and clustering as ``lineage_graph``."""
    if cluster is not None and cluster < 1:
        raise ValueError("cluster must be >= 1")
    if family_id:
        vrows = db.read_columns(
            "SELECT id, created_by_run FROM artifact_versions WHERE family_id = ? ORDER BY version",
            [family_id],
        )
    else:
        vrows = db.read_columns(
            """SELECT av.id, av.created_by_run FROM artifact_versions av
               JOIN artifact_families af ON af.id = av.family_id
               WHERE af.project_id = ? ORDER BY av.created_at""",
            [project_id],
        )
    runs: dict[str, None] = {}
    edges: list[dict[str, Any]] = []
    for v in vrows:
        if v["created_by_run"]:
            runs.setdefault(v["created_by_run"])
            edges.append(_produced(v["created_by_run"], v["id"]))
    ids = [v["id"] for v in vrows]
    for i in range(0, len(ids), 500):
        chunk = ids[i:i + 500]
        for r in db.read_columns(
            f"SELECT run_id, artifact_version_id AS vid, role FROM run_inputs "
            f"WHERE artifact_version_id IN ({_holes(chunk)}) ORDER BY created_at",
            chunk,
        ):
            runs.setdefault(r["run_id"])
            edges.append(_consumed(r["vid"], r["run_id"], r["role"]))
    if not family_id:
        for fork in db.read_columns(
            "SELECT id, parent_run_id FROM runs "
            "WHERE project_id = ? AND parent_run_id IS NOT NULL ORDER BY created_at",
            [project_id],
        ):
            runs.setdefault(fork["parent_run_id"])
            runs.setdefault(fork["id"])
            edges.append({"source": fork["parent_run_id"], "target": fork["id"], "kind": "forked"})
        for link in db.read_columns(
            """SELECT l.run_id, l.used_run_id, l.role FROM run_links l
               JOIN runs r ON r.id = l.run_id
               WHERE r.project_id = ? ORDER BY l.created_at""",
            [project_id],
        ):
            runs.setdefault(link["used_run_id"])
            runs.setdefault(link["run_id"])
            edges.append(_used(link["used_run_id"], link["run_id"], link["role"]))
    return _graph(db, ids, runs, edges, cluster=cluster)
