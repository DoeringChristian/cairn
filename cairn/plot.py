"""cairn.plot — pure-numpy metric plots that return Plotly figures.

These are thin, dependency-free (besides numpy, which is a core cairn
dependency) helpers for the most common classifier-evaluation and summary
charts. They return a ``plotly.graph_objects.Figure`` you pass straight to
``run.track(fig, name=..., step=...)``; the existing ``figure`` handler
(``cairn/sdk/handlers/figure.py``) takes it from there (rasterizes a PNG for
thumbnails, stores the interactive Plotly JSON as source).

No ``sklearn`` dependency: metrics are computed directly from
``y_true``/``y_pred``/``y_probas`` arrays via numpy (bincount for confusion
matrices, a sorted-score threshold sweep for ROC/PR curves, trapezoidal
integration for AUC/AP).

Plotly itself is optional at the package level (the ``media`` extra) — the
import is deferred to inside each function so ``import cairn`` keeps working
without it installed. Calling any function without plotly raises a clear
``ImportError``.

Numeric edge cases (documented per-function below, and covered by
``tests/unit/test_plot_helpers.py``):

- Empty input arrays raise ``ValueError`` — there is no meaningful figure to
  draw.
- A class with zero positive examples (ROC/PR) or an all-zero row/column
  under normalization (confusion matrix) plots as ``NaN``/"n/a" rather than
  raising — cairn logs frequently sweep over training, and a batch with no
  examples of a rare class is a normal transient, not a fatal error.
- ``y_probas`` must not contain NaN scores — these would make the score sort
  order ambiguous, so it is a ``ValueError`` rather than a silent NaN
  propagation.

WS-PYAPI (below, `Element builders`_) extends this module — the Python
mirror of the TS ``cairn-plot`` element set — with builders
(``scalar``/``image``/``mesh``/``pointcloud``/``volume``/``boxes``/``table``/
``figure``/``media_compare``/...) that take DATA (a lazy ``run[tag]`` handle,
see ``cairn/sdk/reader.py``'s ``DataRef``, or raw data for the trivial
self-contained cases) and return a display-protocol ``Element``
(``cairn/sdk/elements.py``) rather than a raw dict — see
``docs/superpowers/specs/2026-07-07-notebook-python-and-embed.md`` §11.
"""

from __future__ import annotations

import base64 as _base64
import hashlib as _hashlib
import json as _json
import uuid as _uuid
from typing import Any, Sequence

import numpy as np

from .sdk.card_spec import (
    CardSettingsSpec,
    CardSpec,
    ImageDataSpec,
    InlineDataSpec,
    PlotSpec,
    SeriesRef,
)
from .sdk.elements import CardElement, HtmlElement, PlotElement
from .sdk.plot_components import (
    Bar,
    Compare,
    Component,
    Figure,
    Grid,
    Heatmap,
    Histogram,
    Image,
    Line,
    ParallelCoordinates,
    Scalar,
    Scatter,
    Shared,
    Table,
)
from .sdk.reader import ArtifactInfo, DataRef

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

# numpy >=2.0 renamed trapz -> trapezoid (trapz was removed outright in some
# 2.x releases); numpy <2.0 (the package's floor is 1.24) only has trapz.
_trapz = getattr(np, "trapezoid", None) or np.trapz


def _require_plotly() -> Any:
    try:
        import plotly.graph_objects as go
    except ImportError as exc:  # pragma: no cover - exercised via mark.media skip
        raise ImportError(
            "cairn.plot requires plotly. Install it with `pip install "
            "cairn-track[media]`."
        ) from exc
    return go


# ---------------------------------------------------------------------------
# confusion_matrix
# ---------------------------------------------------------------------------


