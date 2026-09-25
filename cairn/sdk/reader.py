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
from typing import Any, Callable, Iterator, Protocol, runtime_checkable

from .. import config as _config
from .. import expr as _expr
from .artifact_dir import MANIFEST_MIME, ArtifactDir
from .handlers.image import GALLERY_MIME


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
    remote: str | None = None


@dataclass(frozen=True)
class SequenceInfo:
    name: str
    object_type: str
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
    #: Per-point metadata (e.g. ``{"caption": ...}``), decoded; None when none.
    metadata: dict | None = None

    @property
    def caption(self) -> str | None:
        return (self.metadata or {}).get("caption")


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
class MediaRef:
    """A media cell of a logged table: an image/audio/video stored as its own artifact.

    Nothing is downloaded until :meth:`load` (decoded like ``Run.artifact``)
    or :meth:`bytes` (raw) is called.
    """

    hash: str
    mime_type: str
    object_type: str | None = None
    _backend: Any = field(default=None, repr=False, compare=False)

    def bytes(self) -> bytes:
        return self._backend.get_artifact_bytes(self.hash)

    def load(self) -> Any:
        from .handlers.registry import default_registry

        data = self.bytes()
        handler = default_registry.find_by_type(self.object_type) if self.object_type else None
        if handler is None or not hasattr(handler, "deserialize"):
            return data
        return handler.deserialize(data, {})


def _table_media_refs(table: dict[str, Any], backend: Any) -> dict[str, Any]:
    """Replace a table's ``{"$media": ...}`` cells with :class:`MediaRef`."""
    for row in table.get("data", []):
        for c, cell in enumerate(row):
            if isinstance(cell, dict) and isinstance(cell.get("$media"), dict):
                m = cell["$media"]
                row[c] = MediaRef(m["hash"], m.get("mime_type", ""), m.get("object_type"), backend)
    return table


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
# DataRef — lazy handle over a run's tag, returned by Run.__getitem__
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class DataRef:
    """A lazy reference to the data behind ``run[tag]`` (WS-PYAPI).

    Wraps ``(run, tag[, step])`` only — it does **not** fetch anything at
    construction time. Resolution happens only when something actually
    needs the data: ``.resolve()`` fetches it eagerly (via the existing
    ``Run.sequence``/``Run.artifact``), and ``cairn.plot`` element builders
    resolve just the ``(runId, name)`` pair needed to build
    a server-anchored ``SeriesRef`` (no bytes ever move for that path — the
    card renders by reference through ``/embed/card``).

    ``run[tag][step]`` (via :meth:`__getitem__`) narrows to one step,
    mapping to the existing ``step=`` args on ``Run.sequence``/``Run.artifact``.
    """

    run: "Run"
    tag: str
    step: int | None = None

    def __getitem__(self, step: int) -> DataRef:
        if not isinstance(step, int):
            raise TypeError(f"DataRef step index must be an int, got {type(step)}")
        return DataRef(self.run, self.tag, step)

    @property
    def run_id(self) -> str:
        return self.run.id

    def resolve(self) -> Any:
        """Eagerly fetch the underlying data.

        Tries a named/sequence artifact first (images, meshes, tensors,
        ...); falls back to the raw scalar :class:`Sequence` when the tag
        isn't an artifact (e.g. a plain scalar metric).
        """
        try:
            return self.run.artifact(self.tag, step=self.step)
        except KeyError:
            seq = self.run.sequence(self.tag)
            if self.step is not None:
                return seq[self.step]
            return seq

    @property
    def url(self) -> str:
        """A live query URL pinned to this exact run+tag (``run=id:<run_id>``).

        Only meaningful against a server target (the URL is fetched over HTTP);
        raises on a local-only backend. Narrowed steps (``run[tag][step]``)
        carry through as ``step=<N>``.
        """
        base = getattr(self.run._backend, "server_url", None)
        if base is None:
            from .query_urls import _LOCAL_ONLY_MSG
            raise ValueError(_LOCAL_ONLY_MSG)
        from .query_urls import build_query_url
        step: str | int = self.step if self.step is not None else "latest"
        return build_query_url(base, tag=self.tag, run=f"id:{self.run.id}", step=step)

    def __repr__(self) -> str:
        step_part = f"[{self.step}]" if self.step is not None else ""
        return f"DataRef(run={self.run.id!r}, tag={self.tag!r}{step_part})"


# ---------------------------------------------------------------------------
# Run wrapper
# ---------------------------------------------------------------------------

