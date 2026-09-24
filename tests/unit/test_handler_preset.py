"""Preset charts (confusion matrix, PR, ROC) stored as data."""

from __future__ import annotations

import json

import numpy as np
import pytest

import cairn
from cairn.sdk.handlers import default_registry
from cairn.sdk.handlers.preset import MAX_CURVE_POINTS, PresetHandler

H = PresetHandler()


def _data(wrapper):
    blob, meta = H.serialize(wrapper.obj)
    out = json.loads(blob)
    assert out["kind"] == meta["kind"]
    return out["data"], meta


def test_registered_and_wrappers_dispatch_to_it():
    assert isinstance(default_registry.find_by_type("preset"), PresetHandler)
    for w in (cairn.ConfusionMatrix([0], [0]), cairn.PRCurve([0], [0.5]), cairn.ROCCurve([0], [0.5])):
        assert w.object_type == "preset"


def test_confusion_counts():
    data, meta = _data(cairn.ConfusionMatrix([0, 0, 1, 2, 2], [0, 1, 1, 2, 0], class_names=["a", "b", "c"]))
    assert data == {"labels": ["a", "b", "c"], "counts": [[1, 1, 0], [0, 1, 0], [1, 0, 1]]}
    assert meta["labels"] == ["a", "b", "c"]
    # Names beyond the observed classes widen the matrix.
    data, _ = _data(cairn.ConfusionMatrix([0], [1], class_names=["a", "b", "c"]))
    assert data["counts"] == [[0, 1, 0], [0, 0, 0], [0, 0, 0]]
    with pytest.raises(ValueError, match="shorter"):
        H.serialize(cairn.ConfusionMatrix([0, 2], [0, 1], class_names=["a"]).obj)


def test_binary_roc_and_pr_by_hand():
    y, s = [0, 0, 1, 1], [0.1, 0.4, 0.35, 0.8]
    roc, meta = _data(cairn.ROCCurve(y, s))
    pos = roc["curves"][1]
    assert pos["x"] == [0.0, 0.0, 0.5, 0.5, 1.0]
    assert pos["y"] == [0.0, 0.5, 0.5, 1.0, 1.0]
    assert pos["auc"] == pytest.approx(0.75)
    assert meta["auc"][1] == pytest.approx(0.75)
    pr, _ = _data(cairn.PRCurve(y, s))
    pos = pr["curves"][1]
    assert pos["x"] == [0.0, 0.5, 0.5, 1.0, 1.0]
    # Interpolated envelope: best precision at this recall or higher.
    assert pos["y"] == pytest.approx([1.0, 1.0, 2 / 3, 2 / 3, 0.5])


def test_class_without_positives_is_null():
    roc, meta = _data(cairn.ROCCurve([0, 0, 0], [[0.9, 0.1], [0.8, 0.2], [0.7, 0.3]]))
    assert roc["curves"][1]["auc"] is None and meta["auc"][1] is None
    assert roc["curves"][1]["y"][1:] == [None, None, None]
    pr, _ = _data(cairn.PRCurve([0, 0, 0], [[0.9, 0.1], [0.8, 0.2], [0.7, 0.3]], labels=["neg", "pos"]))
    assert pr["curves"][1]["label"] == "pos" and pr["curves"][1]["auc"] is None


def test_curves_are_downsampled_but_auc_is_exact():
    rng = np.random.default_rng(0)
    y = rng.integers(0, 3, 5000)
    s = rng.random((5000, 3))
    s[np.arange(5000), y] += 0.5
    s /= s.sum(axis=1, keepdims=True)
    roc, _ = _data(cairn.ROCCurve(y, s))
    for c in roc["curves"]:
        assert len(c["x"]) <= MAX_CURVE_POINTS and len(c["x"]) == len(c["y"])
        assert c["x"][0] == 0.0 and c["x"][-1] == 1.0

    recipes = pytest.importorskip("cairn_plot.recipes")
    pytest.importorskip("plotly")
    ref = recipes.roc_curve(y, s)
    for c, trace in zip(roc["curves"], ref.data):
        assert trace.name == f"{c['label']} (AUC={c['auc']:.3f})"
    pr, _ = _data(cairn.PRCurve(y, s))
    ref = recipes.pr_curve(y, s)
    for c, trace in zip(pr["curves"], ref.data):
        assert trace.name == f"{c['label']} (AP={c['auc']:.3f})"


def test_matches_reference_confusion_matrix():
    recipes = pytest.importorskip("cairn_plot.recipes")
    pytest.importorskip("plotly")
    rng = np.random.default_rng(1)
    y, p = rng.integers(0, 4, 200), rng.integers(0, 4, 200)
    data, _ = _data(cairn.ConfusionMatrix(y, p))
    assert np.array_equal(np.asarray(recipes.confusion_matrix(y, p).data[0].z), np.asarray(data["counts"]))


def test_tracked_preset_reads_back(tmp_path):
    run = cairn.Run(project="p", repo=tmp_path / ".cairn", capture_source=False, capture_stdout=False,
                    capture_env=False, capture_system_metrics=False)
    run.track(cairn.ConfusionMatrix([0, 1], [1, 1]), name="cm", step=0)
    run.finish()
    with cairn.Reader(repo=tmp_path / ".cairn") as reader:
        r = reader.run(run.id)
        assert r.artifact("cm") == {"kind": "confusion_matrix",
                                    "data": {"labels": ["0", "1"], "counts": [[0, 1], [0, 1]]}}
        assert [s.object_type for s in r.sequences() if s.name == "cm"] == ["preset"]
