"""Pure data-shaping helpers for the composable ``cairn_plot`` components.

Factored out of ``cairn/plot.py`` for the cairn-plot packaging split (P2-M2).
Every function here is **pure**: stdlib + numpy only, with no cairn app/server
coupling. The ``*_from_ref`` helpers are duck-typed against a ``run[tag]``
handle (they call methods on the passed object but import nothing from cairn),
so they are inert in a standalone import (a standalone user never has a
``DataRef`` to pass) yet keep working through the ``cairn.plot`` shim.

The handful of shapers that need cairn's tracking handlers (raw table + 3D
array serialization) do NOT live here — they stay in the ``cairn.plot`` shim
and are wired into :mod:`cairn_plot.components` via its resolver registry.
"""

from __future__ import annotations

import hashlib as _hashlib
import json as _json
from typing import Any

import numpy as np

# The app's categorical series palette — mirrors `SERIES_COLORS` in
# `cairn/ui/src/lib/cairn-plot/types.ts` so a Python-emitted scalar plot uses
# the exact same colors as the same metric in the viewer.
_SERIES_COLORS = (
    "#0969da",
    "#d29922",
    "#3fb950",
    "#f85149",
    "#c678dd",
    "#56d4dd",
)


# ---------------------------------------------------------------------------
# data_mode / content-address helpers
# ---------------------------------------------------------------------------

_DATA_MODES = ("local", "endpoint")


def _check_data_mode(data_mode: str) -> None:
    if data_mode not in _DATA_MODES:
        raise ValueError(
            f"data_mode must be one of {_DATA_MODES!r}, got {data_mode!r}"
        )


def _content_hash(data: bytes) -> str:
    """A content-address for baked bytes — matches the store-key convention
    (design spec §5/R6): the artifact's own hash when known, else this."""
    return "sha256:" + _hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------------------
# DataRef server resolution (duck-typed getattr — inert standalone).
# ---------------------------------------------------------------------------


def _backend_of(source: Any) -> Any:
    """The `_LocalBackend`/`_HttpBackend` behind a `DataRef`'s `Run`, if any."""
    return getattr(getattr(source, "run", None), "_backend", None)


def _server_url_of(source: Any) -> str | None:
    """Best-effort HTTP base behind a `DataRef`'s `Run` when its `Reader`
    was opened in server mode (``Reader(repo="cairn://host:port")``), else
    `None`."""
    return getattr(_backend_of(source), "server_url", None)


def _endpoint_server_of(source: Any) -> str:
    """The HTTP base for ENDPOINT mode, or a clear error. Prefers the server
    the source `Reader` was connected to (`_server_url_of`)."""
    url = _server_url_of(source)
    if url:
        return url
    raise ValueError(
        "cairn.plot(..., data_mode='endpoint') needs a reachable cairn "
        "server, but the data came from a local repo. Use data_mode='local' "
        "(the self-contained default), or open the reader in server mode "
        '(`cairn.Reader(repo="cairn://host:port")`).'
    )


# ---- scalar ---------------------------------------------------------------


def _scalar_series_from_ref(ref: Any) -> dict[str, Any]:
    """A `run[tag]` scalar sequence → one `Series` (design spec §1 ScalarPlot):
    `{key,label,color,points:[{x,y,wallTime?}]}` from `Run.sequence`."""
    seq = ref.run.sequence(ref.tag)
    points: list[dict[str, Any]] = []
    for p in seq.points:
        if p.scalar_value is None:
            continue
        pt: dict[str, Any] = {"x": p.step, "y": float(p.scalar_value)}
        if p.wall_time:
            pt["wallTime"] = p.wall_time
        points.append(pt)
    return {
        "key": ref.tag,
        "label": ref.tag,
        "color": _SERIES_COLORS[0],
        "points": points,
    }


