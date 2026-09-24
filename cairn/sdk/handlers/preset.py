"""Preset handler — classifier-evaluation charts stored as data, drawn by the UI.

Dispatches only via the ``cairn.ConfusionMatrix`` / ``cairn.PRCurve`` /
``cairn.ROCCurve`` wrappers. The blob is JSON ``{"kind", "data"}``:

* ``confusion_matrix`` — ``{"labels": [str], "counts": [[int]]}``, true label
  per row, predicted label per column.
* ``pr_curve`` / ``roc_curve`` — ``{"curves": [{"label", "x", "y", "auc"}]}``,
  one curve per class (one-vs-rest). PR: ``x`` = recall, ``y`` = interpolated
  precision, ``auc`` = average precision. ROC: ``x`` = FPR, ``y`` = TPR.
  ``auc`` is ``null`` (and the points too) for a class with no positives
  (ROC: or no negatives). Curves keep at most ``MAX_CURVE_POINTS`` points;
  the AUC is computed before downsampling.

The math is numpy only (no sklearn), ported from cairn-plot's recipes.
"""

from __future__ import annotations

import json
import math
from typing import Any, Sequence

import numpy as np

MAX_CURVE_POINTS = 500

# numpy >= 2.0 renamed trapz -> trapezoid.
_trapz = getattr(np, "trapezoid", None) or np.trapz


def confusion_counts(
    y_true: Any, y_pred: Any, class_names: Sequence[str] | None = None,
) -> dict[str, Any]:
    """Confusion counts, ``counts[true][pred]``."""
    t = np.asarray(y_true).astype(np.int64).ravel()
    p = np.asarray(y_pred).astype(np.int64).ravel()
    if t.shape != p.shape:
        raise ValueError("y_true and y_pred must have the same shape")
    if t.size == 0:
        raise ValueError("y_true/y_pred must not be empty")
    if t.min() < 0 or p.min() < 0:
        raise ValueError("y_true/y_pred must contain non-negative class indices")
    n = int(max(t.max(), p.max())) + 1
    if class_names is not None:
        if len(class_names) < n:
            raise ValueError(
                "class_names is shorter than the number of classes observed "
                f"in the data ({len(class_names)} < {n})"
            )
        n = len(class_names)
        labels = [str(c) for c in class_names]
    else:
        labels = [str(i) for i in range(n)]
    counts = np.bincount(t * n + p, minlength=n * n).reshape(n, n)
    return {"labels": labels, "counts": counts.tolist()}


