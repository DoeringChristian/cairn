"""Read-only Python API for querying Cairn data.

Dual-mode: opens the local ``.cairn/`` database directly, or connects to
a running Cairn server via HTTP. Auto-detects from config resolution.

Usage::

    import cairn

    r = cairn.Reader()  # auto-detect
    run = r.runs(project="demo").filter(status="completed").last()
    print(run.params, run.sequence("loss").values[-1])
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator, Protocol, runtime_checkable

from .. import config as _config


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Project:
    id: str
    name: str
    created_at: str
    run_count: int = 0
    active_run_count: int = 0
    last_run_at: str | None = None

    def __repr__(self) -> str:
        return f"Project({self.id!r}, runs={self.run_count})"


@dataclass(frozen=True)
class GitInfo:
    sha: str | None
    branch: str | None
    dirty: bool | None


@dataclass(frozen=True)
class SequenceInfo:
    name: str
    object_type: str
    context: str | None
    context_hash: str
    min_step: int
    max_step: int
    count: int

    def __repr__(self) -> str:
        return f"SequenceInfo({self.name!r}, type={self.object_type!r}, steps={self.min_step}..{self.max_step}, n={self.count})"


@dataclass(frozen=True)
class SequencePoint:
    step: int
    wall_time: str
    scalar_value: float | None = None
    artifact_hash: str | None = None
    artifact_metadata: str | None = None
    object_type: str = "scalar"


@dataclass(frozen=True)
class ArtifactInfo:
    name: str
    hash: str
    step: int | None
    mime_type: str
    size_bytes: int
    metadata: str | None = None
    object_type: str | None = None


@dataclass(frozen=True)
class LogLine:
    stream: str
    wall_time: str
    line_no: int
    content: str

    def __repr__(self) -> str:
        return f"LogLine({self.stream}:{self.line_no} {self.content[:60]!r})"


@dataclass(frozen=True)
class SourceFile:
    path: str
    size: int
    sha256: str | None = None


def _parse_json(s: str | None) -> Any:
    if s is None:
        return None
    try:
        return json.loads(s)
    except (json.JSONDecodeError, TypeError):
        return None


def _parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


# ---------------------------------------------------------------------------
# Sequence wrapper
# ---------------------------------------------------------------------------

class Sequence:
    """A named sequence of tracked values (scalars, artifacts, etc.)."""

    def __init__(self, points: list[SequencePoint]) -> None:
        self._points = points

    @property
    def points(self) -> list[SequencePoint]:
        return self._points

    @property
    def steps(self) -> list[int]:
        return [p.step for p in self._points]

    @property
    def values(self) -> list[float | None]:
        return [p.scalar_value for p in self._points]

    @property
    def timestamps(self) -> list[datetime | None]:
        return [_parse_dt(p.wall_time) for p in self._points]

    def dataframe(self) -> Any:
        """Return a pandas DataFrame (requires pandas)."""
        import pandas as pd
        return pd.DataFrame([
            {"step": p.step, "value": p.scalar_value, "wall_time": p.wall_time,
             "artifact_hash": p.artifact_hash}
            for p in self._points
        ])

    def __getitem__(self, key: int | slice) -> SequencePoint | Sequence:
        if isinstance(key, int):
            # Index by step number.
            for p in self._points:
                if p.step == key:
                    return p
            raise KeyError(f"No point at step {key}")
        if isinstance(key, slice):
            start = key.start or 0
            stop = key.stop
            pts = [p for p in self._points
                   if p.step >= start and (stop is None or p.step < stop)]
            return Sequence(pts)
        raise TypeError(f"Invalid key type: {type(key)}")

    def __len__(self) -> int:
        return len(self._points)

    def __iter__(self) -> Iterator[SequencePoint]:
        return iter(self._points)

    def __repr__(self) -> str:
        return f"Sequence({len(self._points)} points)"


# ---------------------------------------------------------------------------
# Run wrapper
# ---------------------------------------------------------------------------

class Run:
    """A single tracked run with lazy-loaded data."""

    def __init__(self, raw: dict[str, Any], backend: _Backend) -> None:
        self._raw = raw
        self._backend = backend
        self._params: dict[str, Any] | None = None

    @property
    def id(self) -> str:
        return self._raw["id"]

    @property
    def name(self) -> str | None:
        return self._raw.get("display_name")

    @property
    def project(self) -> str:
        return self._raw.get("project_id", "")

    @property
    def status(self) -> str:
        return self._raw.get("status", "")

    @property
    def created_at(self) -> datetime | None:
        return _parse_dt(self._raw.get("created_at"))

    @property
    def ended_at(self) -> datetime | None:
        return _parse_dt(self._raw.get("ended_at"))

    @property
    def duration(self) -> timedelta | None:
        start = self.created_at
        end = self.ended_at or datetime.now(timezone.utc)
        if start is None:
            return None
        return end - start

    @property
    def tags(self) -> list[str]:
        return _parse_json(self._raw.get("tags")) or []

    @property
    def params(self) -> dict[str, Any]:
        if self._params is None:
            data = self._backend.get_run(self.id)
            self._params = {}
            for p in data.get("params", []):
                val = _parse_json(p["value"])
                self._params[p["key"]] = val if val is not None else p["value"]
        return self._params

    @property
    def git(self) -> GitInfo | None:
        sha = self._raw.get("git_sha")
        if not sha:
            return None
        return GitInfo(
            sha=sha,
            branch=self._raw.get("git_branch"),
            dirty=bool(self._raw.get("git_dirty")),
        )

    @property
    def hostname(self) -> str | None:
        return self._raw.get("hostname")

    @property
    def notes(self) -> str | None:
        return self._raw.get("notes")

    # ---- Sequences ----

    def sequences(self) -> list[SequenceInfo]:
        rows = self._backend.list_sequences(self.id)
        return [SequenceInfo(**r) for r in rows]

    def sequence(
        self, name: str, *, context: str | None = None,
        step_from: int | None = None, step_to: int | None = None,
        max_points: int | None = None,
    ) -> Sequence:
        rows = self._backend.get_sequence(
            self.id, name, context=context,
            step_from=step_from, step_to=step_to,
            max_points=max_points,
        )
        return Sequence([SequencePoint(
            step=r["step"],
            wall_time=r.get("wall_time", ""),
            scalar_value=r.get("scalar_value"),
            artifact_hash=r.get("artifact_hash"),
            artifact_metadata=r.get("artifact_metadata"),
            object_type=r.get("object_type", "scalar"),
        ) for r in rows])

    # ---- Artifacts ----

    def artifacts(self) -> list[ArtifactInfo]:
        data = self._backend.list_artifacts(self.id)
        result = []
        for r in data.get("named", []):
            result.append(ArtifactInfo(
                name=r["name"], hash=r["hash"], step=r.get("step"),
                mime_type=r.get("mime_type", ""), size_bytes=r.get("size_bytes", 0),
                metadata=r.get("metadata"), object_type=r.get("object_type"),
            ))
        for r in data.get("from_sequences", []):
            result.append(ArtifactInfo(
                name=r["name"], hash=r["hash"], step=r.get("step"),
                mime_type=r.get("mime_type", ""), size_bytes=r.get("size_bytes", 0),
                metadata=r.get("metadata"), object_type=r.get("object_type"),
            ))
        return result

    def _find_artifact(self, name: str, step: int | None) -> dict[str, Any]:
        """Locate an artifact entry by name (and optional step)."""
        arts = self._backend.list_artifacts(self.id)
        for pool in (arts.get("named", []), arts.get("from_sequences", [])):
            for a in pool:
                if a["name"] == name and (step is None or a.get("step") == step):
                    return a
        raise KeyError(
            f"No artifact named {name!r}"
            + (f" at step {step}" if step is not None else "")
        )

    def artifact_bytes(self, name: str, step: int | None = None) -> bytes:
        """Download an artifact's raw bytes (no deserialization)."""
        a = self._find_artifact(name, step)
        return self._backend.get_artifact_bytes(a["hash"])

    def artifact(self, name: str, step: int | None = None) -> Any:
        """Download an artifact and deserialize back to its original Python type.

        Uses the artifact's ``object_type`` to dispatch to the matching
        handler's ``deserialize()`` method:

        - ``artifact``  → unpickled Python object (any picklable type)
        - ``image``     → PIL.Image
        - ``audio``     → ``(samples: np.ndarray, sample_rate: int)``
        - ``video``     → np.ndarray (T, H, W, C)
        - ``tensor``    → np.ndarray
        - ``text``      → str
        - ``histogram`` → ``(counts: np.ndarray, edges: np.ndarray)``
        - ``figure``    → PIL.Image (rasterized; use ``artifact_bytes`` for source)

        For unknown types, falls back to raw bytes. Use ``artifact_bytes()``
        explicitly when you want raw bytes regardless of type.
        """
        from .handlers.registry import default_registry

        a = self._find_artifact(name, step)
        data = self._backend.get_artifact_bytes(a["hash"])
        object_type = a.get("object_type")
        if not object_type:
            # Unknown type — return raw bytes.
            return data
        handler = default_registry.find_by_type(object_type)
        if handler is None or not hasattr(handler, "deserialize"):
            return data
        # Parse metadata if it's a JSON string.
        meta = a.get("metadata")
        if isinstance(meta, str):
            import json as _json
            try:
                meta = _json.loads(meta)
            except _json.JSONDecodeError:
                meta = {}
        return handler.deserialize(data, meta or {})

    def artifact_path(self, name: str, step: int | None = None) -> Path | None:
        """Return the local file path for an artifact (local backend only)."""
        arts = self._backend.list_artifacts(self.id)
        for pool in (arts.get("named", []), arts.get("from_sequences", [])):
            for a in pool:
                if a["name"] == name and (step is None or a.get("step") == step):
                    return self._backend.get_artifact_path(a["hash"])
        return None

    def save_artifact(self, name: str, dest: str | Path, step: int | None = None) -> Path:
        """Download an artifact and save to a file."""
        data = self.artifact(name, step=step)
        path = Path(dest)
        path.write_bytes(data)
        return path

    # ---- Logs ----

    def logs(
        self, *, stream: str | None = None, search: str | None = None,
        limit: int = 10_000,
    ) -> list[LogLine]:
        rows, _ = self._backend.get_logs(
            self.id, stream=stream, search=search, limit=limit, offset=0,
        )
        return [LogLine(**r) for r in rows]

    # ---- Source ----

    def source_tree(self) -> list[SourceFile] | None:
        data = self._backend.get_source_tree(self.id)
        if data is None:
            return None
        files = data.get("files", [])
        return [SourceFile(path=f["path"], size=f["size"], sha256=f.get("sha256")) for f in files]

    def source_file(self, path: str) -> str | None:
        return self._backend.get_source_file(self.id, path)

    def __repr__(self) -> str:
        name = self.name or self.id
        return f"Run({name!r}, status={self.status!r}, project={self.project!r})"


