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

import uuid as _uuid
from typing import Any, Sequence

import numpy as np

from .sdk.card_spec import CardSettingsSpec, CardSpec, SeriesRef
from .sdk.elements import CardElement, HtmlElement
from .sdk.reader import DataRef

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


def _repo_path_of(source: Any) -> str | None:
    """Best-effort local ``.cairn`` dir behind a `DataRef`'s `Run`, or
    `None` (HTTP-backed readers, or anything unexpected).

    Threaded into `CardElement(repo_path=...)` so `_resolve_server()` can
    look up *this specific repo's* `servers.json` advertisement instead of
    only the process-global `cairn.configure`/`CAIRN_REPO` state — the
    notebook may be reading a repo that was never `configure()`-d at all.
    """
    backend = getattr(getattr(source, "run", None), "_backend", None)
    return getattr(backend, "repo_path", None)


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
    for source in sources:
        ref, source_step = _resolve_series(source, builder=builder)
        series.append(ref)
        if step is None and source_step is not None:
            step = source_step
        if repo_path is None:
            repo_path = _repo_path_of(source)

    merged_settings = dict(settings or {})
    if mode is not None:
        merged_settings["mode"] = mode
    if step is not None:
        merged_settings.setdefault("step", float(step))
    settings_obj = CardSettingsSpec(**merged_settings) if merged_settings else None

    spec = CardSpec(id=str(_uuid.uuid4()), type=card_type, series=series, settings=settings_obj)
    return CardElement(spec.model_dump(exclude_none=True, mode="json"), repo_path=repo_path)


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


def scalar(data: Any) -> Any:
    """A single scalar-sequence card/element.

    Args:
        data: a `run[tag]` lazy handle (a tracked scalar sequence) -> a
            server-backed `CardElement` (type ``"scalar"``); OR raw numeric
            values (any array-like) -> a self-contained Plotly line-plot
            `HtmlElement` (no server needed), built via `line_series`.
    """
    if isinstance(data, DataRef):
        return _card_element("scalar", [data], builder="scalar")
    values = np.asarray(list(data), dtype=np.float64).ravel()
    if values.size == 0:
        raise ValueError("scalar(...) raw data must not be empty")
    fig = line_series(list(range(values.size)), [values], keys=["value"])
    return HtmlElement(fig.to_html(include_plotlyjs="inline", full_html=False), label="scalar")


def figure(data: Any) -> Any:
    """A `figure` (Plotly) card/element.

    Args:
        data: a `run[tag]` lazy handle (a tracked `figure` artifact) -> a
            server-backed `CardElement`; OR a plotly `Figure` (e.g. from
            `roc_curve`/`confusion_matrix`/... above, or hand-built) -> a
            self-contained `HtmlElement` via `fig.to_html()`.
    """
    if isinstance(data, DataRef):
        return _card_element("figure", [data], builder="figure")
    if not hasattr(data, "to_html"):
        raise TypeError(
            "cairn.plot.figure(...) expects a run[tag] handle or a plotly "
            f"Figure (an object with .to_html()); got {type(data).__name__}"
        )
    return HtmlElement(data.to_html(include_plotlyjs="inline", full_html=False), label="figure")


def table(data: Any) -> Any:
    """A `table` card/element.

    Args:
        data: a `run[tag]` lazy handle (a tracked `table` artifact) -> a
            server-backed `CardElement`; OR raw tabular data — anything with
            a `.to_html()` method (e.g. a pandas `DataFrame`, duck-typed —
            pandas is not a cairn dependency) or a list of dicts/rows -> a
            self-contained `HtmlElement`.
    """
    if isinstance(data, DataRef):
        return _card_element("table", [data], builder="table")
    if hasattr(data, "to_html"):
        return HtmlElement(data.to_html(index=False), label="table")
    return HtmlElement(_rows_to_html_table(data), label="table")


def image(data: Any) -> Any:
    """A single-view `image` card. `data` must be a `run[tag]` handle —
    raw images have no card-spec representation yet (see `_resolve_series`;
    WS-INLINE, deferred)."""
    return _card_element("image", [data], builder="image")


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
