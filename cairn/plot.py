"""cairn.plot — the cairn-facing plotting surface (P2-M2 packaging shim).

The pure plotting library now lives in the standalone ``cairn_plot``
distribution (``import cairn_plot as cp``). This module re-exports its entire
public surface unchanged — the composable components (``cp.Line``/``cp.Image``/
``cp.Grid``/``cp.Compare``/…), the lowercase builders (``cp.scalar``/``cp.image``
/…), ``cp.Report``/``cp.report``, and the pure-numpy Plotly recipes
(``cp.confusion_matrix``/``cp.roc_curve``/``cp.bar``/…) — so every existing
``import cairn.plot as cp`` keeps working identically.

On top of that pure surface it layers cairn's run-integration extras, which
``cairn_plot`` itself must not couple to (packaging spec §3–§4):

* it registers the reader's ``DataRef`` type so a ``run[tag]`` handle is
  recognized by the pure components (``cp.Line(run["loss"])``), and the
  tracking-handler serializers so raw tabular / 3D-array data
  (``cp.Table(df)`` / ``cp.PointCloud(arr)``) shapes through the exact same
  ``handlers/*`` code the tracking path uses;
* it adds the server-backed media-compare card helpers (``media_compare`` /
  ``image_compare`` / ``mesh_compare`` / … ), which render a live
  ``/embed/card`` iframe and therefore need the cairn server.
"""

from __future__ import annotations

import json as _json
import uuid as _uuid
from typing import Any, Sequence

# Re-export the whole standalone surface (components, builders, recipes, Report).
import cairn_plot as _cairn_plot
from cairn_plot import *  # noqa: F401,F403
from cairn_plot import Boxes, Compare, Mesh, PointCloud, Volume  # noqa: F401
from cairn_plot.components import register_data_ref_type, register_resolvers

from .sdk.card_spec import CardSettingsSpec, CardSpec, SeriesRef
from .sdk.elements import CardElement
from .sdk.reader import ArtifactInfo, DataRef  # noqa: F401 - ArtifactInfo kept for callers


# ---------------------------------------------------------------------------
# Wire the DataRef seam (packaging spec §4): teach the pure plot components to
# recognize a cairn ``run[tag]`` handle without importing cairn.sdk.reader
# themselves.
# ---------------------------------------------------------------------------

register_data_ref_type(DataRef)


# ---------------------------------------------------------------------------
# Wire the tracking-handler serializers: the raw-table + 3D-array data paths
# need cairn's ``handlers/*`` (which ``cairn_plot`` must not import). Registered
# into the pure components' resolver seam so ``cp.Table(df)`` /
# ``cp.PointCloud(arr)`` / ``cp.Mesh(v, f)`` / … keep working unchanged.
# ---------------------------------------------------------------------------


def _table_json_from_raw(data: Any) -> dict[str, Any]:
    """Raw tabular data → the canonical table blob, via the same
    ``TableHandler`` the tracking path uses (columns/type inference identical)."""
    from .sdk.handlers.table import TableHandler

    if hasattr(data, "itertuples") and hasattr(data, "columns"):
        wrapper: dict[str, Any] = {"dataframe": data}
    elif isinstance(data, dict):
        wrapper = {"columns": list(data.keys()), "data": list(zip(*data.values()))} if data else {"data": []}
    else:
        rows = list(data)
        if rows and isinstance(rows[0], dict):
            columns: list[str] = []
            for r in rows:
                for k in r:
                    if k not in columns:
                        columns.append(k)
            wrapper = {"columns": columns, "data": [[r.get(c) for c in columns] for r in rows]}
        else:
            wrapper = {"data": rows}
    blob, _meta = TableHandler().serialize(wrapper)
    return _json.loads(blob.decode("utf-8"))


def _serialize_pointcloud(data: Any, values: Any = None) -> tuple[bytes, dict[str, Any]]:
    from .sdk.handlers.pointcloud import PointCloudHandler

    return PointCloudHandler().serialize(data, values=values)


def _serialize_mesh(payload: dict[str, Any]) -> tuple[bytes, dict[str, Any]]:
    from .sdk.handlers.mesh import MeshHandler

    return MeshHandler().serialize(payload)


def _serialize_volume(grid: Any, spacing: Any = None, origin: Any = None) -> tuple[bytes, dict[str, Any]]:
    from .sdk.handlers.volume import VolumeHandler

    return VolumeHandler().serialize(grid, spacing=spacing, origin=origin)


def _serialize_boxes3d(payload: dict[str, Any], kind: str = "boxes") -> tuple[bytes, dict[str, Any]]:
    from .sdk.handlers.boxes3d import Boxes3DHandler

    return Boxes3DHandler().serialize(payload, kind=kind)


