"""cairn.plot — pure-numpy metric helpers producing Plotly figures.

Golden values below are hand-derived from the classic scikit-learn
``roc_curve``/``precision_recall_curve`` docstring example
(``y_true=[0,0,1,1]``, ``y_score=[0.1,0.4,0.35,0.8]``, equivalently
``y=[1,1,2,2]`` with ``pos_label=2`` for the ROC form) so the numbers are
independently checkable against a widely-published reference rather than
against this implementation's own mental model. Worked by hand:

    sorted by score desc:  score=[0.8, 0.4, 0.35, 0.1]  y=[1, 0, 1, 0]
    tps (cumulative)     = [1, 1, 2, 2]
    fps (cumulative)     = [0, 1, 1, 2]
    n_pos = 2, n_neg = 2

    ROC: fpr = [0, 0, 0.5, 0.5, 1] (origin prepended)
         tpr = [0, 0.5, 0.5, 1, 1]
         AUC (trapezoid) = 0.75

    PR:  recall    = [0, 0.5, 0.5, 1, 1]  (origin prepended)
         precision = [1, 1, 0.5, 2/3, 0.5]
         interpolated precision (running max from the right)
                   = [1, 1, 2/3, 2/3, 0.5]
         AP (trapezoid over interpolated precision) = 5/6
"""

from __future__ import annotations

import sys

import numpy as np
import pytest

pytest.importorskip("plotly")

import cairn.plot as cplot

pytestmark = pytest.mark.media


# ---------------------------------------------------------------------------
# confusion_matrix
# ---------------------------------------------------------------------------


def test_confusion_matrix_golden_counts():
    y_true = [0, 0, 1, 1, 1, 2]
    y_pred = [0, 1, 1, 1, 2, 2]
    fig = cplot.confusion_matrix(y_true, y_pred)

    heatmap = fig.data[0]
    z = np.asarray(heatmap.z)
    expected = np.array(
        [
            [1, 1, 0],
            [0, 2, 1],
            [0, 0, 1],
        ],
        dtype=np.float64,
    )
    np.testing.assert_array_equal(z, expected)
    assert list(heatmap.x) == ["0", "1", "2"]
    assert list(heatmap.y) == ["0", "1", "2"]


def test_confusion_matrix_class_names():
    fig = cplot.confusion_matrix(
        [0, 1, 1], [0, 1, 0], class_names=["cat", "dog"]
    )
    heatmap = fig.data[0]
    assert list(heatmap.x) == ["cat", "dog"]
    assert list(heatmap.y) == ["cat", "dog"]


def test_confusion_matrix_normalize_true():
    # Row 0 (true=0): predicted [0,0,1] -> counts [2,1]; row sums to 1.
    # Row 1 (true=1): predicted [1] -> counts [0,1]; row sums to 1.
    y_true = [0, 0, 0, 1]
    y_pred = [0, 0, 1, 1]
    fig = cplot.confusion_matrix(y_true, y_pred, normalize="true")
    z = np.asarray(fig.data[0].z)
    np.testing.assert_allclose(z, [[2 / 3, 1 / 3], [0.0, 1.0]])
    row_sums = np.nansum(z, axis=1)
    np.testing.assert_allclose(row_sums, [1.0, 1.0])


def test_confusion_matrix_normalize_pred():
    y_true = [0, 0, 0, 1]
    y_pred = [0, 0, 1, 1]
    fig = cplot.confusion_matrix(y_true, y_pred, normalize="pred")
    z = np.asarray(fig.data[0].z)
    # Column 0 (pred=0): true [0,0] -> counts [2,0], sums to 1.
    # Column 1 (pred=1): true [0,1] -> counts [1,1], sums to 1.
    np.testing.assert_allclose(z, [[1.0, 0.5], [0.0, 0.5]])


def test_confusion_matrix_normalize_handles_empty_row():
    # Class 2 never appears as true label -> row 2 sum is 0 under "true".
    y_true = [0, 1]
    y_pred = [0, 1]
    fig = cplot.confusion_matrix(y_true, y_pred, class_names=["a", "b", "c"], normalize="true")
    z = np.asarray(fig.data[0].z)
    assert np.isnan(z[2]).all()
    assert np.isclose(z[0, 0], 1.0)
    assert np.isclose(z[1, 1], 1.0)


def test_confusion_matrix_single_class():
    fig = cplot.confusion_matrix([0, 0, 0], [0, 0, 0])
    z = np.asarray(fig.data[0].z)
    assert z.shape == (1, 1)
    assert z[0, 0] == 3


def test_confusion_matrix_rejects_bad_normalize():
    with pytest.raises(ValueError):
        cplot.confusion_matrix([0], [0], normalize="bogus")


def test_confusion_matrix_rejects_empty():
    with pytest.raises(ValueError):
        cplot.confusion_matrix([], [])


def test_confusion_matrix_rejects_short_class_names():
    with pytest.raises(ValueError):
        cplot.confusion_matrix([0, 1], [0, 1], class_names=["only-one"])


# ---------------------------------------------------------------------------
# roc_curve
# ---------------------------------------------------------------------------