def confusion_matrix(
    y_true: Sequence[int],
    y_pred: Sequence[int],
    class_names: Sequence[str] | None = None,
    normalize: str | None = None,
) -> Any:
    """Annotated confusion-matrix heatmap.

    Args:
        y_true: integer class labels, shape ``(n_samples,)``.
        y_pred: predicted integer class labels, same shape as ``y_true``.
        class_names: optional display names, indexed by class id
            (``class_names[i]`` labels class ``i``). Defaults to
            ``str(i)``. Must cover every class id observed in ``y_true``/
            ``y_pred`` if given.
        normalize: ``None`` (raw counts), ``"true"`` (rows sum to 1 —
            per-true-class recall breakdown) or ``"pred"`` (columns sum to
            1 — per-predicted-class precision breakdown).

    Edge cases:
        - A row/column with a zero sum under normalization (a class that
          never occurs as true/predicted) renders as ``NaN`` ("n/a" in the
          cell text) rather than dividing by zero.
        - A single class (``n_classes == 1``) produces a trivial 1x1 matrix.

    Returns:
        A ``plotly.graph_objects.Figure`` with one annotated ``Heatmap``
        trace, true label on the y-axis (top-to-bottom, matching the usual
        confusion-matrix convention) and predicted label on the x-axis.
    """
    go = _require_plotly()

    if normalize not in (None, "true", "pred"):
        raise ValueError('normalize must be one of None, "true", "pred"')

    y_true_arr = np.asarray(y_true).astype(np.int64).ravel()
    y_pred_arr = np.asarray(y_pred).astype(np.int64).ravel()
    if y_true_arr.shape != y_pred_arr.shape:
        raise ValueError("y_true and y_pred must have the same shape")
    if y_true_arr.size == 0:
        raise ValueError("y_true/y_pred must not be empty")
    if y_true_arr.min() < 0 or y_pred_arr.min() < 0:
        raise ValueError("y_true/y_pred must contain non-negative class indices")

    n_classes = int(max(y_true_arr.max(), y_pred_arr.max())) + 1
    if class_names is not None:
        if len(class_names) < n_classes:
            raise ValueError(
                "class_names is shorter than the number of classes observed "
                f"in the data ({len(class_names)} < {n_classes})"
            )
        n_classes = len(class_names)
        labels = list(class_names)
    else:
        labels = [str(i) for i in range(n_classes)]

    flat_idx = y_true_arr * n_classes + y_pred_arr
    counts = np.bincount(flat_idx, minlength=n_classes * n_classes)
    cm = counts.reshape(n_classes, n_classes).astype(np.float64)

    if normalize == "true":
        denom = cm.sum(axis=1, keepdims=True)
        with np.errstate(invalid="ignore", divide="ignore"):
            z = np.where(denom > 0, cm / denom, np.nan)
    elif normalize == "pred":
        denom = cm.sum(axis=0, keepdims=True)
        with np.errstate(invalid="ignore", divide="ignore"):
            z = np.where(denom > 0, cm / denom, np.nan)
    else:
        z = cm

    text = np.empty(z.shape, dtype=object)
    for i in range(n_classes):
        for j in range(n_classes):
            if normalize is None:
                text[i, j] = f"{int(cm[i, j])}"
            elif np.isnan(z[i, j]):
                text[i, j] = "n/a"
            else:
                text[i, j] = f"{z[i, j]:.2f}"

    finite = z[np.isfinite(z)]
    zmax = float(finite.max()) if finite.size and finite.max() > 0 else 1.0

    fig = go.Figure(
        data=go.Heatmap(
            z=z,
            x=labels,
            y=labels,
            colorscale="Blues",
            zmin=0,
            zmax=zmax,
            text=text,
            texttemplate="%{text}",
            hovertemplate="true=%{y}<br>pred=%{x}<br>value=%{z}<extra></extra>",
            colorbar=dict(title="count" if normalize is None else "fraction"),
        )
    )
    title = "Confusion Matrix" + (f" (normalized: {normalize})" if normalize else "")
    fig.update_layout(
        title=title,
        xaxis_title="Predicted label",
        yaxis_title="True label",
        yaxis=dict(autorange="reversed"),
    )
    return fig


# ---------------------------------------------------------------------------
# ROC / PR shared machinery
# ---------------------------------------------------------------------------