def _scalar_series_from_raw(values: Any) -> dict[str, Any]:
    arr = np.asarray(list(values), dtype=np.float64).ravel()
    if arr.size == 0:
        raise ValueError("scalar(...) raw data must not be empty")
    return {
        "key": "value",
        "label": "value",
        "color": _SERIES_COLORS[0],
        "points": [
            {"x": int(i), "y": float(v)}
            for i, v in enumerate(arr)
            if np.isfinite(v)
        ],
    }


# ---- line (multi-series) --------------------------------------------------


def _line_one_series(key: str, values: Any, x: Any, idx: int) -> dict[str, Any]:
    """One raw y-sequence → a ``Series`` ``{key,label,color,points:[{x,y}]}``.

    ``x`` is ``None`` (plot against the integer index) or an array-like shared
    x-axis matching ``values`` in length. Non-finite y's are dropped."""
    yarr = np.asarray(list(values), dtype=np.float64).ravel()
    if yarr.size == 0:
        raise ValueError("cp.Line(...) each series must be a non-empty sequence")
    if x is None:
        xs: list[Any] = list(range(yarr.size))
        x_is_index = True
    else:
        xarr = np.asarray(list(x), dtype=np.float64).ravel()
        if xarr.size != yarr.size:
            raise ValueError(
                f"cp.Line(x=...) length {xarr.size} does not match the series "
                f"length {yarr.size}"
            )
        xs = list(xarr)
        x_is_index = False
    points = [
        {"x": (int(xv) if x_is_index else float(xv)), "y": float(v)}
        for xv, v in zip(xs, yarr)
        if np.isfinite(v)
    ]
    return {
        "key": str(key),
        "label": str(key),
        "color": _SERIES_COLORS[idx % len(_SERIES_COLORS)],
        "points": points,
    }


def _line_series_list(y: Any, *, x: Any = None, label: str | None = None) -> list[dict[str, Any]]:
    """Raw ``cp.Line`` input → a list of ``Series`` (the ``scalar`` renderer's
    ``series`` data-contract). Accepts a single 1-D sequence, a dict of named
    sequences ``{name: seq}``, or a 2-D array (one series per row)."""
    if isinstance(y, dict):
        if not y:
            raise ValueError("cp.Line({}) requires at least one named series")
        return [_line_one_series(k, v, x, i) for i, (k, v) in enumerate(y.items())]
    seq = list(y)
    if seq and isinstance(seq[0], (list, tuple, np.ndarray)):
        return [_line_one_series(f"series_{i}", row, x, i) for i, row in enumerate(seq)]
    key = label if label is not None else "value"
    return [_line_one_series(key, y, x, 0)]


# ---- scatter --------------------------------------------------------------


def _scatter_points_from_raw(
    x: Any, y: Any, *, color: Any = None, labels: Any = None
) -> list[dict[str, Any]]:
    """Raw x/y (+ optional per-point color / labels) → ``ScatterPoint[]``
    (``{id,x,y,color,label?}`` — ``color`` is a numeric value the renderer maps
    through the viridis colorbar, or ``None``)."""
    xa = np.asarray(list(x), dtype=np.float64).ravel()
    ya = np.asarray(list(y), dtype=np.float64).ravel()
    if xa.size == 0:
        raise ValueError("cp.Scatter(...) x/y must not be empty")
    if xa.size != ya.size:
        raise ValueError(
            f"cp.Scatter(...) x and y must have the same length "
            f"({xa.size} vs {ya.size})"
        )
    n = xa.size
    ca = None
    if color is not None:
        ca = np.asarray(list(color), dtype=np.float64).ravel()
        if ca.size != n:
            raise ValueError("cp.Scatter(color=...) must match x/y length")
    labs = list(labels) if labels is not None else None
    if labs is not None and len(labs) != n:
        raise ValueError("cp.Scatter(labels=...) must match x/y length")
    points: list[dict[str, Any]] = []
    for i in range(n):
        pt: dict[str, Any] = {
            "id": str(i),
            "x": float(xa[i]),
            "y": float(ya[i]),
            "color": (float(ca[i]) if ca is not None else None),
        }
        if labs is not None:
            pt["label"] = str(labs[i])
        points.append(pt)
    return points