# ---------------------------------------------------------------------------
# RunQuery — lazy chainable query builder
# ---------------------------------------------------------------------------

class RunQuery:
    """Lazy query builder for runs. Executes on .list()/.first()/.last()/iteration."""

    def __init__(
        self, backend: _Backend, *,
        project: str | None = None,
        status: str | None = None,
        tags_contain: str | None = None,
        param_filters: dict[str, Any] | None = None,
        name_pattern: str | None = None,
        sort_col: str = "created_at",
        sort_desc: bool = True,
        limit_n: int | None = None,
    ) -> None:
        self._backend = backend
        self._project = project
        self._status = status
        self._tags_contain = tags_contain
        self._param_filters = param_filters or {}
        self._name_pattern = name_pattern
        self._sort_col = sort_col
        self._sort_desc = sort_desc
        self._limit_n = limit_n

    def _clone(self, **overrides: Any) -> RunQuery:
        kw: dict[str, Any] = {
            "backend": self._backend,
            "project": self._project,
            "status": self._status,
            "tags_contain": self._tags_contain,
            "param_filters": dict(self._param_filters),
            "name_pattern": self._name_pattern,
            "sort_col": self._sort_col,
            "sort_desc": self._sort_desc,
            "limit_n": self._limit_n,
        }
        kw.update(overrides)
        return RunQuery(**kw)

    def filter(
        self, *,
        status: str | None = None,
        tags__contains: str | None = None,
        name__contains: str | None = None,
        **param_filters: Any,
    ) -> RunQuery:
        """Add filters. Param filters use key=value matching."""
        merged_params = {**self._param_filters, **param_filters}
        return self._clone(
            status=status or self._status,
            tags_contain=tags__contains or self._tags_contain,
            name_pattern=name__contains or self._name_pattern,
            param_filters=merged_params,
        )

    def sort(self, column: str, *, desc: bool = True) -> RunQuery:
        return self._clone(sort_col=column, sort_desc=desc)

    def limit(self, n: int) -> RunQuery:
        return self._clone(limit_n=n)

    def list(self) -> list[Run]:
        """Execute the query and return matching runs."""
        runs, _ = self._backend.list_runs(
            project=self._project,
            status=self._status,
            limit=self._limit_n or 1000,
            offset=0,
            sort_col=self._sort_col,
            sort_desc=self._sort_desc,
        )
        result = [Run(r, self._backend) for r in runs]

        # Client-side filters that SQL doesn't handle.
        if self._tags_contain:
            tag = self._tags_contain
            result = [r for r in result if tag in r.tags]

        if self._name_pattern:
            pat = self._name_pattern.lower()
            result = [r for r in result if r.name and pat in r.name.lower()]

        if self._param_filters:
            filtered = []
            for run in result:
                params = run.params
                match = all(
                    str(params.get(k)) == str(v)
                    for k, v in self._param_filters.items()
                )
                if match:
                    filtered.append(run)
            result = filtered

        if self._limit_n and len(result) > self._limit_n:
            result = result[:self._limit_n]

        return result

    def first(self) -> Run | None:
        runs = self._clone(sort_desc=False, limit_n=self._limit_n or 1000).list()
        return runs[0] if runs else None

    def last(self) -> Run | None:
        runs = self._clone(sort_desc=True, limit_n=self._limit_n or 1000).list()
        return runs[0] if runs else None

    def __iter__(self) -> Iterator[Run]:
        return iter(self.list())

    def __len__(self) -> int:
        return len(self.list())

    def __repr__(self) -> str:
        parts = []
        if self._project:
            parts.append(f"project={self._project!r}")
        if self._status:
            parts.append(f"status={self._status!r}")
        if self._param_filters:
            parts.append(f"params={self._param_filters!r}")
        return f"RunQuery({', '.join(parts)})"


