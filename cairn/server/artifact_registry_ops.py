"""Pure artifact-registry operations, independent of HTTP.

Follows the same pattern as ``ingest_ops.py``: pure functions taking
``Database`` and ``BlobStore``, raising ``ValueError`` / ``LookupError``
on user errors.  Callers translate those to HTTP status codes.
"""

from __future__ import annotations

import json
import secrets
from typing import Any

from .routes._common import slugify, utc_now
from .storage.blobs import BlobStore
from .storage.db import Database


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _new_id() -> str:
    return secrets.token_hex(8)


def _now_iso() -> str:
    return utc_now().isoformat()


# ---------------------------------------------------------------------------
# Families
# ---------------------------------------------------------------------------

def get_or_create_family(
    db: Database,
    *,
    project_id: str,
    name: str,
    type: str = "artifact",
    description: str | None = None,
) -> dict[str, Any]:
    """INSERT OR IGNORE, then SELECT.  Auto-creates the project if needed."""
    now = _now_iso()
    family_id = _new_id()

    with db.transaction() as con:
        # Auto-create project
        con.execute(
            """
            INSERT INTO projects (id, name, created_at, description, tags)
            VALUES (?, ?, ?, NULL, NULL)
            ON CONFLICT (id) DO NOTHING
            """,
            [project_id, project_id, now],
        )
        con.execute(
            """
            INSERT INTO artifact_families (id, project_id, name, type, description, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (project_id, name) DO NOTHING
            """,
            [family_id, project_id, name, type, description, now, now],
        )

    rows = db.read_columns(
        "SELECT * FROM artifact_families WHERE project_id = ? AND name = ?",
        [project_id, name],
    )
    return rows[0]


def get_family(db: Database, family_id: str) -> dict[str, Any]:
    rows = db.read_columns(
        "SELECT * FROM artifact_families WHERE id = ?", [family_id]
    )
    if not rows:
        raise LookupError(f"artifact family {family_id} not found")
    return rows[0]


def get_family_by_name(
    db: Database, project_id: str, name: str
) -> dict[str, Any] | None:
    rows = db.read_columns(
        "SELECT * FROM artifact_families WHERE project_id = ? AND name = ?",
        [project_id, name],
    )
    return rows[0] if rows else None


def list_families(
    db: Database,
    project_id: str,
    *,
    type_filter: str | None = None,
) -> list[dict[str, Any]]:
    """List families with aggregated version stats and aliases."""
    where = "WHERE af.project_id = ?"
    params: list[Any] = [project_id]
    if type_filter is not None:
        where += " AND af.type = ?"
        params.append(type_filter)

    rows = db.read_columns(
        f"""
        SELECT
            af.id, af.project_id, af.name, af.type, af.description,
            af.created_at, af.updated_at,
            COALESCE(MAX(av.version), 0)   AS latest_version,
            COUNT(av.id)                   AS total_versions,
            COALESCE(SUM(av.size_bytes), 0) AS total_size
        FROM artifact_families af
        LEFT JOIN artifact_versions av ON av.family_id = af.id
        {where}
        GROUP BY af.id
        ORDER BY af.updated_at DESC
        """,
        params,
    )

    # Fetch aliases per family in one query
    family_ids = [r["id"] for r in rows]
    alias_map: dict[str, list[str]] = {fid: [] for fid in family_ids}
    if family_ids:
        placeholders = ",".join("?" for _ in family_ids)
        alias_rows = db.read_columns(
            f"SELECT family_id, alias FROM artifact_aliases WHERE family_id IN ({placeholders})",
            family_ids,
        )
        for ar in alias_rows:
            alias_map[ar["family_id"]].append(ar["alias"])

    for r in rows:
        r["aliases"] = alias_map.get(r["id"], [])

    return rows