# ---- bar ------------------------------------------------------------------


def _bar_data_from_raw(
    values: Any, *, labels: Any = None, colors: Any = None
) -> list[dict[str, Any]]:
    """Raw bar values (+ optional labels / colors) → ``BarDatum[]``
    (``{id,label,value,color?}``). Labels default to the bar index."""
    va = np.asarray(list(values), dtype=np.float64).ravel()
    if va.size == 0:
        raise ValueError("cp.Bar(...) values must not be empty")
    n = va.size
    labs = list(labels) if labels is not None else [str(i) for i in range(n)]
    if len(labs) != n:
        raise ValueError(
            f"cp.Bar(labels=...) length {len(labs)} must match values length {n}"
        )
    cols = list(colors) if colors is not None else None
    if cols is not None and len(cols) != n:
        raise ValueError("cp.Bar(colors=...) must match values length")
    bars: list[dict[str, Any]] = []
    for i in range(n):
        bar_datum: dict[str, Any] = {
            "id": str(i),
            "label": str(labs[i]),
            "value": float(va[i]),
        }
        if cols is not None:
            bar_datum["color"] = str(cols[i])
        bars.append(bar_datum)
    return bars


# ---- histogram ------------------------------------------------------------


def _histogram_from_samples(x: Any, bins: int = 30) -> tuple[list[float], list[float]]:
    """Raw samples → ``(counts, edges)`` via ``numpy.histogram`` (uniform bins;
    ``len(edges) == len(counts) + 1``, mirroring the TS ``computeHistogram``)."""
    xa = np.asarray(list(x), dtype=np.float64).ravel()
    xa = xa[np.isfinite(xa)]
    if xa.size == 0:
        raise ValueError("cp.Histogram(...) samples must not be empty (after "
                         "dropping non-finite values)")
    counts, edges = np.histogram(xa, bins=bins)
    return [int(c) for c in counts], [float(e) for e in edges]


def _histogram_check_precomputed(counts: Any, edges: Any) -> tuple[list[float], list[float]]:
    c = [float(v) for v in counts]
    e = [float(v) for v in edges]
    if len(e) != len(c) + 1:
        raise ValueError(
            f"cp.Histogram(counts=..., edges=...): len(edges) must equal "
            f"len(counts)+1, got {len(e)} edges for {len(c)} counts"
        )
    return c, e


# ---- heatmap --------------------------------------------------------------


def _heatmap_matrix_from_raw(z: Any) -> list[list[float]]:
    """Raw 2-D array-like → ``matrix: number[][]`` (``matrix[y][x]``)."""
    arr = np.asarray(z, dtype=np.float64)
    if arr.ndim != 2:
        raise ValueError(
            f"cp.Heatmap(...) expects a 2-D matrix, got a {arr.ndim}-D array"
        )
    if arr.size == 0:
        raise ValueError("cp.Heatmap(...) matrix must not be empty")
    return [[float(v) for v in row] for row in arr]


# ---- parallel coordinates -------------------------------------------------


def _normalize_parallel_dims(dimensions: Any) -> list[tuple[str, list[Any]]]:
    """A ParallelCoordinates ``dimensions`` arg → ``[(label, values), ...]``.
    Accepts a list of ``{label, values}`` dicts, a ``{label: values}`` dict, or
    a pandas ``DataFrame`` (duck-typed via ``.columns``; pandas is not a cairn
    dependency)."""
    if hasattr(dimensions, "columns") and not isinstance(dimensions, dict):
        return [(str(c), list(dimensions[c])) for c in list(dimensions.columns)]
    if isinstance(dimensions, dict):
        return [(str(k), list(v)) for k, v in dimensions.items()]
    out: list[tuple[str, list[Any]]] = []
    for d in dimensions:
        if not isinstance(d, dict) or "label" not in d or "values" not in d:
            raise TypeError(
                "cp.ParallelCoordinates(...) list entries must be dicts with "
                "'label' and 'values' keys (Plotly-style dimensions)"
            )
        out.append((str(d["label"]), list(d["values"])))
    return out