class Run:
    """A single tracked run with lazy-loaded data."""

    def __init__(self, raw: dict[str, Any], backend: _Backend) -> None:
        self._raw = raw
        self._backend = backend
        self._params: dict[str, Any] | None = None
        self._summary: dict[str, Any] | None = None

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

    def _key_values(self, table: str) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for p in self._backend.get_run(self.id).get(table, []):
            val = _parse_json(p["value"])
            out[p["key"]] = val if val is not None else p["value"]
        return out

    @property
    def params(self) -> dict[str, Any]:
        if self._params is None:
            self._params = self._key_values("params")
        return self._params

    @property
    def summary(self) -> dict[str, Any]:
        """Values recorded with ``run.summary(...)`` (flattened dotted keys)."""
        if self._summary is None:
            self._summary = self._key_values("summary")
        return self._summary

    @property
    def final(self) -> dict[str, Any]:
        """Each metric's final value, exactly as the UI's runs table shows it:
        the last scalar point, replaced by a ``track(..., summary=)`` rule,
        replaced by an explicit :attr:`summary` key."""
        if "values" not in self._raw:
            self._raw["values"] = self._backend.get_run(self.id)["run"]["values"]
        return dict(self._raw["values"])

    @property
    def config(self) -> dict[str, Any]:
        """Alias of :attr:`params` (R0: the write side is ``run.config(...)``)."""
        return self.params

    @property
    def git(self) -> GitInfo | None:
        sha = self._raw.get("git_sha")
        if not sha:
            return None
        return GitInfo(
            sha=sha,
            branch=self._raw.get("git_branch"),
            dirty=bool(self._raw.get("git_dirty")),
            remote=self._raw.get("git_remote"),
        )

    @property
    def hostname(self) -> str | None:
        return self._raw.get("hostname")

    @property
    def group(self) -> str | None:
        return self._raw.get("group")

    @property
    def job_type(self) -> str | None:
        return self._raw.get("job_type")

    @property
    def notes(self) -> str | None:
        return self._raw.get("notes")

    # ---- Sequences ----

    def history(self, keys: list[str] | None = None) -> Any:
        """Scalar history as a wide pandas DataFrame: one row per step, one
        column per sequence name (None: all scalar sequences).

        Needs the ``[export]`` extra.
        """
        long = _history_frame(self._backend, [self], keys)
        wide = long.pivot(index="step", columns="name", values="value")
        wide.columns.name = None
        return wide

    def sequences(self) -> list[SequenceInfo]:
        rows = self._backend.list_sequences(self.id)
        return [SequenceInfo(**r) for r in rows]

    def sequence(
        self, name: str, *,
        step_from: int | None = None, step_to: int | None = None,
    ) -> Sequence:
        rows = self._backend.get_sequence(
            self.id, name,
            step_from=step_from, step_to=step_to,
        )
        return Sequence([SequencePoint(
            step=r["step"],
            wall_time=r.get("wall_time", ""),
            scalar_value=r.get("scalar_value"),
            artifact_hash=r.get("artifact_hash"),
            artifact_metadata=r.get("artifact_metadata"),
            object_type=r.get("object_type", "scalar"),
            metadata=json.loads(r["metadata"]) if r.get("metadata") else None,
        ) for r in rows])

    def eval(self, expr: str, *, domain: Any = None) -> Any:
        """Evaluate a cairn expression (``cairn.expr``) on this run.

        Returns the scalar value, or a :class:`cairn.expr.Series` (``steps``,
        ``values``) for a series expression. An as-of join between series
        with different steps emits a :class:`cairn.expr.ExprWarning`.
        Raises :class:`cairn.expr.ExprError` on parse/type errors::

            run.eval("last(val.loss) - min(val.loss)")
            run.eval("ema(loss, 0.9)")
        """
        import warnings

        r = _expr.evaluate(expr, _RunExprContext(self), domain=domain)
        for w in r.warnings:
            warnings.warn(w, stacklevel=2)
        return r.value

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
        """Locate an artifact entry by name (and optional step).

        When ``step`` is ``None``, returns the highest-step entry (the
        "latest" checkpoint). Pass an explicit ``step`` for a specific one.
        """
        arts = self._backend.list_artifacts(self.id)
        # Collect all matches across both pools.
        matches: list[dict[str, Any]] = []
        for pool in (arts.get("named", []), arts.get("from_sequences", [])):
            for a in pool:
                if a["name"] != name:
                    continue
                if step is not None and a.get("step") != step:
                    continue
                matches.append(a)
        if not matches:
            raise KeyError(
                f"No artifact named {name!r}"
                + (f" at step {step}" if step is not None else "")
            )
        if step is not None:
            return matches[0]
        # No step specified — return the entry with the highest step
        # (or the only one, if there's just one).
        return max(matches, key=lambda a: a.get("step") if a.get("step") is not None else -1)

    def artifact_bytes(self, name: str, step: int | None = None) -> bytes:
        """Download an artifact's raw bytes (no deserialization)."""
        a = self._find_artifact(name, step)
        return self._backend.get_artifact_bytes(a["hash"])

    def artifact(self, name: str, step: int | None = None) -> Any:
        """Download an artifact and deserialize back to its original Python type.

        Uses the artifact's ``object_type`` to dispatch to the matching
        handler's ``deserialize()`` method:

        - ``artifact``  → unpickled Python object (any picklable type)
        - ``image``     → PIL.Image (PNG), ndarray (``exr``/``npy`` encodings);
          a gallery (a tracked list of images) → a list of those
        - ``audio``     → ``(samples: np.ndarray, sample_rate: int)``
        - ``video``     → np.ndarray (T, H, W, C)
        - ``tensor``    → np.ndarray
        - ``text``      → str
        - ``table``     → ``{"columns", "data"}``; media cells are :class:`MediaRef`
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
        if a.get("mime_type") == GALLERY_MIME:
            return [
                handler.deserialize(self._backend.get_artifact_bytes(item["hash"]), item.get("metadata") or {})
                for item in json.loads(data)["images"]
            ]
        if object_type == "table":
            return _table_media_refs(handler.deserialize(data, meta or {}), self._backend)
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

    # ---- Versioned Artifact Inputs/Outputs ----

    def input_artifacts(self) -> list[dict[str, Any]]:
        """Return versioned artifacts consumed by this run."""
        return self._backend.get_run_inputs(self.id)

    def output_artifacts(self) -> list[dict[str, Any]]:
        """Return versioned artifacts produced by this run."""
        return self._backend.get_run_outputs(self.id)

    def edit(self) -> RunEditor:
        """An editing handle for this run (config, summary, tags, name,
        notes). Use it as a context manager, or ``close()`` it::

            with reader.run(run_id).edit() as e:
                e.set_summary(test_acc=0.93)
                e.add_tag("best")

        Raises ``ValueError`` for a Reader over an exported ``.zip``.
        """
        return RunEditor(self, self._backend.edit_target)

    def __repr__(self) -> str:
        name = self.name or self.id
        return f"Run({name!r}, status={self.status!r}, project={self.project!r})"

    # ---- Lazy data handles (WS-PYAPI) ----

    def __getitem__(self, tag: str) -> DataRef:
        """``run[tag]`` — a lazy :class:`DataRef` over a sequence/artifact tag.

        Does not fetch anything; resolves only when the handle is rendered
        (``cairn.plot`` element builders) or explicitly ``.resolve()``d.
        Optional step indexing: ``run[tag][step]``.
        """
        if not isinstance(tag, str):
            raise TypeError(f"Run.__getitem__ expects a string tag, got {type(tag)}")
        return DataRef(self, tag)


class RunEditor:
    """Write access to one existing run, from :meth:`Run.edit`.

    Writes go through the same transport resolution as ``cairn.Run``: the
    repo DB directly, or the server that holds the repo (or the ``cairn://``
    server the Reader reads). The :class:`Run` it came from sees the edits.
    """

    def __init__(self, run: Run, target: str) -> None:
        from .connect import open_transport

        self._run = run
        self._transport, _ = open_transport(target)

    def set_config(self, *args: Any, **kwargs: Any) -> None:
        """Merge keys into the run's config (like ``cairn.Run.config``)."""
        values = _merge_mappings("set_config", args, kwargs)
        if values:
            self._transport.post_params(self._run.id, values)
            self._run._params = None

    def set_summary(self, *args: Any, **kwargs: Any) -> None:
        """Merge keys into the run's summary (like ``cairn.Run.summary``)."""
        values = _merge_mappings("set_summary", args, kwargs)
        if values:
            self._transport.post_summary(self._run.id, values)
            self._run._summary = None
            self._run._raw.pop("values", None)

    def delete_keys(self, which: str, keys: list[str]) -> None:
        """Delete ``keys`` from ``"config"`` or ``"summary"``. Keys are the
        dotted keys; a key also removes the keys nested under it."""
        tables = {"config": "params", "summary": "summary"}
        if which not in tables:
            raise ValueError(f"which must be 'config' or 'summary', got {which!r}")
        self._transport.delete_keys(self._run.id, tables[which], list(keys))
        self._run._params = None
        self._run._summary = None
        self._run._raw.pop("values", None)

    def set_tags(self, tags: list[str]) -> None:
        """Replace the run's tags."""
        self._transport.set_tags(self._run.id, list(tags))
        self._run._raw["tags"] = json.dumps(list(tags))

    def add_tag(self, tag: str) -> None:
        tags = self._run.tags
        if tag not in tags:
            self.set_tags([*tags, tag])

    def remove_tag(self, tag: str) -> None:
        self.set_tags([t for t in self._run.tags if t != tag])

    def rename(self, name: str) -> None:
        self._transport.rename_run(self._run.id, name)
        self._run._raw["display_name"] = name

    def set_notes(self, notes: str) -> None:
        self._transport.set_notes(self._run.id, notes)
        self._run._raw["notes"] = notes

    def close(self) -> None:
        self._transport.close()

    def __enter__(self) -> RunEditor:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()