_Y_TRUE_BINARY = [0, 0, 1, 1]
_Y_SCORE_BINARY = [0.1, 0.4, 0.35, 0.8]


def test_roc_curve_golden_values_binary_1d_scores():
    fig = cplot.roc_curve(_Y_TRUE_BINARY, _Y_SCORE_BINARY)

    # Two traces: class "1" (positive) plus the "chance" diagonal.
    # (class "0" is also one-vs-rest plotted since y_probas is expanded to
    # 2 columns — assert on the positive-class trace by name.)
    class_1 = next(t for t in fig.data if t.name.startswith("1 "))
    fpr = np.asarray(class_1.x)
    tpr = np.asarray(class_1.y)
    np.testing.assert_allclose(fpr, [0, 0, 0.5, 0.5, 1.0])
    np.testing.assert_allclose(tpr, [0, 0.5, 0.5, 1.0, 1.0])
    assert "AUC=0.750" in class_1.name


def test_roc_curve_2d_probas_matches_1d_convenience():
    probas_2d = np.stack(
        [1.0 - np.asarray(_Y_SCORE_BINARY), np.asarray(_Y_SCORE_BINARY)], axis=1
    )
    fig_2d = cplot.roc_curve(_Y_TRUE_BINARY, probas_2d)
    fig_1d = cplot.roc_curve(_Y_TRUE_BINARY, _Y_SCORE_BINARY)

    c1_2d = next(t for t in fig_2d.data if t.name.startswith("1 "))
    c1_1d = next(t for t in fig_1d.data if t.name.startswith("1 "))
    np.testing.assert_allclose(np.asarray(c1_2d.x), np.asarray(c1_1d.x))
    np.testing.assert_allclose(np.asarray(c1_2d.y), np.asarray(c1_1d.y))


def test_roc_curve_has_chance_diagonal():
    fig = cplot.roc_curve(_Y_TRUE_BINARY, _Y_SCORE_BINARY)
    chance = next(t for t in fig.data if t.name == "chance")
    assert list(chance.x) == [0, 1]
    assert list(chance.y) == [0, 1]


def test_roc_curve_multiclass_one_vs_rest_and_labels():
    y_true = [0, 1, 2, 1, 0, 2]
    y_probas = [
        [0.7, 0.2, 0.1],
        [0.1, 0.8, 0.1],
        [0.2, 0.2, 0.6],
        [0.3, 0.5, 0.2],
        [0.6, 0.3, 0.1],
        [0.1, 0.1, 0.8],
    ]
    fig = cplot.roc_curve(y_true, y_probas, labels=["cat", "dog", "bird"])
    names = [t.name for t in fig.data]
    assert any(n.startswith("cat ") for n in names)
    assert any(n.startswith("dog ") for n in names)
    assert any(n.startswith("bird ") for n in names)
    assert "chance" in names
    # 3 classes + chance line.
    assert len(fig.data) == 4


def test_roc_curve_classes_to_plot_filters():
    y_true = [0, 1, 2, 1, 0, 2]
    y_probas = [
        [0.7, 0.2, 0.1],
        [0.1, 0.8, 0.1],
        [0.2, 0.2, 0.6],
        [0.3, 0.5, 0.2],
        [0.6, 0.3, 0.1],
        [0.1, 0.1, 0.8],
    ]
    fig = cplot.roc_curve(y_true, y_probas, classes_to_plot=[0, 2])
    names = [t.name for t in fig.data]
    assert any(n.startswith("0 ") for n in names)
    assert any(n.startswith("2 ") for n in names)
    assert not any(n.startswith("1 ") for n in names)
    assert len(fig.data) == 3  # 2 classes + chance


def test_roc_curve_single_class_present_is_nan_and_labeled_na():
    # Every sample is the positive class -> negatives (class 0) never occur,
    # so FPR for class 1 is undefined (0/0), and vice versa for class 0.
    y_true = [1, 1, 1, 1]
    y_probas = [[0.1, 0.9], [0.2, 0.8], [0.05, 0.95], [0.3, 0.7]]
    fig = cplot.roc_curve(y_true, y_probas)
    class_0 = next(t for t in fig.data if t.name.startswith("0 "))
    assert "AUC=n/a" in class_0.name
    # tpr for the never-true-positive class 0 is well defined (all zero
    # negatives predicted correctly is trivially undefined -> NaN per docs).
    assert np.isnan(np.asarray(class_0.y)).any()


def test_roc_curve_rejects_nan_probas():
    with pytest.raises(ValueError):
        cplot.roc_curve([0, 1], [[0.5, float("nan")], [0.2, 0.8]])


def test_roc_curve_rejects_out_of_range_labels():
    with pytest.raises(ValueError):
        cplot.roc_curve([0, 5], [[0.5, 0.5], [0.2, 0.8]])


# ---------------------------------------------------------------------------
# pr_curve
# ---------------------------------------------------------------------------