def _parallel_column(vals: list[Any]) -> tuple[list[float | None], list[str], dict[str, Any]]:
    """One dimension's raw values → ``(numeric_values, raw_strings, domain)``.

    A column is NUMERIC when every non-null value parses as a float; otherwise
    it is CATEGORICAL — categories are mapped to their first-seen index and the
    original strings are preserved in ``raw`` (shown in the renderer tooltip)."""
    nums: list[float | None] = []
    is_numeric = True
    for v in vals:
        if v is None:
            nums.append(None)
            continue
        try:
            nums.append(float(v))
        except (TypeError, ValueError):
            is_numeric = False
            break
    if is_numeric:
        finite = [x for x in nums if x is not None and np.isfinite(x)]
        lo, hi = (float(min(finite)), float(max(finite))) if finite else (0.0, 1.0)
        raw = ["" if v is None else _num_str(float(v)) for v in vals]
        values = [None if v is None else float(v) for v in nums]
        return values, raw, {"min": lo, "max": hi, "isNumeric": True}
    # categorical: stable first-seen index per distinct string.
    seen: dict[str, int] = {}
    for v in vals:
        if v is not None and str(v) not in seen:
            seen[str(v)] = len(seen)
    values = [None if v is None else float(seen[str(v)]) for v in vals]
    raw = ["" if v is None else str(v) for v in vals]
    domain = {"min": 0.0, "max": float(max(len(seen) - 1, 1)), "isNumeric": False}
    return values, raw, domain


def _num_str(v: float) -> str:
    if not np.isfinite(v):
        return ""
    if v == int(v) and abs(v) < 1e15:
        return str(int(v))
    return f"{v:.4g}"