def _binary_clf_curve(y_true: np.ndarray, y_score: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Cumulative (fps, tps) over distinct scores, descending; ties collapse to one point."""
    y_true = np.asarray(y_true, dtype=np.float64).ravel()
    y_score = np.asarray(y_score, dtype=np.float64).ravel()
    order = np.argsort(-y_score, kind="stable")
    y_score = y_score[order]
    y_true = y_true[order]
    distinct = np.where(np.diff(y_score))[0]
    idx = np.r_[distinct, y_true.size - 1]
    tps = np.cumsum(y_true)[idx]
    fps = 1 + idx - tps
    return fps, tps


def _auc(x: np.ndarray, y: np.ndarray) -> float | None:
    if x.size == 0 or np.isnan(x).any() or np.isnan(y).any():
        return None
    return float(_trapz(y, x))


def _scores(y_true: Any, y_score: Any) -> tuple[np.ndarray, np.ndarray]:
    """``(labels, scores[n_samples, n_classes])``; a 1-D score is the positive class of a binary problem."""
    t = np.asarray(y_true).ravel()
    s = np.asarray(y_score, dtype=np.float64)
    if s.ndim == 1:
        s = np.stack([1.0 - s, s], axis=1)
    elif s.ndim != 2:
        raise ValueError("y_score must be 1-D (binary positive-class score) or 2-D (n_samples, n_classes)")
    if t.size == 0 or s.size == 0:
        raise ValueError("y_true/y_score must not be empty")
    if s.shape[0] != t.shape[0]:
        raise ValueError("y_true and y_score must have the same number of samples")
    if np.isnan(s).any():
        raise ValueError("y_score must not contain NaN values")
    if t.min() < 0 or t.max() >= s.shape[1]:
        raise ValueError(
            f"y_true contains class indices outside [0, {s.shape[1]}) implied by y_score's columns"
        )
    return t, s


def _label(labels: Sequence[str] | None, c: int) -> str:
    return str(labels[c]) if labels is not None and c < len(labels) else str(c)


def _downsample(x: np.ndarray, y: np.ndarray) -> tuple[list[float | None], list[float | None]]:
    """At most ``MAX_CURVE_POINTS`` evenly spaced points, first and last kept."""
    if x.size > MAX_CURVE_POINTS:
        keep = np.unique(np.linspace(0, x.size - 1, MAX_CURVE_POINTS).round().astype(np.int64))
        x, y = x[keep], y[keep]

    def clean(a: np.ndarray) -> list[float | None]:
        return [float(v) if math.isfinite(v) else None for v in a.tolist()]

    return clean(x), clean(y)


def pr_curves(y_true: Any, y_score: Any, labels: Sequence[str] | None = None) -> dict[str, Any]:
    """One-vs-rest precision-recall per class; precision is the interpolated envelope."""
    t, s = _scores(y_true, y_score)
    curves = []
    for c in range(s.shape[1]):
        fps, tps = _binary_clf_curve((t == c).astype(np.float64), s[:, c])
        n_pos = tps[-1] if tps.size else 0.0
        if n_pos == 0:
            recall = np.full(tps.size + 1, np.nan)
            precision = np.full(tps.size + 1, np.nan)
            ap = None
        else:
            denom = tps + fps
            prec = np.divide(tps, denom, out=np.zeros_like(tps, dtype=np.float64), where=denom > 0)
            recall = np.r_[0.0, tps / n_pos]
            prec = np.r_[1.0, prec]
            precision = np.maximum.accumulate(prec[::-1])[::-1]
            ap = _auc(recall, precision)
        x, y = _downsample(recall, precision)
        curves.append({"label": _label(labels, c), "x": x, "y": y, "auc": ap})
    return {"curves": curves}


def roc_curves(y_true: Any, y_score: Any, labels: Sequence[str] | None = None) -> dict[str, Any]:
    """One-vs-rest ROC per class, with the trapezoidal AUC."""
    t, s = _scores(y_true, y_score)
    curves = []
    for c in range(s.shape[1]):
        fps, tps = _binary_clf_curve((t == c).astype(np.float64), s[:, c])
        n_pos = tps[-1] if tps.size else 0.0
        n_neg = fps[-1] if fps.size else 0.0
        tpr = np.r_[0.0, np.full(tps.size, np.nan) if n_pos == 0 else tps / n_pos]
        fpr = np.r_[0.0, np.full(fps.size, np.nan) if n_neg == 0 else fps / n_neg]
        auc = _auc(fpr, tpr)
        x, y = _downsample(fpr, tpr)
        curves.append({"label": _label(labels, c), "x": x, "y": y, "auc": auc})
    return {"curves": curves}


_KINDS = {
    "confusion_matrix": lambda o: confusion_counts(o["y_true"], o["y_pred"], o.get("class_names")),
    "pr_curve": lambda o: pr_curves(o["y_true"], o["y_score"], o.get("labels")),
    "roc_curve": lambda o: roc_curves(o["y_true"], o["y_score"], o.get("labels")),
}


class PresetHandler:
    object_type = "preset"
    mime_type = "application/json"

    def can_handle(self, obj: Any) -> bool:
        # Explicit via the preset wrappers only.
        return False

    def serialize(self, obj: Any, **kwargs: Any) -> tuple[bytes, dict[str, Any]]:
        if not isinstance(obj, dict) or obj.get("kind") not in _KINDS:
            raise TypeError(
                "The preset handler expects cairn.ConfusionMatrix, cairn.PRCurve or cairn.ROCCurve"
            )
        kind = obj["kind"]
        data = _KINDS[kind](obj)
        blob = json.dumps({"kind": kind, "data": data}, separators=(",", ":")).encode("utf-8")
        meta: dict[str, Any] = {"kind": kind}
        if kind == "confusion_matrix":
            meta["labels"] = data["labels"]
        else:
            meta["labels"] = [c["label"] for c in data["curves"]]
            meta["auc"] = [c["auc"] for c in data["curves"]]
        return blob, meta

    def deserialize(self, data: bytes, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
        """The ``{"kind", "data"}`` dict."""
        return json.loads(data.decode("utf-8"))