def test_pr_curve_golden_values_binary_1d_scores():
    fig = cplot.pr_curve(_Y_TRUE_BINARY, _Y_SCORE_BINARY)
    class_1 = next(t for t in fig.data if t.name.startswith("1 "))
    recall = np.asarray(class_1.x)
    precision_interp = np.asarray(class_1.y)

    np.testing.assert_allclose(recall, [0, 0.5, 0.5, 1.0, 1.0])
    np.testing.assert_allclose(precision_interp, [1.0, 1.0, 2 / 3, 2 / 3, 0.5])
    assert "AP=0.833" in class_1.name  # 5/6


def test_pr_curve_interpolated_envelope_is_non_increasing():
    fig = cplot.pr_curve(_Y_TRUE_BINARY, _Y_SCORE_BINARY)
    class_1 = next(t for t in fig.data if t.name.startswith("1 "))
    precision_interp = np.asarray(class_1.y)
    assert np.all(np.diff(precision_interp) <= 1e-12)


def test_pr_curve_multiclass_labels_and_filter():
    y_true = [0, 1, 2, 1, 0, 2]
    y_probas = [
        [0.7, 0.2, 0.1],
        [0.1, 0.8, 0.1],
        [0.2, 0.2, 0.6],
        [0.3, 0.5, 0.2],
        [0.6, 0.3, 0.1],
        [0.1, 0.1, 0.8],
    ]
    fig = cplot.pr_curve(y_true, y_probas, labels=["cat", "dog", "bird"], classes_to_plot=[1])
    assert len(fig.data) == 1
    assert fig.data[0].name.startswith("dog ")


def test_pr_curve_single_class_present_is_nan_and_labeled_na():
    y_true = [0, 0, 0, 0]
    y_probas = [[0.9, 0.1], [0.8, 0.2], [0.95, 0.05], [0.7, 0.3]]
    fig = cplot.pr_curve(y_true, y_probas)
    class_1 = next(t for t in fig.data if t.name.startswith("1 "))
    assert "AP=n/a" in class_1.name
    assert np.isnan(np.asarray(class_1.y)).all()


def test_pr_curve_rejects_empty():
    with pytest.raises(ValueError):
        cplot.pr_curve([], [])


def test_pr_curve_rejects_mismatched_lengths():
    with pytest.raises(ValueError):
        cplot.pr_curve([0, 1, 1], [[0.5, 0.5], [0.2, 0.8]])


# ---------------------------------------------------------------------------
# bar / line_series
# ---------------------------------------------------------------------------


def test_bar_basic_structure():
    fig = cplot.bar(["a", "b", "c"], [1, 5, 3], title="my bars")
    assert len(fig.data) == 1
    assert fig.data[0].type == "bar"
    assert list(fig.data[0].x) == ["a", "b", "c"]
    np.testing.assert_allclose(fig.data[0].y, [1, 5, 3])
    assert fig.layout.title.text == "my bars"


def test_bar_rejects_mismatched_lengths():
    with pytest.raises(ValueError):
        cplot.bar(["a", "b"], [1, 2, 3])


def test_bar_rejects_empty():
    with pytest.raises(ValueError):
        cplot.bar([], [])


def test_line_series_shared_x():
    fig = cplot.line_series([0, 1, 2], [[1, 2, 3], [3, 2, 1]], keys=["up", "down"])
    assert len(fig.data) == 2
    assert fig.data[0].name == "up"
    assert fig.data[1].name == "down"
    np.testing.assert_allclose(fig.data[0].x, [0, 1, 2])
    np.testing.assert_allclose(fig.data[0].y, [1, 2, 3])
    np.testing.assert_allclose(fig.data[1].y, [3, 2, 1])


def test_line_series_per_series_x():
    fig = cplot.line_series(
        [[0, 1, 2], [0, 2, 4]], [[1, 2, 3], [3, 2, 1]], keys=["a", "b"]
    )
    np.testing.assert_allclose(fig.data[0].x, [0, 1, 2])
    np.testing.assert_allclose(fig.data[1].x, [0, 2, 4])


def test_line_series_default_keys():
    fig = cplot.line_series([0, 1], [[1, 2], [3, 4]])
    assert fig.data[0].name == "series_0"
    assert fig.data[1].name == "series_1"


def test_line_series_rejects_empty_ys():
    with pytest.raises(ValueError):
        cplot.line_series([0, 1], [])


def test_line_series_rejects_mismatched_keys():
    with pytest.raises(ValueError):
        cplot.line_series([0, 1], [[1, 2]], keys=["a", "b"])


# ---------------------------------------------------------------------------
# Optionality: plotly missing -> clear ImportError, not at import time.
# ---------------------------------------------------------------------------


def test_import_cairn_plot_without_plotly_does_not_raise(monkeypatch):
    # Simulate plotly being uninstalled — cairn.plot itself must still import.
    for mod in list(sys.modules):
        if mod == "plotly" or mod.startswith("plotly."):
            monkeypatch.delitem(sys.modules, mod, raising=False)
    monkeypatch.setitem(sys.modules, "plotly", None)

    import importlib

    import cairn.plot as reloaded

    importlib.reload(reloaded)  # module body itself has no plotly import

    with pytest.raises(ImportError, match="cairn-plot\\[media\\]"):
        reloaded.bar(["a"], [1])