def _parallel_from_dimensions(
    dimensions: Any,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Raw ``dimensions`` → ``(columns, rows, columnDomains)`` — the ``parallel``
    renderer's data contract. ``columns`` = ``[{key,source}]``, ``rows`` =
    ``[{id,values,raw}]`` (values numeric-or-null, aligned to columns),
    ``columnDomains`` = ``[{min,max,isNumeric}]``."""
    dims = _normalize_parallel_dims(dimensions)
    if not dims:
        raise ValueError("cp.ParallelCoordinates(...) requires at least one dimension")
    nrows = len(dims[0][1])
    for label, vals in dims:
        if len(vals) != nrows:
            raise ValueError(
                f"cp.ParallelCoordinates(...) dimension {label!r} has "
                f"{len(vals)} rows but the first dimension has {nrows}; all "
                "dimensions must have the same number of rows"
            )
    columns: list[dict[str, Any]] = []
    column_domains: list[dict[str, Any]] = []
    per_col: list[tuple[list[float | None], list[str]]] = []
    for label, vals in dims:
        values, raw, domain = _parallel_column(vals)
        columns.append({"key": str(label), "source": "param"})
        column_domains.append(domain)
        per_col.append((values, raw))
    rows: list[dict[str, Any]] = []
    for i in range(nrows):
        rows.append(
            {
                "id": str(i),
                "values": [per_col[c][0][i] for c in range(len(dims))],
                "raw": [per_col[c][1][i] for c in range(len(dims))],
            }
        )
    return columns, rows, column_domains


# ---- figure ---------------------------------------------------------------


def _figure_json_from_ref(ref: Any) -> dict[str, Any]:
    """A `run[tag]` figure artifact → its interactive Plotly `{data,layout}`.

    The figure handler stores a PNG primary + the Plotly source as a SEPARATE
    artifact, referenced from the PNG artifact's metadata (`source_hash` +
    `source_format="plotly_json"`) — see `handlers/figure.py`. Fetch that
    source blob."""
    ai = _artifact_info_of(ref)
    meta = _parse_meta(ai.metadata)
    source_hash = meta.get("source_hash")
    if not source_hash or meta.get("source_format") != "plotly_json":
        raise ValueError(
            f"figure artifact {ref.tag!r} has no interactive plotly source "
            "(only a rasterized PNG); nothing to mount in the figure renderer."
        )
    raw = ref.run._backend.get_artifact_bytes(source_hash)
    return _json.loads(raw.decode("utf-8"))


def _figure_json_from_plotly(fig: Any) -> dict[str, Any]:
    if not hasattr(fig, "to_json"):
        raise TypeError(
            "cairn.plot.figure(...) expects a run[tag] handle or a plotly "
            f"Figure (an object with .to_json()); got {type(fig).__name__}"
        )
    obj = _json.loads(fig.to_json())
    return {"data": obj.get("data", []), "layout": obj.get("layout", {})}


# ---- table ----------------------------------------------------------------


def _table_json_from_ref(ref: Any) -> dict[str, Any]:
    """A `run[tag]` table artifact → `{columns,data,truncated?}` (the exact
    `handlers/table.py` blob format the Table renderer consumes)."""
    tbl = ref.run.artifact(ref.tag, step=ref.step)
    if not isinstance(tbl, dict) or "columns" not in tbl:
        raise ValueError(
            f"table artifact {ref.tag!r} did not deserialize to a "
            "{columns,data} table blob."
        )
    return tbl


# ---- image ----------------------------------------------------------------


def _artifact_info_of(ref: Any) -> Any:
    """The `ArtifactInfo` (hash + mime + metadata) behind `run[tag][step?]`."""
    matches = [
        ai
        for ai in ref.run.artifacts()
        if ai.name == ref.tag and (ref.step is None or ai.step == ref.step)
    ]
    if not matches:
        raise KeyError(
            f"No artifact named {ref.tag!r}"
            + (f" at step {ref.step}" if ref.step is not None else "")
            + f" on run {ref.run_id!r}."
        )
    # Highest step (the "latest") when unspecified.
    return max(matches, key=lambda a: a.step if a.step is not None else -1)


def _parse_meta(meta: Any) -> dict[str, Any]:
    if isinstance(meta, str):
        try:
            parsed = _json.loads(meta)
        except _json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return meta if isinstance(meta, dict) else {}


def _encode_image_raw(data: Any) -> tuple[bytes, str]:
    """Raw image (bytes / PIL.Image / ndarray) → `(png_or_orig_bytes, mime)`."""
    if isinstance(data, (bytes, bytearray)):
        b = bytes(data)
        # Sniff the container so the `data:` URL MIME is right.
        if b[:8] == b"\x89PNG\r\n\x1a\n":
            return b, "image/png"
        if b[:3] == b"\xff\xd8\xff":
            return b, "image/jpeg"
        if b[:6] in (b"GIF87a", b"GIF89a"):
            return b, "image/gif"
        if b[:4] == b"RIFF" and b[8:12] == b"WEBP":
            return b, "image/webp"
        return b, "image/png"  # best-effort default
    try:
        from PIL import Image as _PILImage
    except ImportError as exc:  # pragma: no cover
        raise ImportError(
            "cairn.plot.image(...) with a raw PIL/ndarray image requires "
            "Pillow. Install it with `pip install cairn-track[media]`."
        ) from exc
    import io as _io

    if isinstance(data, np.ndarray):
        arr = data
        if arr.dtype != np.uint8:
            # Assume float in [0,1] or already-scaled ints; clip to uint8.
            arr = np.clip(arr, 0, 255).astype(np.uint8) if arr.max() > 1 else (
                np.clip(arr, 0, 1) * 255
            ).astype(np.uint8)
        img = _PILImage.fromarray(arr)
    elif hasattr(data, "save"):  # PIL.Image (duck-typed)
        img = data
    else:
        raise TypeError(
            "cairn.plot.image(...) raw data must be bytes, a PIL.Image, or a "
            f"numpy array; got {type(data).__name__}"
        )
    buf = _io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue(), "image/png"