def update_family(
    db: Database, family_id: str, *, description: str | None = None
) -> None:
    get_family(db, family_id)  # ensure exists
    now = _now_iso()
    if description is not None:
        db.write(
            "UPDATE artifact_families SET description = ?, updated_at = ? WHERE id = ?",
            [description, now, family_id],
        )


def delete_family(db: Database, family_id: str) -> None:
    """Delete family and all related rows (inputs, aliases, versions)."""
    get_family(db, family_id)  # ensure exists
    # Delete in FK-safe order, each as its own auto-committed statement
    # (same pattern as delete_run in ingest_ops).
    db.write(
        """
        DELETE FROM run_inputs WHERE artifact_version_id IN (
            SELECT id FROM artifact_versions WHERE family_id = ?
        )
        """,
        [family_id],
    )
    db.write("DELETE FROM artifact_aliases WHERE family_id = ?", [family_id])
    db.write("DELETE FROM artifact_versions WHERE family_id = ?", [family_id])
    db.write("DELETE FROM artifact_families WHERE id = ?", [family_id])


# ---------------------------------------------------------------------------
# Versions
# ---------------------------------------------------------------------------

def create_version(
    db: Database,
    blobs: BlobStore,
    *,
    family_id: str,
    data: bytes,
    mime_type: str,
    metadata: dict[str, Any] | None = None,
    created_by_run: str | None = None,
) -> dict[str, Any]:
    """Store blob, auto-increment version, set 'latest' alias."""
    get_family(db, family_id)  # ensure exists
    now = _now_iso()

    # 1. Store blob
    digest, size = blobs.put(data, mime_type, metadata or {})
    db.write(
        """
        INSERT INTO artifacts (hash, mime_type, size_bytes, metadata, object_type, created_at)
        VALUES (?, ?, ?, ?, NULL, ?)
        ON CONFLICT (hash) DO NOTHING
        """,
        [digest, mime_type, size, json.dumps(metadata or {}), now],
    )

    version_id = _new_id()

    with db.transaction() as con:
        # 2. Auto-increment version
        row = con.execute(
            "SELECT COALESCE(MAX(version), 0) FROM artifact_versions WHERE family_id = ?",
            [family_id],
        ).fetchone()
        next_version = row[0] + 1

        # 3. Insert version
        con.execute(
            """
            INSERT INTO artifact_versions
                (id, family_id, version, hash, size_bytes, metadata, created_at, created_by_run)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                version_id, family_id, next_version, digest, size,
                json.dumps(metadata) if metadata else None,
                now, created_by_run,
            ],
        )

        # 4. Auto-set "latest" alias (UPSERT)
        con.execute(
            """
            INSERT INTO artifact_aliases (family_id, alias, version_id)
            VALUES (?, 'latest', ?)
            ON CONFLICT (family_id, alias) DO UPDATE SET version_id = EXCLUDED.version_id
            """,
            [family_id, version_id],
        )

        # Update family timestamp
        con.execute(
            "UPDATE artifact_families SET updated_at = ? WHERE id = ?",
            [now, family_id],
        )

    return {
        "id": version_id,
        "version": next_version,
        "hash": digest,
        "size_bytes": size,
        "family_id": family_id,
        "created_at": now,
    }


def create_artifact_version(
    db: Database,
    *,
    project_id: str,
    family_name: str,
    family_type: str = "artifact",
    digest: str,
    size_bytes: int,
    metadata: dict[str, Any] | None = None,
    created_by_run: str | None = None,
    aliases: list[str] | None = None,
) -> dict[str, Any]:
    """High-level: ensure family exists, create version from pre-uploaded blob."""
    family = get_or_create_family(db, project_id=project_id, name=family_name, type=family_type)
    family_id = family["id"]
    now = _now_iso()
    version_id = _new_id()

    with db.transaction() as con:
        row = con.execute(
            "SELECT COALESCE(MAX(version), 0) FROM artifact_versions WHERE family_id = ?",
            [family_id],
        ).fetchone()
        next_version = row[0] + 1

        con.execute(
            """
            INSERT INTO artifact_versions
                (id, family_id, version, hash, size_bytes, metadata, created_at, created_by_run)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [version_id, family_id, next_version, digest, size_bytes,
             json.dumps(metadata) if metadata else None, now, created_by_run],
        )

        for alias in (aliases or ["latest"]):
            con.execute(
                """
                INSERT INTO artifact_aliases (family_id, alias, version_id)
                VALUES (?, ?, ?)
                ON CONFLICT (family_id, alias) DO UPDATE SET version_id = EXCLUDED.version_id
                """,
                [family_id, alias, version_id],
            )

        con.execute(
            "UPDATE artifact_families SET updated_at = ? WHERE id = ?",
            [now, family_id],
        )

    return {
        "id": version_id,
        "family_id": family_id,
        "family_name": family_name,
        "version": next_version,
        "hash": digest,
        "size_bytes": size_bytes,
        "metadata": metadata or {},
        "created_at": now,
    }