# ---------------------------------------------------------------------------
# Backend protocol
# ---------------------------------------------------------------------------

@runtime_checkable
class _Backend(Protocol):
    def list_projects(self) -> list[dict[str, Any]]: ...
    def list_runs(self, project: str | None, status: str | None,
                  limit: int, offset: int, sort_col: str, sort_desc: bool) -> tuple[list[dict[str, Any]], int]: ...
    def get_run(self, run_id: str) -> dict[str, Any]: ...
    def list_sequences(self, run_id: str) -> list[dict[str, Any]]: ...
    def get_sequence(self, run_id: str, name: str, *, context: str | None,
                     step_from: int | None, step_to: int | None,
                     max_points: int | None) -> list[dict[str, Any]]: ...
    def list_artifacts(self, run_id: str) -> dict[str, Any]: ...
    def get_artifact_bytes(self, digest: str) -> bytes: ...
    def get_artifact_path(self, digest: str) -> Path | None: ...
    def get_logs(self, run_id: str, *, stream: str | None, search: str | None,
                 limit: int, offset: int) -> tuple[list[dict[str, Any]], int]: ...
    def get_source_tree(self, run_id: str) -> dict[str, Any] | None: ...
    def get_source_file(self, run_id: str, path: str) -> str | None: ...


# ---------------------------------------------------------------------------
# Local backend — direct SQLite access
# ---------------------------------------------------------------------------