def _merge_mappings(who: str, args: tuple, kwargs: dict) -> dict[str, Any]:
    merged: dict[str, Any] = {}
    for a in args:
        if not isinstance(a, dict):
            raise TypeError(f"{who}() positional args must be mappings")
        merged.update(a)
    merged.update(kwargs)
    return merged


# ---------------------------------------------------------------------------
# RunQuery — lazy chainable query builder
# ---------------------------------------------------------------------------

# Mapping from Django-style suffix to a comparator. Each comparator takes
# (actual_value, query_value) and returns True if the row matches.
# MIRROR of the server-owned query grammar (cairn/server/_operators.py +
# query_grammar.OPERATOR_NAMES); pinned by schema/query-vectors.json —
# change all mirrors together. The server is AUTHORITATIVE (it decodes and
# evaluates); this copy only validates kwargs early and encodes urls.
_OPERATORS: dict[str, "Callable[[Any, Any], bool]"] = {
    "exact": lambda a, b: a == b,
    "iexact": lambda a, b: isinstance(a, str) and isinstance(b, str) and a.lower() == b.lower(),
    "gt": lambda a, b: a is not None and a > b,
    "gte": lambda a, b: a is not None and a >= b,
    "lt": lambda a, b: a is not None and a < b,
    "lte": lambda a, b: a is not None and a <= b,
    "in": lambda a, b: a in b,
    "contains": lambda a, b: (
        b in a if isinstance(a, (str, list, tuple, set)) else False
    ),
    "icontains": lambda a, b: (
        isinstance(a, str) and isinstance(b, str) and b.lower() in a.lower()
    ),
    "startswith": lambda a, b: isinstance(a, str) and a.startswith(b),
    "endswith": lambda a, b: isinstance(a, str) and a.endswith(b),
    "isnull": lambda a, b: (a is None) == bool(b),
}

# Top-level fields on a Run that can be filtered. Anything else is treated
# as a param lookup (params.<key>).
_RUN_FIELDS = {
    "name", "status", "project", "tags", "id", "hostname", "user", "notes",
    "group", "job_type",
}


def _parse_lookup(key: str) -> tuple[str, str, str | None]:
    """Parse a Django-style filter key into (field_root, op, sub_field).

    Examples:
      "lr"               → ("lr", "exact", None)
      "lr__gt"           → ("lr", "gt", None)
      "tags__contains"   → ("tags", "contains", None)
      "metrics__loss"    → ("metrics", "exact", "loss")
      "metrics__loss__lt" → ("metrics", "lt", "loss")
    """
    parts = key.split("__")
    if len(parts) == 1:
        return parts[0], "exact", None
    # Last part might be an operator
    last = parts[-1]
    if last in _OPERATORS:
        op = last
        if len(parts) == 2:
            return parts[0], op, None
        return parts[0], op, "__".join(parts[1:-1])
    # No trailing operator → the whole tail is a sub-field path
    return parts[0], "exact", "__".join(parts[1:])