def list_versions(db: Database, family_id: str) -> list[dict[str, Any]]:
    return db.read_columns(
        "SELECT * FROM artifact_versions WHERE family_id = ? ORDER BY version DESC",
        [family_id],
    )


def get_version(db: Database, version_id: str) -> dict[str, Any]:
    rows = db.read_columns(
        "SELECT * FROM artifact_versions WHERE id = ?", [version_id]
    )
    if not rows:
        raise LookupError(f"artifact version {version_id} not found")
    return rows[0]


def get_version_by_number(
    db: Database, family_id: str, version_num: int
) -> dict[str, Any] | None:
    rows = db.read_columns(
        "SELECT * FROM artifact_versions WHERE family_id = ? AND version = ?",
        [family_id, version_num],
    )
    return rows[0] if rows else None


# ---------------------------------------------------------------------------
# Aliases
# ---------------------------------------------------------------------------

def set_alias(
    db: Database, family_id: str, alias: str, version_id: str
) -> None:
    get_family(db, family_id)
    get_version(db, version_id)
    db.write(
        """
        INSERT INTO artifact_aliases (family_id, alias, version_id)
        VALUES (?, ?, ?)
        ON CONFLICT (family_id, alias) DO UPDATE SET version_id = EXCLUDED.version_id
        """,
        [family_id, alias, version_id],
    )


def delete_alias(db: Database, family_id: str, alias: str) -> None:
    db.write(
        "DELETE FROM artifact_aliases WHERE family_id = ? AND alias = ?",
        [family_id, alias],
    )


# ---------------------------------------------------------------------------
# Ref resolution
# ---------------------------------------------------------------------------

def resolve_ref(
    db: Database, project_id: str, ref_str: str
) -> dict[str, Any]:
    """Parse ``name:alias`` or ``name:vN`` and return the version row + family info."""
    if ":" not in ref_str:
        raise ValueError(
            f"Invalid ref '{ref_str}': expected 'name:alias' or 'name:vN'"
        )
    name, qualifier = ref_str.rsplit(":", 1)
    family = get_family_by_name(db, project_id, name)
    if family is None:
        raise LookupError(f"artifact family '{name}' not found in project {project_id}")

    # Try vN format
    if qualifier.startswith("v") and qualifier[1:].isdigit():
        version_num = int(qualifier[1:])
        ver = get_version_by_number(db, family["id"], version_num)
        if ver is None:
            raise LookupError(
                f"version {version_num} not found for '{name}'"
            )
    else:
        # Treat as alias
        rows = db.read_columns(
            """
            SELECT av.* FROM artifact_aliases aa
            JOIN artifact_versions av ON av.id = aa.version_id
            WHERE aa.family_id = ? AND aa.alias = ?
            """,
            [family["id"], qualifier],
        )
        if not rows:
            raise LookupError(
                f"alias '{qualifier}' not found for '{name}'"
            )
        ver = rows[0]

    ver["family"] = family
    return ver