register_resolvers(
    table_raw=_table_json_from_raw,
    serialize_pointcloud=_serialize_pointcloud,
    serialize_mesh=_serialize_mesh,
    serialize_volume=_serialize_volume,
    serialize_boxes3d=_serialize_boxes3d,
)


# ---------------------------------------------------------------------------
# Run-integration extras — the server-backed media-compare card helpers.
#
# Each `cairn.plot.*_compare(...)` resolves `run[tag]` sources to a validated
# `CardSpec` and returns a `CardElement` (a live `/embed/card` iframe). These
# stay cairn-only (they need the server); `cp.Compare` (the pure composable) is
# re-exported above for the self-contained `mode="side"` path.
# ---------------------------------------------------------------------------

# `mode` values for the "one-pane" media-compare compositor — mirrors
# `Extract<MediaCompareModeKind, "side"|"split"|"blend"|"diff">`.
_COMPARE_MODES = ("side", "split", "blend", "diff")


def _resolve_series(data: Any, *, builder: str) -> tuple[SeriesRef, int | None]:
    """A `run[tag]` handle -> a validated `SeriesRef` (+ its optional step).

    Raw (non-`DataRef`) data has no card-spec representation today — a
    `SeriesRef` is inherently `(runId, name, context_hash)`, a pointer into
    server-tracked data, and the schema has no inline-data variant yet. This
    is the WS-INLINE inline-data render path (design spec §6.3), explicitly
    deferred: raise a clear, actionable error rather than doing something
    silently wrong.
    """
    if isinstance(data, DataRef):
        ref = SeriesRef(runId=data.run_id, name=data.tag, context_hash=data.context_hash())
        return ref, data.step
    raise NotImplementedError(
        f"cairn.plot.{builder}(...): raw array/image/bytes data has no "
        "card-spec representation yet (a card `series` entry is a pointer "
        "into server-tracked data — `(runId, name, context_hash)` — and the "
        "schema has no inline-data variant). This is the WS-INLINE "
        "inline-data render path, deferred — see "
        "docs/superpowers/specs/2026-07-07-notebook-python-and-embed.md "
        "§6.3. Track the data to a run first (`run.track(data, name=...)`) "
        "and pass `run[tag]` instead, e.g. "
        f"`cairn.plot.{builder}(run[\"{{tag}}\"])`."
    )


def _backend_of(source: Any) -> Any:
    """The `_LocalBackend`/`_HttpBackend` behind a `DataRef`'s `Run`, if any."""
    return getattr(getattr(source, "run", None), "_backend", None)


def _repo_path_of(source: Any) -> str | None:
    """Best-effort local ``.cairn`` dir behind a `DataRef`'s `Run`, or
    `None` (HTTP-backed readers, or anything unexpected).

    Threaded into `CardElement(repo_path=...)` so `_resolve_server()` can
    look up *this specific repo's* `servers.json` advertisement instead of
    only the process-global `cairn.configure`/`CAIRN_REPO` state — the
    notebook may be reading a repo that was never `configure()`-d at all.
    """
    return getattr(_backend_of(source), "repo_path", None)


def _server_url_of(source: Any) -> str | None:
    """Best-effort HTTP base behind a `DataRef`'s `Run` when its `Reader`
    was opened in server mode (``Reader(repo="cairn://host:port")``), else
    `None`.

    Threaded into `CardElement(server=...)` so a card renders against the
    SAME server the reader queried — the reader "found" the runs there, so
    the card must resolve there too, with no `cairn.configure`/`CAIRN_REPO`
    needed."""
    return getattr(_backend_of(source), "server_url", None)


def _card_element(
    card_type: str,
    sources: Sequence[Any],
    *,
    builder: str,
    mode: str | None = None,
    settings: dict[str, Any] | None = None,
) -> CardElement:
    """Build + schema-validate one `CardSpec` from `run[tag]` sources, and
    wrap it in the server-backed `CardElement` display object."""
    series: list[SeriesRef] = []
    step: int | None = None
    repo_path: str | None = None
    reader_server: str | None = None
    for source in sources:
        ref, source_step = _resolve_series(source, builder=builder)
        series.append(ref)
        if step is None and source_step is not None:
            step = source_step
        if repo_path is None:
            repo_path = _repo_path_of(source)
        if reader_server is None:
            reader_server = _server_url_of(source)

    merged_settings = dict(settings or {})
    if mode is not None:
        merged_settings["mode"] = mode
    if step is not None:
        merged_settings.setdefault("step", float(step))
    settings_obj = CardSettingsSpec(**merged_settings) if merged_settings else None

    spec = CardSpec(id=str(_uuid.uuid4()), type=card_type, series=series, settings=settings_obj)
    return CardElement(
        spec.model_dump(exclude_none=True, mode="json"),
        reader_server=reader_server,
        repo_path=repo_path,
    )


