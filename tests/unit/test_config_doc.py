"""Nested config / summary documents: exact round trip, deep merge, the flat
index, collisions, WAL replay, deletes, Scope nesting."""

from __future__ import annotations

import math

import numpy as np
import pytest

import cairn
from cairn.server import config_doc, ingest_ops

QUIET = dict(capture_source=False, capture_stdout=False, capture_env=False,
             capture_system_metrics=False)


@pytest.mark.parametrize("base, update, expected", [
    ({"a": {"b": 1, "c": 2}}, {"a": {"b": 3}}, {"a": {"b": 3, "c": 2}}),   # dict into dict
    ({"model": {"depth": 4}}, {"model": "resnet"}, {"model": "resnet"}),   # scalar drops subtree
    ({"model": "resnet"}, {"model": {"depth": 4}}, {"model": {"depth": 4}}),  # dict over scalar
    ({"l": [1, 2]}, {"l": [3]}, {"l": [3]}),                               # lists replace
    ({"a": 1}, {"a": None}, {"a": None}),                                  # None is a value
    ({}, {"e": {}}, {"e": {}}),                                            # {} kept
])
def test_merge_rules(base, update, expected):
    assert config_doc.merge(base, update) == expected
    assert base != expected or base == update  # merge never mutates its input


def test_normalize_and_errors():
    assert config_doc.normalize({"t": (1, 2), "n": np.float32(0.5), "i": np.int64(3)}) == {
        "t": [1, 2], "n": 0.5, "i": 3,
    }
    with pytest.raises(TypeError, match="'opt.fn'"):
        config_doc.normalize({"opt": {"fn": object()}})
    with pytest.raises(TypeError, match="keys must be str"):
        config_doc.normalize({"a": {1: "x"}})


def test_flat_index_and_collisions():
    doc = {"a.b": 1, "c": {"d": [1], "e": {}}}
    assert config_doc.flatten(doc) == {"a.b": 1, "c.d": [1]}
    with pytest.raises(ValueError, match="both flatten to 'a.b'"):
        config_doc.flatten({"a.b": 1, "a": {"b": 2}})
    assert config_doc.delete({"a": {"b": 1, "c": 2}}, "a.b") == {"a": {"c": 2}}
    assert config_doc.delete({"a.b": 1}, "a.b") == {}
    assert config_doc.unflatten({"optim.lr": 1, "optim.wd": 2, "x": 3}) == {
        "optim": {"lr": 1, "wd": 2}, "x": 3,
    }


@pytest.fixture(params=["local", "http"])
def target(request, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    if request.param == "http":
        monkeypatch.setenv("CAIRN_WAL_DIR", str(tmp_path / "wal"))
        return request.getfixturevalue("live_server").replace("http://", "cairn://"), {}
    return str(tmp_path / ".cairn"), {}


def test_exact_round_trip_and_merge_on_every_backend(target):
    repo, kw = target
    nan_inf = {"nan": float("nan"), "inf": float("inf")}
    with cairn.Run("p", repo=repo, **QUIET, **kw) as run:
        run.config(model={"depth": 4, "width": 64}, optim={"lr": 1e-3}, empty={}, **{"a.b": 1})
        run.config(model="resnet")                     # replaces the subtree
        run.config(optim={"betas": (0.9, 0.99)}, flag=None, **nan_inf)
        run.summary({"test": {"psnr": 31.0}})
        with pytest.raises(ValueError, match="flatten"):
            run.config(a={"b": 2})                     # collides with "a.b"
        with pytest.raises(TypeError):
            run.config(bad=object())
        rid = run.id
    with cairn.Reader(repo, cache=False) as reader:
        r = reader.run(rid)
        cfg = r.config
        assert math.isnan(cfg.pop("nan")) and cfg.pop("inf") == math.inf
        assert cfg == {
            "model": "resnet", "optim": {"lr": 1e-3, "betas": [0.9, 0.99]}, "empty": {},
            "a.b": 1, "flag": None,
        }
        assert r.summary == {"test": {"psnr": 31.0}}
        # The flat index has no stale model.depth beside model="resnet".
        assert [x.id for x in reader.runs("p").filter(model="resnet")] == [rid]
        assert list(reader.runs("p").filter(model__depth=4)) == []
        assert [x.id for x in reader.runs("p").filter(**{"a.b": 1})] == [rid]
        r.config["model"] = "mutated"                  # a copy
        assert r.config["model"] == "resnet"


def test_editor_set_and_delete_paths(tmp_path):
    repo = tmp_path / ".cairn"
    with cairn.Run("p", repo=repo, **QUIET) as run:
        run.config(optim={"lr": 1e-3, "wd": 0.1}, keep=1, **{"x.y": 2})
    with cairn.Reader(repo) as reader:
        r = reader.run(run.id)
        with r.edit() as ed:
            ed.set_config(optim={"lr": 3e-4})
            with pytest.raises(ValueError, match="flatten"):
                ed.set_config(x={"y": 3})
            ed.delete_keys("config", ["optim.wd", "x.y"])
        assert r.config == {"optim": {"lr": 3e-4}, "keep": 1}
        with r.edit() as ed:
            ed.delete_keys("config", ["optim"])
        assert r.config == {"keep": 1}


def test_scope_config_nests(tmp_path):
    class Encoder:
        def __cairn_track__(self, scope):
            scope.config(opt={"lr": 1e-3}, layers=2)

    class Model:
        def __cairn_track__(self, scope):
            scope.track(Encoder(), "encoder")

    repo = tmp_path / ".cairn"
    with cairn.Run("p", repo=repo, **QUIET) as run:
        run.track(Model(), "model", step=0)
    with cairn.Reader(repo) as reader:
        r = reader.run(run.id)
        assert r.config == {"model": {"encoder": {"opt": {"lr": 1e-3}, "layers": 2}}}
        assert [x.id for x in reader.runs("p").filter(**{"config.model.encoder.opt.lr": 1e-3})] == [run.id]


def test_wal_replay_applies_writes_in_order(fresh_db):
    """The WAL carries partial mappings; ingest merges them in WAL order, and a
    second drain of the same ops converges to the same document."""
    db = fresh_db
    rid = ingest_ops.create_run(db, project="p")["run_id"]
    ops = [{"model": {"depth": 4}}, {"model": "resnet"}, {"model": {"width": 8}}]
    for _ in range(2):
        for o in ops:
            ingest_ops.set_params(db, rid, o)
        assert ingest_ops.run_docs(db, rid)["config"] == {"model": {"width": 8}}
    assert db.read_columns("SELECT key FROM params WHERE run_id = ?", [rid]) == [{"key": "model.width"}]
