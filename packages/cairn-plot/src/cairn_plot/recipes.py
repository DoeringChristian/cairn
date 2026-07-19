"""cairn_plot.recipes — pure-numpy metric plots that return Plotly figures.

These are thin, dependency-free (besides numpy) helpers for the most common
classifier-evaluation and summary charts. They return a
``plotly.graph_objects.Figure`` you can pass straight to ``cp.figure(...)`` (or,
in cairn, ``run.track(fig, ...)``).

No ``sklearn`` dependency: metrics are computed directly from
``y_true``/``y_pred``/``y_probas`` arrays via numpy (bincount for confusion
matrices, a sorted-score threshold sweep for ROC/PR curves, trapezoidal
integration for AUC/AP).

Plotly itself is optional (the ``media`` extra) — the import is deferred to
inside each function so ``import cairn_plot`` keeps working without it
installed. Calling any function without plotly raises a clear ``ImportError``.

Numeric edge cases (covered by ``tests/unit/test_plot_helpers.py``):

- Empty input arrays raise ``ValueError`` — there is no meaningful figure to
  draw.
- A class with zero positive examples (ROC/PR) or an all-zero row/column
  under normalization (confusion matrix) plots as ``NaN``/"n/a" rather than
  raising.
- ``y_probas`` must not contain NaN scores — these would make the score sort
  order ambiguous, so it is a ``ValueError``.
"""

from __future__ import annotations

from typing import Any, Sequence

import numpy as np

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