def media_compare(a: Any, b: Any, *, mode: str = "diff", card_type: str = "image") -> Any:
    """Compare two media sources as one card — the Python mirror of the TS
    media-compare compositor (`OffscreenComparePanes`/`CompareSettingsPanel`).

    Args:
        a: first `run[tag]` handle.
        b: second `run[tag]` handle.
        mode: ``"side"`` (side-by-side), ``"split"`` (image-space split),
            ``"blend"`` (alpha blend), or ``"diff"`` (pixel diff).
        card_type: which single-view card type `a`/`b` are —
            ``"image"`` (default), ``"mesh"``, ``"pointcloud"``,
            ``"volume"``, or ``"boxes3d"``.

    `compare` sugar: this just sets the card's two `series` plus
    `settings.mode`/`settings.baselineIndex`; the renderer's existing compare
    compositor does the rest — no new render path.

    `settings.baselineIndex` designates `a` (series index 0) as the
    reference the compositor diffs/splits/blends `b` against — see
    `useMediaReference`'s `seriesBaselineIndex` (card-kit/use-media-
    reference.ts) and `VisualContentCard.tsx`'s `hasBaseline`/`baselineIdx`:
    without it, every pane resolves no reference at all and every mode
    (including "diff") falls back to plain unmodified per-pane rendering
    (`side`-shaped output) — the bug this fixes. `"side"` itself never reads
    the reference, so this is a no-op for it, but is set unconditionally so
    switching modes after render (e.g. via the card's own UI) works
    immediately without a reload.
    """
    if mode not in _COMPARE_MODES:
        raise ValueError(f"mode must be one of {_COMPARE_MODES!r}, got {mode!r}")
    return _card_element(
        card_type, [a, b], builder="media_compare", mode=mode, settings={"baselineIndex": 0}
    )


def image_compare(a: Any, b: Any, *, mode: str = "side") -> Any:
    """`media_compare(a, b, mode=mode, card_type="image")`."""
    return media_compare(a, b, mode=mode, card_type="image")


def _compare_3d(component: Any, a: Any, b: Any, mode: str, card_type: str) -> Any:
    """Shared body for the four 3D ``*_compare`` helpers.

    ``mode="side"`` lowers to a self-contained ``cp.Compare(component(a),
    component(b), mode="side")`` — which itself becomes a 2-cell ``cp.Grid``,
    so both cells render as standalone 3D leaves (G3b, no server). ``mode`` in
    ``{split, blend, diff}`` (image-space compositing of two rendered frames)
    has no standalone 3D path yet (deferred G3c), so it KEEPS delegating to the
    server-backed ``media_compare`` ``CardElement`` iframe."""
    if mode == "side":
        return Compare(component(a), component(b), mode="side")._build_element()
    return media_compare(a, b, mode=mode, card_type=card_type)


def mesh_compare(a: Any, b: Any, *, mode: str = "side") -> Any:
    """Compare two meshes. ``mode="side"`` renders both as self-contained
    standalone 3D leaves (via ``cp.Compare``/``cp.Mesh``, no server);
    ``split``/``blend``/``diff`` delegate to the server-backed
    ``media_compare`` iframe (standalone 3D compositing is deferred to G3c)."""
    return _compare_3d(Mesh, a, b, mode, "mesh")


def pointcloud_compare(a: Any, b: Any, *, mode: str = "side") -> Any:
    """Compare two point clouds. ``mode="side"`` renders both as
    self-contained standalone 3D leaves (via ``cp.Compare``/``cp.PointCloud``,
    no server); ``split``/``blend``/``diff`` delegate to the server-backed
    ``media_compare`` iframe (standalone 3D compositing is deferred to G3c)."""
    return _compare_3d(PointCloud, a, b, mode, "pointcloud")


def volume_compare(a: Any, b: Any, *, mode: str = "side") -> Any:
    """Compare two volumes. ``mode="side"`` renders both as self-contained
    standalone 3D leaves (via ``cp.Compare``/``cp.Volume``, no server);
    ``split``/``blend``/``diff`` delegate to the server-backed
    ``media_compare`` iframe (standalone 3D compositing is deferred to G3c)."""
    return _compare_3d(Volume, a, b, mode, "volume")


def boxes_compare(a: Any, b: Any, *, mode: str = "side") -> Any:
    """Compare two boxes plots. ``mode="side"`` renders both as self-contained
    standalone 3D leaves (via ``cp.Compare``/``cp.Boxes``, no server);
    ``split``/``blend``/``diff`` delegate to the server-backed
    ``media_compare`` iframe (standalone 3D compositing is deferred to G3c)."""
    return _compare_3d(Boxes, a, b, mode, "boxes3d")


# The public surface = the standalone cairn_plot surface + the cairn-only
# media-compare card helpers layered on above.
__all__ = list(_cairn_plot.__all__) + [
    "media_compare",
    "image_compare",
    "mesh_compare",
    "pointcloud_compare",
    "volume_compare",
    "boxes_compare",
]