def _binary_clf_curve(
    y_true: np.ndarray, y_score: np.ndarray
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Cumulative (fps, tps, thresholds) over distinct scores, descending.

    Scans samples from highest to lowest score; tied scores are collapsed
    into a single threshold (the last sample of each tie group keeps the
    group's cumulative counts) so a plateau of identical scores contributes
    exactly one point to the curve rather than one per sample.
    """
    y_true = np.asarray(y_true, dtype=np.float64).ravel()
    y_score = np.asarray(y_score, dtype=np.float64).ravel()

    order = np.argsort(-y_score, kind="stable")
    y_score = y_score[order]
    y_true = y_true[order]

    distinct_idx = np.where(np.diff(y_score))[0]
    threshold_idxs = np.r_[distinct_idx, y_true.size - 1]

    tps = np.cumsum(y_true)[threshold_idxs]
    fps = 1 + threshold_idxs - tps
    thresholds = y_score[threshold_idxs]
    return fps, tps, thresholds


def _auc(x: np.ndarray, y: np.ndarray) -> float:
    """Trapezoidal AUC. Assumes ``x`` is already sorted ascending."""
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    if x.size == 0 or np.any(np.isnan(x)) or np.any(np.isnan(y)):
        return float("nan")
    return float(_trapz(y, x))


def _normalize_proba_input(
    y_true: Sequence[int], y_probas: Sequence[Sequence[float]] | Sequence[float]
) -> tuple[np.ndarray, np.ndarray]:
    y_true_arr = np.asarray(y_true).ravel()
    probas_arr = np.asarray(y_probas, dtype=np.float64)
    if probas_arr.ndim == 1:
        # Binary convenience: a single positive-class score column.
        probas_arr = np.stack([1.0 - probas_arr, probas_arr], axis=1)
    elif probas_arr.ndim != 2:
        raise ValueError(
            "y_probas must be 1-D (binary positive-class score) or 2-D "
            "(n_samples, n_classes)"
        )
    if y_true_arr.size == 0 or probas_arr.size == 0:
        raise ValueError("y_true/y_probas must not be empty")
    if probas_arr.shape[0] != y_true_arr.shape[0]:
        raise ValueError("y_true and y_probas must have the same number of samples")
    if np.isnan(probas_arr).any():
        raise ValueError("y_probas must not contain NaN values")

    n_classes = probas_arr.shape[1]
    if y_true_arr.min() < 0 or y_true_arr.max() >= n_classes:
        raise ValueError(
            f"y_true contains class indices outside [0, {n_classes}) implied "
            "by the number of columns in y_probas"
        )
    return y_true_arr, probas_arr


def _classes_to_iterate(
    n_classes: int, classes_to_plot: Sequence[int] | None
) -> list[int]:
    if classes_to_plot is not None:
        classes = [c for c in classes_to_plot if 0 <= c < n_classes]
    else:
        classes = list(range(n_classes))
    if not classes:
        raise ValueError("no classes to plot (classes_to_plot filtered out every class)")
    return classes


def _class_label(labels: Sequence[str] | None, c: int) -> str:
    if labels is not None and c < len(labels):
        return str(labels[c])
    return str(c)


# ---------------------------------------------------------------------------
# pr_curve
# ---------------------------------------------------------------------------


def pr_curve(
    y_true: Sequence[int],
    y_probas: Sequence[Sequence[float]] | Sequence[float],
    labels: Sequence[str] | None = None,
    classes_to_plot: Sequence[int] | None = None,
) -> Any:
    """Precision-recall curve(s), binary or one-vs-rest multiclass.

    Args:
        y_true: integer class labels, shape ``(n_samples,)``, values in
            ``[0, n_classes)``.
        y_probas: predicted scores, shape ``(n_samples, n_classes)``
            (e.g. softmax output). A 1-D array of shape ``(n_samples,)`` is
            also accepted for binary classification and is treated as the
            positive- (class 1) score; the complementary column is derived
            as ``1 - score``.
        labels: optional display names indexed by class id.
        classes_to_plot: optional subset of class ids to draw (default:
            every class implied by ``y_probas``'s column count).

    Each class is scored one-vs-rest. The plotted precision is the
    **interpolated envelope** (the common PASCAL-VOC/W&B convention):
    ``p_interp(r) = max(p(r') for r' >= r)``, i.e. precision is replaced by
    the best precision achievable at that recall or higher, giving a
    monotonically non-increasing curve. Average precision (AP, trapezoidal
    integral of the interpolated curve over recall) is included in each
    trace's legend name.

    Edge cases:
        - A class with zero positive examples in ``y_true`` has undefined
          precision/recall: the trace is all-``NaN`` and its legend shows
          ``AP=n/a`` (still added to the legend, not dropped, so per-step
          class dropout in a training loop doesn't shrink the legend).

    Returns:
        A ``plotly.graph_objects.Figure`` with one ``Scatter`` line trace
        per plotted class.
    """
    go = _require_plotly()
    y_true_arr, probas_arr = _normalize_proba_input(y_true, y_probas)
    n_classes = probas_arr.shape[1]
    classes = _classes_to_iterate(n_classes, classes_to_plot)

    fig = go.Figure()
    for c in classes:
        name = _class_label(labels, c)
        y_bin = (y_true_arr == c).astype(np.float64)
        fps, tps, _ = _binary_clf_curve(y_bin, probas_arr[:, c])
        n_pos = tps[-1] if tps.size else 0.0

        if n_pos == 0:
            recall = np.full(tps.size + 1, np.nan)
            precision_interp = np.full(tps.size + 1, np.nan)
            ap = float("nan")
        else:
            recall = tps / n_pos
            denom = tps + fps
            precision = np.divide(
                tps, denom, out=np.zeros_like(tps, dtype=np.float64), where=denom > 0
            )
            # Prepend the threshold=+inf point (nothing predicted positive).
            recall = np.r_[0.0, recall]
            precision = np.r_[1.0, precision]
            precision_interp = np.maximum.accumulate(precision[::-1])[::-1]
            ap = _auc(recall, precision_interp)

        ap_label = f"{ap:.3f}" if not np.isnan(ap) else "n/a"
        fig.add_trace(
            go.Scatter(
                x=recall,
                y=precision_interp,
                mode="lines",
                name=f"{name} (AP={ap_label})",
                hovertemplate="recall=%{x:.3f}<br>precision=%{y:.3f}<extra>%{fullData.name}</extra>",
            )
        )

    fig.update_layout(
        title="Precision-Recall Curve",
        xaxis_title="Recall",
        yaxis_title="Precision",
        xaxis=dict(range=[0, 1]),
        yaxis=dict(range=[0, 1.05]),
        legend_title="Class",
    )
    return fig


# ---------------------------------------------------------------------------
# roc_curve
# ---------------------------------------------------------------------------


def roc_curve(
    y_true: Sequence[int],
    y_probas: Sequence[Sequence[float]] | Sequence[float],
    labels: Sequence[str] | None = None,
    classes_to_plot: Sequence[int] | None = None,
) -> Any:
    """ROC curve(s), binary or one-vs-rest multiclass, with AUC per trace.

    Args:
        y_true: integer class labels, shape ``(n_samples,)``, values in
            ``[0, n_classes)``.
        y_probas: predicted scores, shape ``(n_samples, n_classes)``. A 1-D
            array is accepted for binary classification (see
            :func:`pr_curve`).
        labels: optional display names indexed by class id.
        classes_to_plot: optional subset of class ids to draw.

    AUC is computed by the trapezoid rule over the (FPR, TPR) points and
    shown in each trace's legend name.

    Edge cases:
        - A class with zero positive examples has undefined TPR (all-NaN)
          and AUC ``n/a``; zero negative examples analogously leaves FPR
          all-NaN. Both are plotted (as a gap in the line) rather than
          dropped, so a per-step legend stays stable across a training run
          even when a class briefly has no examples.

    Returns:
        A ``plotly.graph_objects.Figure`` with one ``Scatter`` line trace
        per plotted class plus a dashed diagonal "chance" reference line.
    """
    go = _require_plotly()
    y_true_arr, probas_arr = _normalize_proba_input(y_true, y_probas)
    n_classes = probas_arr.shape[1]
    classes = _classes_to_iterate(n_classes, classes_to_plot)

    fig = go.Figure()
    for c in classes:
        name = _class_label(labels, c)
        y_bin = (y_true_arr == c).astype(np.float64)
        fps, tps, _ = _binary_clf_curve(y_bin, probas_arr[:, c])
        n_pos = tps[-1] if tps.size else 0.0
        n_neg = fps[-1] if fps.size else 0.0

        tpr = np.full(tps.size, np.nan) if n_pos == 0 else tps / n_pos
        fpr = np.full(fps.size, np.nan) if n_neg == 0 else fps / n_neg
        # Prepend the threshold=+inf origin point.
        tpr = np.r_[0.0, tpr]
        fpr = np.r_[0.0, fpr]

        auc = _auc(fpr, tpr)
        auc_label = f"{auc:.3f}" if not np.isnan(auc) else "n/a"
        fig.add_trace(
            go.Scatter(
                x=fpr,
                y=tpr,
                mode="lines",
                name=f"{name} (AUC={auc_label})",
                hovertemplate="fpr=%{x:.3f}<br>tpr=%{y:.3f}<extra>%{fullData.name}</extra>",
            )
        )

    fig.add_trace(
        go.Scatter(
            x=[0, 1],
            y=[0, 1],
            mode="lines",
            name="chance",
            line=dict(dash="dash", color="gray"),
            hoverinfo="skip",
        )
    )
    fig.update_layout(
        title="ROC Curve",
        xaxis_title="False Positive Rate",
        yaxis_title="True Positive Rate",
        xaxis=dict(range=[0, 1]),
        yaxis=dict(range=[0, 1.02]),
        legend_title="Class",
    )
    return fig


# ---------------------------------------------------------------------------
# Thin conveniences
# ---------------------------------------------------------------------------


def bar(
    labels: Sequence[str], values: Sequence[float], title: str | None = None
) -> Any:
    """Simple bar chart.

    Args:
        labels: category labels, one per bar.
        values: bar heights, same length as ``labels``.
        title: optional figure title.
    """
    go = _require_plotly()
    labels_list = list(labels)
    values_arr = np.asarray(values, dtype=np.float64)
    if len(labels_list) != values_arr.shape[0]:
        raise ValueError("labels and values must have the same length")
    if values_arr.size == 0:
        raise ValueError("labels/values must not be empty")

    fig = go.Figure(data=go.Bar(x=labels_list, y=values_arr))
    fig.update_layout(title=title, yaxis_title="value")
    return fig


def line_series(
    xs: Sequence[float] | Sequence[Sequence[float]],
    ys: Sequence[Sequence[float]],
    keys: Sequence[str] | None = None,
    title: str | None = None,
) -> Any:
    """Multi-line chart.

    Args:
        xs: either a single sequence shared by every series in ``ys``, or a
            sequence of sequences with one x-array per series (same length
            as ``ys``).
        ys: one sequence of y-values per series, shape
            ``(n_series, n_points)`` (points per series may differ when
            ``xs`` is also given per-series).
        keys: optional series names, one per entry in ``ys``. Defaults to
            ``series_0``, ``series_1``, ...
        title: optional figure title.
    """
    go = _require_plotly()
    ys_list = list(ys)
    n_series = len(ys_list)
    if n_series == 0:
        raise ValueError("ys must contain at least one series")
    if keys is not None and len(keys) != n_series:
        raise ValueError("keys must have the same length as ys")

    xs_list_raw = list(xs)
    per_series_x = bool(xs_list_raw) and isinstance(
        xs_list_raw[0], (list, tuple, np.ndarray)
    )
    if per_series_x:
        if len(xs_list_raw) != n_series:
            raise ValueError(
                "xs must be a single shared sequence or one sequence per "
                "series in ys"
            )
        xs_per_series = xs_list_raw
    else:
        xs_per_series = [xs_list_raw] * n_series

    fig = go.Figure()
    for i, y in enumerate(ys_list):
        name = str(keys[i]) if keys is not None else f"series_{i}"
        fig.add_trace(go.Scatter(x=xs_per_series[i], y=list(y), mode="lines", name=name))
    fig.update_layout(title=title, xaxis_title="x", yaxis_title="y", legend_title="series")
    return fig


# ---------------------------------------------------------------------------
# Element builders (WS-PYAPI, design spec §11) — the Python mirror of the TS
# `cairn-plot` element set. Each builder takes DATA (a lazy `run[tag]`
# handle — see `cairn/sdk/reader.py`'s `DataRef` — or raw data for the
# trivial self-contained cases) and returns a display-protocol `Element`
# (`cairn/sdk/elements.py`), never a raw dict. `cardFromSpec` (TS) stays the
# only interpreter of the card spec these builders build and validate
# against `cairn/sdk/card_spec.py`.
# ---------------------------------------------------------------------------

# `mode` values for the "one-pane" media-compare compositor — mirrors
# `Extract<MediaCompareModeKind, "side"|"split"|"blend"|"diff">`
# (`cairn/ui/src/components/card-kit/OffscreenComparePanes.tsx`).
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


# ---------------------------------------------------------------------------
# WS-PLOT (Phase C): LOCAL/ENDPOINT data-shaping → `PlotElement`.
#
# Each `cairn.plot.X(data, *, data_mode=...)` builder resolves DATA to the
# renderer's data-contract shape (design spec §1) and returns a `PlotElement`
# that mounts the PURE cairn-plot renderer — LOCAL (default) bakes the data
# self-contained; ENDPOINT links the renderer JS to a reachable server and, for
# `image`, fetches bytes by reference. `data_mode` is DISTINCT from
# `media_compare`'s `mode=` (the compare mode) by design.
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


def _plot_element_inline(
    renderer: str,
    inline_props: dict[str, Any],
    *,
    data_mode: str,
    source: Any = None,
    label: str,
    height: int | None = None,
) -> PlotElement:
    """Wrap already-shaped 2D JSON (`inline_props`) in a `PlotElement`.

    LOCAL bakes it self-contained (inline bundle). ENDPOINT links the renderer
    JS to the source server but still carries the resolved JSON inline — the
    plot bootstrap has no by-reference 2D-sequence fetch path yet, so ENDPOINT
    for 2D types links only the renderer, not the data (documented thinness)."""
    if data_mode == "endpoint":
        server = _endpoint_server_of(source)
        spec = PlotSpec(
            renderer=renderer,
            data=InlineDataSpec(kind="inline", props=inline_props),
            mode="endpoint",
            endpoint=server,
        )
        return PlotElement(spec, bundle="link", server=server, label=label, height=height)
    spec = PlotSpec(
        renderer=renderer,
        data=InlineDataSpec(kind="inline", props=inline_props),
        mode="local",
    )
    return PlotElement(spec, bundle="inline", label=label, height=height)


# ---- scalar ---------------------------------------------------------------


def _scalar_series_from_ref(ref: DataRef) -> dict[str, Any]:
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


def _figure_json_from_ref(ref: DataRef) -> dict[str, Any]:
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


def _table_json_from_ref(ref: DataRef) -> dict[str, Any]:
    """A `run[tag]` table artifact → `{columns,data,truncated?}` (the exact
    `handlers/table.py` blob format the Table renderer consumes)."""
    tbl = ref.run.artifact(ref.tag, step=ref.step)
    if not isinstance(tbl, dict) or "columns" not in tbl:
        raise ValueError(
            f"table artifact {ref.tag!r} did not deserialize to a "
            "{columns,data} table blob."
        )
    return tbl


def _table_json_from_raw(data: Any) -> dict[str, Any]:
    """Raw tabular data → the canonical table blob, via the same
    `TableHandler` the tracking path uses (columns/type inference identical)."""
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


# ---- image ----------------------------------------------------------------


def _artifact_info_of(ref: DataRef) -> ArtifactInfo:
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


def _image_element(
    data: Any, *, data_mode: str, label: str
) -> PlotElement:
    """Shape a single-view image → an `image` `PlotElement`.

    LOCAL bakes the PNG/JPEG bytes into the content-addressed store keyed by
    hash + carries overlay metadata inline. ENDPOINT emits an image `DataSpec`
    by reference (the bootstrap fetches `${endpoint}/api/artifacts/${hash}`)."""
    if isinstance(data, DataRef):
        ai = _artifact_info_of(data)
        hash_ = ai.hash
        mime = ai.mime_type or "image/png"
        meta_str = ai.metadata if isinstance(ai.metadata, str) else (
            _json.dumps(ai.metadata) if ai.metadata else None
        )
        if data_mode == "endpoint":
            server = _endpoint_server_of(data)
            spec = PlotSpec(
                renderer="image",
                data=ImageDataSpec(kind="image", hash=hash_, metadata=meta_str),
                mode="endpoint",
                endpoint=server,
            )
            return PlotElement(spec, bundle="link", server=server, label=label)
        raw = data.run.artifact_bytes(data.tag, step=data.step)
        store = {hash_: {"mime": mime, "b64": _base64.b64encode(raw).decode("ascii")}}
        spec = PlotSpec(
            renderer="image",
            data=ImageDataSpec(kind="image", hash=hash_, metadata=meta_str),
            mode="local",
        )
        return PlotElement(spec, store=store, bundle="inline", label=label)

    # Raw image (PIL/ndarray/bytes) — LOCAL only (no server reference; C4).
    if data_mode == "endpoint":
        raise ValueError(
            "cairn.plot.image(raw, data_mode='endpoint') is unsupported: raw "
            "images have no server reference. Use data_mode='local' (bakes "
            "the bytes self-contained)."
        )
    raw, mime = _encode_image_raw(data)
    hash_ = _content_hash(raw)
    store = {hash_: {"mime": mime, "b64": _base64.b64encode(raw).decode("ascii")}}
    spec = PlotSpec(
        renderer="image",
        data=ImageDataSpec(kind="image", hash=hash_, metadata=None),
        mode="local",
    )
    return PlotElement(spec, store=store, bundle="inline", label=label)


def _rows_to_html_table(rows: Any) -> str:
    """Minimal, dependency-free HTML table for the `table()` raw fallback."""
    import html as _html_mod

    rows = list(rows)
    if not rows:
        return "<table></table>"
    first = rows[0]
    if isinstance(first, dict):
        columns = list(first.keys())
        records = rows
    else:
        columns = [f"col_{i}" for i in range(len(first))]
        records = [dict(zip(columns, r)) for r in rows]
    head = "".join(f"<th>{_html_mod.escape(str(c))}</th>" for c in columns)
    body = "".join(
        "<tr>" + "".join(f"<td>{_html_mod.escape(str(rec.get(c, '')))}</td>" for c in columns) + "</tr>"
        for rec in records
    )
    return f"<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>"


def scalar(data: Any, *, data_mode: str = "local") -> Any:
    """A single scalar-sequence plot — mounts the pure `ScalarPlot` renderer.

    Args:
        data: a `run[tag]` lazy handle (a tracked scalar sequence), OR raw
            numeric values (any array-like) plotted against their index.
        data_mode: ``"local"`` (default) bakes the resolved series into a
            self-contained, offline `PlotElement`; ``"endpoint"`` links the
            renderer JS to the source server (the data is still resolved+baked
            — the bootstrap has no by-ref 2D fetch yet). Distinct from
            `media_compare`'s `mode=` (the compare mode).

    Returns a `PlotElement` (design spec §6).
    """
    return Scalar(data, data_mode=data_mode)._build_element()


def line(
    y: Any, x: Any = None, *, label: str | None = None, data_mode: str = "local"
) -> Any:
    """A line chart — the lowercase builder for :class:`Line` (returns a
    `PlotElement`). Raw-primary: ``line(y)`` / ``line(y, x)`` /
    ``line({"a": ya, "b": yb})``, or ``line(run["loss"])``.

    NOTE (case-sensitive coexistence): this is DISTINCT from ``line_series``
    below, which returns a plotly ``go.Figure``; ``cp.line`` mounts the native
    ``scalar`` renderer self-contained. ``cp.Line`` (capitalized) is the
    composable that this wraps.
    """
    return Line(y, x=x, label=label, data_mode=data_mode)._build_element()


def figure(data: Any, *, data_mode: str = "local") -> Any:
    """A `figure` (Plotly) plot — mounts the pure `Figure` renderer.

    Args:
        data: a `run[tag]` lazy handle (a tracked `figure` artifact, whose
            interactive Plotly source is fetched), OR a plotly `Figure` (e.g.
            from `roc_curve`/`confusion_matrix`/… above, or hand-built).
        data_mode: see :func:`scalar`.

    Returns a `PlotElement`.
    """
    return Figure(data, data_mode=data_mode)._build_element()


def table(data: Any, *, data_mode: str = "local") -> Any:
    """A `table` plot — mounts the pure `Table` renderer.

    Args:
        data: a `run[tag]` lazy handle (a tracked `table` artifact), OR raw
            tabular data (a pandas `DataFrame` — duck-typed, pandas is not a
            cairn dependency; a list of row-dicts; or a list of rows).
        data_mode: see :func:`scalar`.

    Returns a `PlotElement`.
    """
    return Table(data, data_mode=data_mode)._build_element()


def image(data: Any, *, data_mode: str = "local") -> Any:
    """A single-view `image` plot — mounts the pure `ImagePane` renderer.

    Args:
        data: a `run[tag]` lazy handle (a tracked `image` artifact, bytes +
            overlay metadata), OR a raw image (`PIL.Image`, a numpy array, or
            PNG/JPEG `bytes`) — baked self-contained (LOCAL only; C4).
        data_mode: ``"local"`` (default) bakes the image bytes into the
            content-addressed store; ``"endpoint"`` emits an image `DataSpec`
            by reference (the bootstrap fetches from the server). Raw images
            support only ``"local"``.

    Returns a `PlotElement`.
    """
    return Image(data, data_mode=data_mode)._build_element()


def mesh(data: Any) -> Any:
    """A single-view `mesh` card. `data` must be a `run[tag]` handle."""
    return _card_element("mesh", [data], builder="mesh")


def pointcloud(data: Any) -> Any:
    """A single-view `pointcloud` card. `data` must be a `run[tag]` handle."""
    return _card_element("pointcloud", [data], builder="pointcloud")


def volume(data: Any) -> Any:
    """A single-view `volume` card. `data` must be a `run[tag]` handle."""
    return _card_element("volume", [data], builder="volume")


def boxes(data: Any) -> Any:
    """A single-view `boxes3d` card. `data` must be a `run[tag]` handle."""
    return _card_element("boxes3d", [data], builder="boxes")


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


def mesh_compare(a: Any, b: Any, *, mode: str = "side") -> Any:
    """`media_compare(a, b, mode=mode, card_type="mesh")`."""
    return media_compare(a, b, mode=mode, card_type="mesh")


def pointcloud_compare(a: Any, b: Any, *, mode: str = "side") -> Any:
    """`media_compare(a, b, mode=mode, card_type="pointcloud")`."""
    return media_compare(a, b, mode=mode, card_type="pointcloud")


def volume_compare(a: Any, b: Any, *, mode: str = "side") -> Any:
    """`media_compare(a, b, mode=mode, card_type="volume")`."""
    return media_compare(a, b, mode=mode, card_type="volume")


def boxes_compare(a: Any, b: Any, *, mode: str = "side") -> Any:
    """`media_compare(a, b, mode=mode, card_type="boxes3d")`."""
    return media_compare(a, b, mode=mode, card_type="boxes3d")


# ---------------------------------------------------------------------------
# Public surface. The capitalized names are the G2 composable Plotly-shaped
# leaves/containers (``cp.Line(...)`` etc.); the lowercase ``scalar/line/
# image/figure/table`` return a ``PlotElement`` directly; ``bar``/``line_series``
# /``roc_curve``/... are the pure-numpy plotly-recipe helpers (return a
# ``go.Figure``) — these coexist case-sensitively (``cp.Bar`` != ``cp.bar``).
# ---------------------------------------------------------------------------

__all__ = [
    # G2 composable leaves + containers.
    "Line",
    "Scatter",
    "Bar",
    "Histogram",
    "Heatmap",
    "ParallelCoordinates",
    "Image",
    "Table",
    "Figure",
    "Compare",
    "Grid",
    "Shared",
    "Component",
    "Scalar",  # deprecated alias == Line
    # Lowercase builders (return a PlotElement).
    "scalar",
    "line",
    "image",
    "figure",
    "table",
    "mesh",
    "pointcloud",
    "volume",
    "boxes",
    "media_compare",
    "image_compare",
    "mesh_compare",
    "pointcloud_compare",
    "volume_compare",
    "boxes_compare",
    # Pure-numpy plotly-recipe helpers (return a go.Figure).
    "confusion_matrix",
    "roc_curve",
    "pr_curve",
    "bar",
    "line_series",
]