class _LocalBackend:
    def __init__(self, repo: str | Path) -> None:
        from ..server.storage.blobs import BlobStore
        from ..server.storage.datadir import DataDir
        from ..server.storage.db import Database
        from ..server.wal_ingest import ingest_all as _ingest_all

        self._dd = DataDir(Path(repo))
        self._db = Database.open(self._dd.db_path)
        self._blobs = BlobStore(self._dd.artifacts_dir)
        self._ingest_all = _ingest_all

    def _drain_wals(self) -> None:
        """Ingest any pending WAL files before reading."""
        try:
            self._ingest_all(self._dd, self._db, self._blobs)
        except Exception:  # noqa: BLE001
            pass

    def list_projects(self) -> list[dict[str, Any]]:
        self._drain_wals()
        return self._db.read_columns(
            """SELECT p.id, p.name, p.created_at,
                      (SELECT COUNT(*) FROM runs r WHERE r.project_id = p.id) AS run_count,
                      (SELECT COUNT(*) FROM runs r WHERE r.project_id = p.id AND r.status = 'running') AS active_run_count,
                      (SELECT MAX(COALESCE(r.ended_at, r.created_at)) FROM runs r WHERE r.project_id = p.id) AS last_run_at
               FROM projects p ORDER BY last_run_at DESC"""
        )

    def list_runs(
        self, project: str | None, status: str | None,
        limit: int, offset: int, sort_col: str, sort_desc: bool,
    ) -> tuple[list[dict[str, Any]], int]:
        self._drain_wals()
        clauses: list[str] = []
        params: list[Any] = []
        if project:
            clauses.append("project_id = ?")
            params.append(project)
        if status:
            clauses.append("status = ?")
            params.append(status)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        direction = "DESC" if sort_desc else "ASC"
        safe_col = sort_col if sort_col in ("created_at", "display_name", "status", "ended_at") else "created_at"
        rows = self._db.read_columns(
            f"SELECT * FROM runs {where} ORDER BY {safe_col} {direction} LIMIT ? OFFSET ?",
            [*params, limit, offset],
        )
        (total,) = self._db.read_one(f"SELECT COUNT(*) FROM runs {where}", params) or (0,)
        return rows, total

    def get_run(self, run_id: str) -> dict[str, Any]:
        rows = self._db.read_columns("SELECT * FROM runs WHERE id = ?", [run_id])
        if not rows:
            raise KeyError(f"Run {run_id!r} not found")
        params = self._db.read_columns(
            "SELECT key, value, value_type FROM params WHERE run_id = ? ORDER BY key",
            [run_id],
        )
        return {"run": rows[0], "params": params}

    def list_sequences(self, run_id: str) -> list[dict[str, Any]]:
        return self._db.read_columns(
            """SELECT name, object_type, context, context_hash,
                      MIN(step) AS min_step, MAX(step) AS max_step, COUNT(*) AS count
               FROM sequences WHERE run_id = ?
               GROUP BY name, object_type, context, context_hash
               ORDER BY name""",
            [run_id],
        )

    def get_sequence(
        self, run_id: str, name: str, *,
        context: str | None = None,
        step_from: int | None = None, step_to: int | None = None,
        max_points: int | None = None,
    ) -> list[dict[str, Any]]:
        clauses = ["s.run_id = ?", "s.name = ?"]
        params: list[Any] = [run_id, name]
        if context is not None:
            clauses.append("s.context_hash = ?")
            params.append(context)
        if step_from is not None:
            clauses.append("s.step >= ?")
            params.append(step_from)
        if step_to is not None:
            clauses.append("s.step <= ?")
            params.append(step_to)
        where = " AND ".join(clauses)
        rows = self._db.read_columns(
            f"""SELECT s.step, s.wall_time, s.scalar_value, s.artifact_hash,
                       s.context, s.object_type,
                       a.mime_type AS artifact_mime, a.size_bytes AS artifact_size,
                       a.metadata AS artifact_metadata
                FROM sequences s
                LEFT JOIN artifacts a ON a.hash = s.artifact_hash
                WHERE {where} ORDER BY s.step""",
            params,
        )
        # Simple downsampling if requested.
        if max_points and len(rows) > max_points:
            step = max(1, len(rows) // max_points)
            rows = rows[::step]
        return rows

    def list_artifacts(self, run_id: str) -> dict[str, Any]:
        named = self._db.read_columns(
            """SELECT ra.name, ra.hash, CASE WHEN ra.step = -1 THEN NULL ELSE ra.step END AS step,
                      a.mime_type, a.size_bytes, a.metadata, a.object_type
               FROM run_artifacts ra JOIN artifacts a ON a.hash = ra.hash
               WHERE ra.run_id = ? ORDER BY ra.created_at DESC""",
            [run_id],
        )
        from_seq = self._db.read_columns(
            """SELECT DISTINCT s.name, s.artifact_hash AS hash, s.step,
                      a.mime_type, a.size_bytes, a.metadata, s.object_type
               FROM sequences s JOIN artifacts a ON a.hash = s.artifact_hash
               WHERE s.run_id = ? AND s.artifact_hash IS NOT NULL
               ORDER BY s.name, s.step""",
            [run_id],
        )
        return {"named": named, "from_sequences": from_seq}

    def get_artifact_bytes(self, digest: str) -> bytes:
        data, _ = self._blobs.get(digest)
        return data

    def get_artifact_path(self, digest: str) -> Path | None:
        p = self._blobs.path_for(digest)
        return p if p.exists() else None

    def get_logs(
        self, run_id: str, *, stream: str | None = None,
        search: str | None = None, limit: int = 10_000, offset: int = 0,
    ) -> tuple[list[dict[str, Any]], int]:
        clauses = ["run_id = ?"]
        params: list[Any] = [run_id]
        if stream:
            clauses.append("stream = ?")
            params.append(stream)
        if search:
            clauses.append("content LIKE ?")
            params.append(f"%{search}%")
        where = " AND ".join(clauses)
        rows = self._db.read_columns(
            f"SELECT stream, wall_time, line_no, content FROM log_lines WHERE {where} ORDER BY wall_time, line_no LIMIT ? OFFSET ?",
            [*params, limit, offset],
        )
        (total,) = self._db.read_one(f"SELECT COUNT(*) FROM log_lines WHERE {where}", params) or (0,)
        return rows, total

    def get_source_tree(self, run_id: str) -> dict[str, Any] | None:
        manifest = self._dd.sources_dir / run_id / "manifest.json"
        if not manifest.exists():
            return None
        return json.loads(manifest.read_text())

    def get_source_file(self, run_id: str, path: str) -> str | None:
        import tarfile
        try:
            import zstandard
        except ImportError:
            return None
        archive = self._dd.sources_dir / run_id / "tree.tar.zst"
        if not archive.exists():
            return None
        try:
            dctx = zstandard.ZstdDecompressor()
            with archive.open("rb") as fh:
                with dctx.stream_reader(fh) as reader:
                    with tarfile.open(fileobj=reader, mode="r|") as tf:
                        for member in tf:
                            if member.name == path and member.isfile():
                                f = tf.extractfile(member)
                                if f:
                                    return f.read().decode("utf-8", errors="replace")
        except Exception:
            return None
        return None

    def close(self) -> None:
        self._db.close()


# ---------------------------------------------------------------------------
# HTTP backend — connects to a running Cairn server
# ---------------------------------------------------------------------------

class _HttpBackend:
    def __init__(self, server_url: str) -> None:
        import httpx
        self._base = server_url.rstrip("/")
        self._client = httpx.Client(base_url=self._base, timeout=30.0)

    def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        resp = self._client.get(path, params=params)
        resp.raise_for_status()
        return resp.json()

    def list_projects(self) -> list[dict[str, Any]]:
        return self._get("/api/projects")["projects"]

    def list_runs(
        self, project: str | None, status: str | None,
        limit: int, offset: int, sort_col: str, sort_desc: bool,
    ) -> tuple[list[dict[str, Any]], int]:
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if project:
            params["project"] = project
        if status:
            params["status"] = status
        data = self._get("/api/runs", params=params)
        return data["runs"], data["total"]

    def get_run(self, run_id: str) -> dict[str, Any]:
        return self._get(f"/api/runs/{run_id}")

    def list_sequences(self, run_id: str) -> list[dict[str, Any]]:
        return self._get(f"/api/runs/{run_id}/sequences")["sequences"]

    def get_sequence(
        self, run_id: str, name: str, *,
        context: str | None = None,
        step_from: int | None = None, step_to: int | None = None,
        max_points: int | None = None,
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {}
        if context is not None:
            params["context"] = context
        if step_from is not None:
            params["step_from"] = step_from
        if step_to is not None:
            params["step_to"] = step_to
        if max_points is not None:
            params["max_points"] = max_points
        return self._get(f"/api/runs/{run_id}/sequences/{name}", params=params)["points"]

    def list_artifacts(self, run_id: str) -> dict[str, Any]:
        return self._get(f"/api/runs/{run_id}/artifacts")

    def get_artifact_bytes(self, digest: str) -> bytes:
        resp = self._client.get(f"/api/artifacts/{digest}")
        resp.raise_for_status()
        return resp.content

    def get_artifact_path(self, digest: str) -> Path | None:
        return None  # HTTP backend can't provide local paths.

    def get_logs(
        self, run_id: str, *, stream: str | None = None,
        search: str | None = None, limit: int = 10_000, offset: int = 0,
    ) -> tuple[list[dict[str, Any]], int]:
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if stream:
            params["stream"] = stream
        if search:
            params["search"] = search
        data = self._get(f"/api/runs/{run_id}/logs", params=params)
        return data["lines"], data["total"]

    def get_source_tree(self, run_id: str) -> dict[str, Any] | None:
        try:
            return self._get(f"/api/runs/{run_id}/source/tree")
        except Exception:
            return None

    def get_source_file(self, run_id: str, path: str) -> str | None:
        try:
            data = self._get(f"/api/runs/{run_id}/source/file", params={"path": path})
            return data.get("content")
        except Exception:
            return None

    def close(self) -> None:
        self._client.close()


# ---------------------------------------------------------------------------
# Reader — public entry point
# ---------------------------------------------------------------------------

class Reader:
    """Read-only interface to a Cairn repo or server.

    Args:
        repo: Path to a ``.cairn/`` directory, or ``cairn://host:port``
            for HTTP server mode.

    If not specified, auto-detects from env/config (same logic as ``cairn.Run``).
    """

    def __init__(
        self,
        repo: str | Path | None = None,
    ) -> None:
        target = _config.resolve_target(repo=repo)
        if target.is_local:
            self._backend: _LocalBackend | _HttpBackend = _LocalBackend(target.location)
        else:
            self._backend = _HttpBackend(target.location)

    def projects(self) -> list[Project]:
        """List all projects."""
        rows = self._backend.list_projects()
        return [Project(
            id=r["id"], name=r.get("name", r["id"]),
            created_at=r.get("created_at", ""),
            run_count=r.get("run_count", 0),
            active_run_count=r.get("active_run_count", 0),
            last_run_at=r.get("last_run_at"),
        ) for r in rows]

    def runs(self, project: str | None = None) -> RunQuery:
        """Start a lazy run query, optionally filtered by project."""
        return RunQuery(self._backend, project=project)

    def run(self, run_id: str) -> Run:
        """Get a specific run by ID."""
        data = self._backend.get_run(run_id)
        return Run(data["run"], self._backend)

    def close(self) -> None:
        """Close the underlying database or HTTP connection."""
        self._backend.close()

    def __enter__(self) -> Reader:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()

    def __repr__(self) -> str:
        if isinstance(self._backend, _LocalBackend):
            return f"Reader(repo={str(self._backend._dd.root)!r})"
        # HTTP backend: convert http://host:port → cairn://host:port for display
        base = self._backend._base
        cairn_url = base.replace("http://", "cairn://", 1) if base.startswith("http://") else base
        return f"Reader(repo={cairn_url!r})"
