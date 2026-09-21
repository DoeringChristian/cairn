"""cairn.ui.compare — build a cairn viewer comparison card from Python.

Each ``*_compare(...)`` resolves ``run[tag]`` sources into a schema-validated
:class:`~cairn.ui.card_spec.CardSpec` and returns a
:class:`~cairn.ui.elements.CardElement` — a live ``/embed/card`` iframe. These
render nothing themselves: the browser's card renderer does the work, which is
why they live here rather than in :mod:`cairn.plot`.

They need a reachable cairn server that is serving the viewer. Without one the
element degrades to an inline notice rather than raising.
"""

from __future__ import annotations

import json as _json
import uuid as _uuid
from typing import Any, Sequence

from cairn.sdk.reader import DataRef
from .spec import CardSettingsSpec, CardSpec, SeriesRef
from .elements import CardElement

__all__ = [
    "media_compare",
    "image_compare",
    "mesh_compare",
    "pointcloud_compare",
    "volume_compare",
    "boxes_compare",
]


# ---------------------------------------------------------------------------
# Run-integration extras — the server-backed media-compare card helpers.
#
# Each `cairn.plot.*_compare(...)` resolves `run[tag]` sources to a validated
# `CardSpec` and returns a `CardElement` (a live `/embed/card` iframe). These
# stay cairn-only (they need the server); `cp.Compare` (the pure composable) is
# re-exported above for the pure/self-contained composable path.
# ---------------------------------------------------------------------------

# `mode` values for the "one-pane" media-compare compositor these CARD helpers
# drive (`media_compare` and friends, below) — read by
# `packages/cairn-ui/src/components/card-kit/CompareSettingsPanel.tsx`.
#
# NOT the vocabulary of `cp.Compare`, the pure cairn-plot composable re-exported
# from this module: that one takes `split`/`signed`/`abs`/`square`/`rel_*`/
# `flip`/`flip_hdr`/`ssim` and validates them itself. Two different compare
# surfaces share this namespace — passing a mode from one to the other raises.
# (The previous note here cited a TypeScript `MediaCompareModeKind` type that no
# longer exists.)
_COMPARE_MODES = ("split", "blend", "diff")


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
        mode: ``"split"`` (image-space split),
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
    plain-per-pane output. `baselineIndex` is set unconditionally so switching
    modes after render (e.g. via the card's own UI) works immediately without a
    reload.
    """
    if mode not in _COMPARE_MODES:
        raise ValueError(f"mode must be one of {_COMPARE_MODES!r}, got {mode!r}")
    return _card_element(
        card_type, [a, b], builder="media_compare", mode=mode, settings={"baselineIndex": 0}
    )


def image_compare(a: Any, b: Any, *, mode: str = "split") -> Any:
    """`media_compare(a, b, mode=mode, card_type="image")`."""
    return media_compare(a, b, mode=mode, card_type="image")


def _compare_3d(a: Any, b: Any, mode: str, card_type: str) -> Any:
    """Shared body for the four 3D ``*_compare`` helpers.

    All modes (``split``/``blend``/``diff``) delegate to the server-backed
    ``media_compare`` ``CardElement`` iframe (image-space compositing of two
    rendered frames; standalone 3D compositing is deferred to G3c)."""
    return media_compare(a, b, mode=mode, card_type=card_type)


def mesh_compare(a: Any, b: Any, *, mode: str = "split") -> Any:
    """Compare two meshes via the server-backed ``media_compare`` iframe (``split``/``blend``/``diff``)."""
    return _compare_3d(a, b, mode, "mesh")


def pointcloud_compare(a: Any, b: Any, *, mode: str = "split") -> Any:
    """Compare two point clouds via the server-backed ``media_compare`` iframe (``split``/``blend``/``diff``)."""
    return _compare_3d(a, b, mode, "pointcloud")


def volume_compare(a: Any, b: Any, *, mode: str = "split") -> Any:
    """Compare two volumes via the server-backed ``media_compare`` iframe (``split``/``blend``/``diff``)."""
    return _compare_3d(a, b, mode, "volume")


def boxes_compare(a: Any, b: Any, *, mode: str = "split") -> Any:
    """Compare two boxes plots via the server-backed ``media_compare`` iframe (``split``/``blend``/``diff``)."""
    return _compare_3d(a, b, mode, "boxes3d")