def _get_field_value(run: "Run", field: str, sub_field: str | None) -> Any:
    """Resolve a filter field to a value on the Run."""
    if field in _RUN_FIELDS:
        # Built-in run fields. Sub-field ignored (run has no nested structures here).
        return getattr(run, field, None)
    if field == "metrics":
        if sub_field is None:
            return None
        # The resolved final value (``Run.final``): the value the runs table
        # shows, not merely the last point. Python keywords cannot contain
        # dots, so ``metrics__val__acc`` also finds the metric ``val.acc``.
        final = run.final
        if sub_field in final:
            return final[sub_field]
        return final.get(sub_field.replace("__", "."))
    if field == "params":
        # params__lr or just lr (param fallback handled at parse time)
        return run.params.get(sub_field) if sub_field else None
    if field == "summary":
        return run.summary.get(sub_field) if sub_field else None
    # Default: treat field as a param key.
    if sub_field:
        # e.g. hparams__lr → params["hparams.lr"]
        full = f"{field}.{sub_field}"
        return run.params.get(full)
    return run.params.get(field)


_PAGE = 1000  # /api/runs caps limit at 1000
_HISTORY_COLUMNS = ["run_id", "run_name", "name", "step", "wall_time", "value"]


def _history_frame(backend: _Backend, runs: list[Run], keys: list[str] | None) -> Any:
    """Long-format scalar history of ``runs`` (see :meth:`RunQuery.history`)."""
    try:
        import pandas as pd
    except ImportError as exc:
        raise ImportError("history() needs pandas: pip install 'cairn-track[export]'") from exc
    names = {r.id: r.name for r in runs}
    ids = list(names)
    records: list[dict[str, Any]] = []
    for i in range(0, len(ids), 200):
        for series in backend.scalar_series(ids[i:i + 200], keys):
            for p in series["points"]:
                records.append({
                    "run_id": series["run_id"],
                    "run_name": names[series["run_id"]],
                    "name": series["name"],
                    "step": p["step"],
                    "wall_time": p["wall_time"],
                    "value": p["value"],
                })
    df = pd.DataFrame(records, columns=_HISTORY_COLUMNS)
    df["wall_time"] = pd.to_datetime(df["wall_time"], utc=True, format="ISO8601")
    return df


class _RunExprContext:
    """A :mod:`cairn.expr` context over one :class:`Run`; series are fetched
    once per context."""

    def __init__(self, run: Run) -> None:
        self._run = run
        self._series: dict[str, dict[str, list] | None] = {}

    def series(self, name: str) -> dict[str, list] | None:
        if name not in self._series:
            points = self._run.sequence(name).points
            self._series[name] = {
                "steps": [p.step for p in points],
                "values": [p.scalar_value for p in points],
                "wall": [_expr.parse_time(p.wall_time) for p in points],
            } if points else None
        return self._series[name]

    def config(self, key: str) -> Any:
        return self._run.params.get(key)

    def summary(self, key: str) -> Any:
        return self._run.summary.get(key)

    def run(self, field: str) -> Any:
        r = self._run
        if field == "created_at":
            return r._raw.get("created_at")
        return {"name": r.name, "id": r.id, "status": r.status, "tags": r.tags,
                "group": r.group, "job_type": r.job_type}.get(field)