# ---------------------------------------------------------------------------
# Run inputs / outputs / lineage
# ---------------------------------------------------------------------------

def record_input(
    db: Database,
    *,
    run_id: str,
    artifact_version_id: str,
    role: str = "input",
) -> None:
    now = _now_iso()
    db.write(
        """
        INSERT INTO run_inputs (run_id, artifact_version_id, role, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (run_id, artifact_version_id) DO NOTHING
        """,
        [run_id, artifact_version_id, role, now],
    )


def get_run_inputs(db: Database, run_id: str) -> list[dict[str, Any]]:
    return db.read_columns(
        """
        SELECT ri.run_id, ri.artifact_version_id, ri.role, ri.created_at,
               av.version, av.hash, av.size_bytes, av.family_id,
               af.name AS family_name, af.project_id
        FROM run_inputs ri
        JOIN artifact_versions av ON av.id = ri.artifact_version_id
        JOIN artifact_families af ON af.id = av.family_id
        WHERE ri.run_id = ?
        """,
        [run_id],
    )


def get_run_outputs(db: Database, run_id: str) -> list[dict[str, Any]]:
    return db.read_columns(
        """
        SELECT av.id, av.family_id, av.version, av.hash, av.size_bytes,
               av.metadata, av.created_at,
               af.name AS family_name, af.project_id
        FROM artifact_versions av
        JOIN artifact_families af ON af.id = av.family_id
        WHERE av.created_by_run = ?
        ORDER BY av.version
        """,
        [run_id],
    )


def get_lineage_graph(
    db: Database,
    project_id: str,
    *,
    family_id: str | None = None,
    depth: int | None = None,
) -> dict[str, Any]:
    """Build a DAG of artifact versions and runs.

    Returns ``{"nodes": [...], "edges": [...]}``.
    Nodes have ``type`` = "artifact_version" or "run".
    Edges have ``source``, ``target``, ``relation`` ("produced" or "consumed").
    """
    # Gather all versions in the project (optionally filtered by family)
    if family_id:
        versions = db.read_columns(
            """
            SELECT av.*, af.name AS family_name
            FROM artifact_versions av
            JOIN artifact_families af ON af.id = av.family_id
            WHERE af.id = ?
            """,
            [family_id],
        )
    else:
        versions = db.read_columns(
            """
            SELECT av.*, af.name AS family_name
            FROM artifact_versions av
            JOIN artifact_families af ON af.id = av.family_id
            WHERE af.project_id = ?
            """,
            [project_id],
        )

    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    seen_runs: set[str] = set()

    for v in versions:
        nodes.append({
            "id": v["id"],
            "type": "artifact_version",
            "family_id": v["family_id"],
            "family_name": v["family_name"],
            "version": v["version"],
        })

        # Producer run -> version edge
        if v["created_by_run"]:
            run_id = v["created_by_run"]
            if run_id not in seen_runs:
                seen_runs.add(run_id)
                nodes.append({"id": run_id, "type": "run"})
            edges.append({
                "source": run_id,
                "target": v["id"],
                "relation": "produced",
            })

    # Consumer edges: run_inputs for versions in scope
    version_ids = [v["id"] for v in versions]
    if version_ids:
        placeholders = ",".join("?" for _ in version_ids)
        inputs = db.read_columns(
            f"""
            SELECT run_id, artifact_version_id
            FROM run_inputs
            WHERE artifact_version_id IN ({placeholders})
            """,
            version_ids,
        )
        for inp in inputs:
            if inp["run_id"] not in seen_runs:
                seen_runs.add(inp["run_id"])
                nodes.append({"id": inp["run_id"], "type": "run"})
            edges.append({
                "source": inp["artifact_version_id"],
                "target": inp["run_id"],
                "relation": "consumed",
            })

    return {"nodes": nodes, "edges": edges}