class RunQuery:
    """Lazy query builder for runs. Executes on .list()/.first()/.last()/iteration.

    Filters use Django-style ``field__operator=value`` suffixes::

        reader.runs(project="x").filter(
            status="completed",                    # exact match (default op)
            name__contains="my-run",               # substring
            tags__contains="best",                 # list membership
            lr__gt=1e-4,                           # > on a param
            lr__lt=1e-2,
            status__in=["completed", "killed"],    # set membership
            metrics__loss__lt=0.1,                 # final value (Run.final)
            hostname__startswith="gpu",
        )

    Supported operators: ``exact``, ``iexact``, ``gt``, ``gte``, ``lt``,
    ``lte``, ``in``, ``contains``, ``icontains``, ``startswith``,
    ``endswith``, ``isnull``.

    Special field roots: ``metrics`` (the metric's final value as
    :attr:`Run.final` resolves it: the last point, replaced by a
    ``track(..., summary=)`` rule, replaced by an explicit summary key; write
    ``metrics__val__acc`` for the metric ``val.acc``), ``params`` (explicit
    param lookup), ``summary`` (a ``run.summary`` value), ``tags`` (list
    membership). Any other root is treated as a param key.

    ``where(expr)`` adds a :mod:`cairn.expr` expression filter; a run matches
    when the (scalar) expression is truthy and not None::

        reader.runs("x").where("last(val.acc) > 0.9 and config.opt == 'adam'")
    """

    def __init__(
        self, backend: _Backend, *,
        project: str | None = None,
        status: str | None = None,
        filters: list[tuple[str, str, str | None, Any]] | None = None,
        sort_col: str = "created_at",
        sort_desc: bool = True,
        limit_n: int | None = None,
        wheres: list[tuple[str, _expr.Node]] | None = None,
    ) -> None:
        self._backend = backend
        self._project = project
        # status is kept separate because it's pushed down to SQL (faster).
        self._status = status
        # All other filters: list of (field, op, sub_field, value) tuples.
        self._filters = filters or []
        self._sort_col = sort_col
        self._sort_desc = sort_desc
        self._limit_n = limit_n
        # Expression filters: (source, parsed node), applied after the filters.
        self._wheres = wheres or []

    def _clone(self, **overrides: Any) -> RunQuery:
        kw: dict[str, Any] = {
            "backend": self._backend,
            "project": self._project,
            "status": self._status,
            "filters": list(self._filters),
            "sort_col": self._sort_col,
            "sort_desc": self._sort_desc,
            "limit_n": self._limit_n,
            "wheres": list(self._wheres),
        }
        kw.update(overrides)
        return RunQuery(**kw)

    def filter(self, **kwargs: Any) -> RunQuery:
        """Add filters using Django-style ``field__operator=value`` syntax.

        See class docstring for the full operator list and examples.
        """
        new_filters = list(self._filters)
        new_status = self._status
        for key, value in kwargs.items():
            field, op, sub_field = _parse_lookup(key)
            # Push status=... down to SQL for performance.
            if field == "status" and op == "exact" and sub_field is None:
                new_status = value
                continue
            new_filters.append((field, op, sub_field, value))
        return self._clone(status=new_status, filters=new_filters)

    def where(self, expr: str) -> RunQuery:
        """Keep runs for which the :mod:`cairn.expr` expression is truthy
        (None, e.g. a missing value, does not match). The expression must be
        a scalar; it is parsed and type-checked here, so a bad one raises
        :class:`cairn.expr.ExprError` right away."""
        node = _expr.parse(expr)
        if _expr.check(node).shape == "series":
            raise _expr.ExprError(
                "where() needs a scalar expression; reduce the series, e.g. last(loss) < 0.1",
                node.span,
            )
        return self._clone(wheres=[*self._wheres, (expr, node)])

    def sort(self, column: str, *, desc: bool = True) -> RunQuery:
        return self._clone(sort_col=column, sort_desc=desc)

    def limit(self, n: int) -> RunQuery:
        return self._clone(limit_n=n)

    def list(self) -> list[Run]:
        """Execute the query and return matching runs.

        Filters other than ``status`` run client-side, so with filters every
        page of runs is fetched first and the limit applies after filtering.
        """
        runs: list[dict[str, Any]] = []
        pushdown = (
            self._limit_n if self._limit_n and not self._filters and not self._wheres else None
        )
        while True:
            page = _PAGE if pushdown is None else min(_PAGE, pushdown - len(runs))
            rows, total = self._backend.list_runs(
                project=self._project,
                status=self._status,
                limit=page,
                offset=len(runs),
                sort_col=self._sort_col,
                sort_desc=self._sort_desc,
            )
            runs.extend(rows)
            if not rows or len(runs) >= total or (pushdown is not None and len(runs) >= pushdown):
                break
        result = [Run(r, self._backend) for r in runs]

        # Apply Django-style filters client-side.
        for field, op, sub_field, value in self._filters:
            comparator = _OPERATORS[op]
            kept: list[Run] = []
            for run in result:
                actual = _get_field_value(run, field, sub_field)
                try:
                    if comparator(actual, value):
                        kept.append(run)
                except (TypeError, ValueError):
                    pass
            result = kept

        for _src, node in self._wheres:
            result = [run for run in result if self._where_matches(node, run)]

        if self._limit_n and len(result) > self._limit_n:
            result = result[:self._limit_n]

        return result

    @staticmethod
    def _where_matches(node: _expr.Node, run: Run) -> bool:
        import warnings

        r = _expr.evaluate(node, _RunExprContext(run))
        for w in r.warnings:
            warnings.warn(w, stacklevel=4)
        return _expr.matches(r)

    def history(self, keys: list[str] | None = None) -> Any:
        """Scalar history of every matching run as a long pandas DataFrame.

        Columns: ``run_id, run_name, name, step, wall_time, value``.
        ``keys`` selects sequence names (None: all scalar sequences).
        Needs the ``[export]`` extra.
        """
        return _history_frame(self._backend, self.list(), keys)

    def first(self) -> Run | None:
        runs = self._clone(sort_desc=False, limit_n=self._limit_n or 1000).list()
        return runs[0] if runs else None

    def last(self) -> Run | None:
        runs = self._clone(sort_desc=True, limit_n=self._limit_n or 1000).list()
        return runs[0] if runs else None

    def latest_url(self, tag: str, *, live: bool = True, step: str | int = "latest") -> str:
        """A live query URL for ``tag`` on the *latest* run matching this query.

        The query's ``project``/``status``/``filter(...)`` predicates are
        emitted as URL selectors, so
        ``reader.runs("demo").filter(lr__gt=1e-4).latest_url("render")`` yields
        ``.../api/query?run=latest&tag=render&project=demo&lr__gt=0.0001``.

        Requires a server target (the URL is fetched over HTTP); raises on a
        local-only backend. ``live=False`` resolves once and returns the baked
        immutable digest URL.
        """
        if self._wheres:
            raise ValueError("latest_url() cannot express where() filters; use filter(...)")
        base = getattr(self._backend, "server_url", None)
        if base is None:
            from .query_urls import _LOCAL_ONLY_MSG
            raise ValueError(_LOCAL_ONLY_MSG)
        from .query_urls import query_url as _query_url

        filters: dict[str, Any] = {}
        if self._status is not None:
            filters["status"] = self._status
        for f_field, op, sub_field, value in self._filters:
            key = f"{f_field}.{sub_field}" if sub_field else f_field
            if op != "exact":
                key = f"{key}__{op}"
            filters[key] = value
        return _query_url(
            tag, run="latest", project=self._project, live=live, step=step,
            server=base, **filters,
        )

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
        for field, op, sub_field, value in self._filters:
            key = field if sub_field is None else f"{field}__{sub_field}"
            if op != "exact":
                key = f"{key}__{op}"
            parts.append(f"{key}={value!r}")
        for src, _node in self._wheres:
            parts.append(f"where({src!r})")
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
    def get_sequence(self, run_id: str, name: str, *,
                     step_from: int | None, step_to: int | None,
) -> list[dict[str, Any]]: ...
    def scalar_series(self, run_ids: list[str], names: list[str] | None) -> list[dict[str, Any]]: ...
    def list_artifacts(self, run_id: str) -> dict[str, Any]: ...
    def get_artifact_bytes(self, digest: str) -> bytes: ...
    def get_artifact_path(self, digest: str) -> Path | None: ...
    def get_logs(self, run_id: str, *, stream: str | None, search: str | None,
                 limit: int, offset: int) -> tuple[list[dict[str, Any]], int]: ...
    def get_source_tree(self, run_id: str) -> dict[str, Any] | None: ...
    def get_source_file(self, run_id: str, path: str) -> str | None: ...
    # Versioned artifact registry
    def list_artifact_families(self, project_id: str, type_filter: str | None = None) -> list[dict[str, Any]]: ...
    def list_artifact_versions(self, family_id: str) -> list[dict[str, Any]]: ...
    def resolve_artifact_ref(self, project_id: str, ref: str) -> dict[str, Any]: ...
    def get_run_inputs(self, run_id: str) -> list[dict[str, Any]]: ...
    def get_run_outputs(self, run_id: str) -> list[dict[str, Any]]: ...
    def get_lineage(self, project_id: str, **kwargs: Any) -> dict[str, Any]: ...


# ---------------------------------------------------------------------------
# Local backend — direct SQLite access
# ---------------------------------------------------------------------------

def _api_run_row(row: dict[str, Any]) -> dict[str, Any]:
    """Local rows in the same shape the HTTP backend returns."""
    from ..server.routes._common import api_run_row

    return api_run_row(row)


class _LocalBackend:
    def __init__(self, repo: str | Path, *, zip_source: str | None = None) -> None:
        from ..server.storage.blobs import BlobStore
        from ..server.storage.datadir import DataDir
        from ..server.storage.db import Database
        from ..server.wal_ingest import ingest_all as _ingest_all

        self._dd = DataDir(Path(repo))
        self._db = Database.open(self._dd.db_path)
        self._blobs = BlobStore(self._dd.artifacts_dir)
        self._ingest_all = _ingest_all
        self._zip_source = zip_source

    @property
    def edit_target(self) -> str:
        """Where edits go: the repo dir, through ``open_transport`` (which
        reaches a server holding the repo over HTTP)."""
        if self._zip_source is not None:
            raise ValueError(f"runs read from an exported archive ({self._zip_source}) can't be edited")
        return str(self._dd.root)

    @property
    def repo_path(self) -> str:
        """The ``.cairn/`` dir this backend reads — lets `cairn.plot`
        element builders thread the actual repo dir to `CardElement` for
        local server auto-discovery (`servers.json`), rather than relying
        on global `cairn.configure`/`CAIRN_REPO` state."""
        return str(self._dd.root)

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
        return self._with_values([_api_run_row(r) for r in rows]), total

    def _with_values(self, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Each row with ``values``, from the server function the runs routes use."""
        from ..server.summary_rules import resolved_values

        values = resolved_values(self._db, [r["id"] for r in rows])
        for r in rows:
            r["values"] = values.get(r["id"], {})
        return rows

    def get_run(self, run_id: str) -> dict[str, Any]:
        self._drain_wals()
        rows = self._with_values([
            _api_run_row(r) for r in self._db.read_columns("SELECT * FROM runs WHERE id = ?", [run_id])
        ])
        if not rows:
            raise KeyError(f"Run {run_id!r} not found")
        params = self._db.read_columns(
            "SELECT key, value, value_type FROM params WHERE run_id = ? ORDER BY key",
            [run_id],
        )
        summary = self._db.read_columns(
            "SELECT key, value, value_type FROM summary WHERE run_id = ? ORDER BY key",
            [run_id],
        )
        return {"run": rows[0], "params": params, "summary": summary}

    def list_sequences(self, run_id: str) -> list[dict[str, Any]]:
        return self._db.read_columns(
            """SELECT name, MAX(object_type) AS object_type,
                      MIN(step) AS min_step, MAX(step) AS max_step, COUNT(*) AS count
               FROM sequences WHERE run_id = ?
               GROUP BY name
               ORDER BY name""",
            [run_id],
        )

    def get_sequence(
        self, run_id: str, name: str, *,
        step_from: int | None = None, step_to: int | None = None,
    ) -> list[dict[str, Any]]:
        clauses = ["s.run_id = ?", "s.name = ?"]
        params: list[Any] = [run_id, name]
        if step_from is not None:
            clauses.append("s.step >= ?")
            params.append(step_from)
        if step_to is not None:
            clauses.append("s.step <= ?")
            params.append(step_to)
        where = " AND ".join(clauses)
        rows = self._db.read_columns(
            f"""SELECT s.step, s.wall_time, s.scalar_value, s.artifact_hash,
                       s.object_type, s.metadata,
                       a.mime_type AS artifact_mime, a.size_bytes AS artifact_size,
                       a.metadata AS artifact_metadata
                FROM sequences s
                LEFT JOIN artifacts a ON a.hash = s.artifact_hash
                WHERE {where} ORDER BY s.step""",
            params,
        )
        # Simple downsampling if requested.
        return rows

    def scalar_series(self, run_ids: list[str], names: list[str] | None) -> list[dict[str, Any]]:
        from ..server.routes.compare import scalar_series

        return scalar_series(self._db, run_ids, names)

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

    # ---- Versioned artifact registry ----

    def list_artifact_families(self, project_id: str, type_filter: str | None = None) -> list[dict[str, Any]]:
        self._drain_wals()
        from ..server import artifact_registry_ops
        return artifact_registry_ops.list_families(self._db, project_id, type_filter=type_filter)

    def list_artifact_versions(self, family_id: str) -> list[dict[str, Any]]:
        self._drain_wals()
        from ..server import artifact_registry_ops
        return artifact_registry_ops.list_versions(self._db, family_id)

    def resolve_artifact_ref(self, project_id: str, ref: str) -> dict[str, Any]:
        self._drain_wals()
        from ..server import artifact_registry_ops
        return artifact_registry_ops.resolve_ref(self._db, project_id, ref)

    def get_run_inputs(self, run_id: str) -> list[dict[str, Any]]:
        self._drain_wals()
        from ..server import artifact_registry_ops
        return artifact_registry_ops.get_run_inputs(self._db, run_id)

    def get_run_outputs(self, run_id: str) -> list[dict[str, Any]]:
        self._drain_wals()
        from ..server import artifact_registry_ops
        return artifact_registry_ops.get_run_outputs(self._db, run_id)

    def get_lineage(self, project_id: str, **kwargs: Any) -> dict[str, Any]:
        self._drain_wals()
        from ..server import artifact_registry_ops
        return artifact_registry_ops.get_lineage_graph(self._db, project_id, **kwargs)

    def close(self) -> None:
        self._db.close()


# ---------------------------------------------------------------------------
# HTTP backend — connects to a running Cairn server
# ---------------------------------------------------------------------------

def _resolve_cache_dir(explicit: Path | None) -> Path:
    """Where to cache artifact blobs fetched over HTTP.

    1. Explicit ``cache_dir=`` wins.
    2. Else nearest ``.cairn/`` walking up from CWD → ``<.cairn>/cache/blobs``.
    3. Else user-global cache.
    """
    if explicit is not None:
        return Path(explicit) / "blobs"
    cwd = Path.cwd().resolve()
    for parent in [cwd, *cwd.parents]:
        candidate = parent / ".cairn"
        if candidate.is_dir():
            return candidate / "cache" / "blobs"
    import platformdirs
    return Path(platformdirs.user_cache_dir("cairn")) / "reader" / "blobs"


class _HttpBackend:
    def __init__(
        self,
        server_url: str,
        *,
        cache: bool = True,
        cache_dir: Path | None = None,
        token: str | None = None,
    ) -> None:
        import httpx
        self._base = server_url.rstrip("/")
        resolved_token = _config.resolve_token(token)
        headers = {"Authorization": f"Bearer {resolved_token}"} if resolved_token else {}
        self._client = httpx.Client(base_url=self._base, timeout=30.0, headers=headers)
        self._cache_dir = _resolve_cache_dir(cache_dir) if cache else None

    @property
    def server_url(self) -> str:
        """The HTTP base this backend queries — threaded into `CardElement`
        (via `cairn.plot`) so a card renders against the SAME server a
        `Reader(repo="cairn://host:port")` was connected to, without needing
        `cairn.configure`/`CAIRN_REPO`/`server=`."""
        return self._base

    @property
    def edit_target(self) -> str:
        return self._base

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
        step_from: int | None = None, step_to: int | None = None,
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {}
        if step_from is not None:
            params["step_from"] = step_from
        if step_to is not None:
            params["step_to"] = step_to
        return self._get(f"/api/runs/{run_id}/sequences/{name}", params=params)["points"]

    def scalar_series(self, run_ids: list[str], names: list[str] | None) -> list[dict[str, Any]]:
        resp = self._client.post("/api/compare", json={"run_ids": run_ids, "metrics": names})
        resp.raise_for_status()
        return resp.json()["series"]

    def list_artifacts(self, run_id: str) -> dict[str, Any]:
        return self._get(f"/api/runs/{run_id}/artifacts")

    def get_artifact_bytes(self, digest: str) -> bytes:
        if self._cache_dir is not None:
            cached = self._cache_dir / digest[:2] / digest / "blob"
            if cached.exists():
                try:
                    return cached.read_bytes()
                except OSError:
                    pass

        resp = self._client.get(f"/api/artifacts/{digest}")
        resp.raise_for_status()
        data = resp.content

        if self._cache_dir is not None:
            try:
                target = self._cache_dir / digest[:2] / digest / "blob"
                target.parent.mkdir(parents=True, exist_ok=True)
                tmp = target.with_suffix(".tmp")
                tmp.write_bytes(data)
                tmp.replace(target)
            except OSError:
                pass

        return data

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

    # ---- Versioned artifact registry ----

    def list_artifact_families(self, project_id: str, type_filter: str | None = None) -> list[dict[str, Any]]:
        params: dict[str, Any] = {}
        if type_filter:
            params["type"] = type_filter
        return self._get(f"/api/projects/{project_id}/artifact-families", params=params)["families"]

    def list_artifact_versions(self, family_id: str) -> list[dict[str, Any]]:
        return self._get(f"/api/artifact-families/{family_id}/versions")["versions"]

    def resolve_artifact_ref(self, project_id: str, ref: str) -> dict[str, Any]:
        resp = self._client.post(
            f"/api/projects/{project_id}/resolve-artifact-ref", json={"ref": ref}
        )
        resp.raise_for_status()
        return resp.json()

    def get_run_inputs(self, run_id: str) -> list[dict[str, Any]]:
        return self._get(f"/api/runs/{run_id}/inputs")["inputs"]

    def get_run_outputs(self, run_id: str) -> list[dict[str, Any]]:
        return self._get(f"/api/runs/{run_id}/outputs")["outputs"]

    def get_lineage(self, project_id: str, **kwargs: Any) -> dict[str, Any]:
        return self._get(f"/api/projects/{project_id}/lineage", params=kwargs)

    def close(self) -> None:
        self._client.close()


# ---------------------------------------------------------------------------
# ZIP archive support — load an exported run.zip into a temp .cairn/
# ---------------------------------------------------------------------------


def _load_zip_to_tempdir(zip_path: Path) -> tuple[Path, Path]:
    """Load an exported Cairn ZIP into a fresh tempdir-backed .cairn/ repo.

    Returns ``(tempdir, repo_path)``. Caller is responsible for cleaning up
    ``tempdir`` (Reader does this on ``close()``). Run ids are preserved: the
    repo is fresh, so there is nothing to collide with.
    """
    import tempfile as _tempfile
    import zipfile as _zipfile

    from ..server.run_archive import restore_archive
    from ..server.storage.blobs import BlobStore as _BlobStore
    from ..server.storage.datadir import DataDir as _DataDir
    from ..server.storage.db import Database as _Database

    if not zip_path.exists():
        raise FileNotFoundError(f"Cairn ZIP archive not found: {zip_path}")

    tempdir = Path(_tempfile.mkdtemp(prefix="cairn_zip_reader_"))
    repo_path = tempdir / ".cairn"
    dd = _DataDir(repo_path)
    db = _Database.open(dd.db_path)
    try:
        with _zipfile.ZipFile(zip_path) as zf:
            try:
                restore_archive(db, _BlobStore(dd.artifacts_dir), dd, zf, keep_ids=True)
            except ValueError as e:
                raise ValueError(f"Invalid Cairn ZIP archive (no manifest.json): {zip_path}") from e
    finally:
        db.close()
    return tempdir, repo_path


# ---------------------------------------------------------------------------
# Reader — public entry point
# ---------------------------------------------------------------------------

class Reader:
    """Read-only interface to a Cairn repo, server, or exported ZIP.

    Args:
        repo: Path to a ``.cairn/`` directory, ``cairn://host:port`` for an
            HTTP server, or a path to an exported ``.zip`` archive.
        cache: For HTTP repos, cache downloaded artifact bytes by SHA256
            so repeated reads don't re-download. Default True.
        cache_dir: Override cache location. By default uses
            ``<nearest .cairn>/cache/`` if found, else the user cache dir.

    If not specified, auto-detects from env/config (same logic as ``cairn.Run``).
    """

    def __init__(
        self,
        repo: str | Path | None = None,
        *,
        cache: bool = True,
        cache_dir: str | Path | None = None,
    ) -> None:
        # ZIP file: ``cairn.Reader(repo="run.zip")`` — load an exported archive
        # into a tempdir and read from there.
        if repo is not None and str(repo).endswith(".zip"):
            self._tempdir, repo_path = _load_zip_to_tempdir(Path(repo))
            self._backend: _LocalBackend | _HttpBackend = _LocalBackend(repo_path, zip_source=str(repo))
            self._zip_source: str | None = str(repo)
            return
        self._tempdir = None
        self._zip_source = None
        target = _config.resolve_target(repo=repo)
        if target.is_local:
            self._backend = _LocalBackend(target.location)
        else:
            self._backend = _HttpBackend(
                target.location,
                cache=cache,
                cache_dir=Path(cache_dir) if cache_dir else None,
            )

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

    # ---- Versioned Artifact Registry ----

    def artifact_families(self, project: str, *, type: str | None = None) -> list[dict[str, Any]]:
        """List artifact families in a project, optionally filtered by type."""
        project_id = project.lower().replace(" ", "-")
        return self._backend.list_artifact_families(project_id, type_filter=type)

    def artifact_versions(self, family_name: str, *, project: str) -> list[dict[str, Any]]:
        """List all versions of an artifact family."""
        project_id = project.lower().replace(" ", "-")
        # Resolve family name to id first
        ref = f"{family_name}:latest"
        try:
            info = self._backend.resolve_artifact_ref(project_id, ref)
            family_id = info.get("family_id", "")
        except Exception:
            # Fallback: search through families
            families = self._backend.list_artifact_families(project_id)
            family_id = ""
            for f in families:
                if f.get("name") == family_name:
                    family_id = f["id"]
                    break
            if not family_id:
                raise KeyError(f"Artifact family {family_name!r} not found in project {project!r}")
        return self._backend.list_artifact_versions(family_id)

    def lineage(self, project: str, **kwargs: Any) -> dict[str, Any]:
        """Get artifact lineage graph for a project."""
        project_id = project.lower().replace(" ", "-")
        return self._backend.get_lineage(project_id, **kwargs)

    def resolve_and_download_artifact(self, project_id: str, ref: str) -> Any:
        """Resolve an artifact ref and download+deserialize the content."""
        info = self._backend.resolve_artifact_ref(project_id, ref)
        data = self._backend.get_artifact_bytes(info["hash"])
        if info.get("mime_type") == MANIFEST_MIME:
            return ArtifactDir.from_bytes(data, self._backend.get_artifact_bytes)
        object_type = info.get("object_type")
        if object_type:
            from .handlers.registry import default_registry
            handler = default_registry.find_by_type(object_type)
            if handler and hasattr(handler, "deserialize"):
                meta = info.get("metadata", {})
                if isinstance(meta, str):
                    try:
                        meta = json.loads(meta)
                    except (json.JSONDecodeError, TypeError):
                        meta = {}
                return handler.deserialize(data, meta)
        return data

    def close(self) -> None:
        """Close the underlying database or HTTP connection."""
        self._backend.close()
        if self._tempdir is not None:
            import shutil as _shutil
            _shutil.rmtree(self._tempdir, ignore_errors=True)
            self._tempdir = None

    def __enter__(self) -> Reader:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()

    def __repr__(self) -> str:
        if self._zip_source is not None:
            return f"Reader(repo={self._zip_source!r})"
        if isinstance(self._backend, _LocalBackend):
            return f"Reader(repo={str(self._backend._dd.root)!r})"
        # HTTP backend: convert http://host:port → cairn://host:port for display
        base = self._backend._base
        cairn_url = base.replace("http://", "cairn://", 1) if base.startswith("http://") else base
        return f"Reader(repo={cairn_url!r})"
