"""``RunQuery.where(expr)`` and ``Run.eval(expr)`` (cairn.expr on the Reader)."""
from __future__ import annotations

import warnings

import pytest

import cairn
from cairn.expr import ExprError, ExprWarning, Series
from cairn.sdk.reader import Reader


def _run(repo, name, *, opt, losses, tags=None):
    run = cairn.Run(
        project="expr-test", name=name, repo=str(repo), tags=tags or [],
        capture_source=False, capture_stdout=False, capture_env=False,
        capture_system_metrics=False,
    )
    try:
        run.config(optimizer={"name": opt}, lr=0.1)
        run.summary(best=min(losses))
        for i, v in enumerate(losses):
            run.track(v, name="loss", step=i)
        run.track(1.0, name="epoch", step=0)
    finally:
        run.finish()
    return run.id


@pytest.fixture
def repo(tmp_path):
    repo = tmp_path / ".cairn"
    _run(repo, "a", opt="adam", losses=[1.0, 0.5, 0.2], tags=["best"])
    _run(repo, "b", opt="sgd", losses=[1.0, 0.9, 0.8])
    return repo


def test_where_filters_by_expression(repo):
    r = Reader(repo=str(repo))
    q = r.runs("expr-test")
    assert {x.name for x in q.where("last(loss) < 0.5")} == {"a"}
    assert {x.name for x in q.where("config.optimizer.name == 'sgd'")} == {"b"}
    assert {x.name for x in q.where("'best' in run.tags")} == {"a"}
    assert {x.name for x in q.where("summary.best > 0.1").where("run.name != 'a'")} == {"b"}
    assert {x.name for x in q.where("config.missing > 1")} == set()
    assert len(q.where("mean(loss) > 0").limit(1)) == 1
    assert "where('last(loss) < 0.5')" in repr(q.where("last(loss) < 0.5"))


def test_where_rejects_bad_expressions_up_front(repo):
    q = Reader(repo=str(repo)).runs("expr-test")
    with pytest.raises(ExprError, match="did you mean 'last'"):
        q.where("lats(loss) < 1")
    with pytest.raises(ExprError, match="needs a scalar"):
        q.where("loss < 1")


def test_run_eval(repo):
    r = Reader(repo=str(repo))
    a = r.runs("expr-test").where("run.name == 'a'").first()
    assert a.eval("last(loss) - first(loss)") == pytest.approx(-0.8)
    s = a.eval("loss * 2 + step")
    assert isinstance(s, Series)
    assert s.steps == [0, 1, 2]
    assert s.values == pytest.approx([2.0, 2.0, 2.4])
    rel = a.eval("relative_time + 0 * loss")
    assert all(v is not None and v >= 0 for v in rel.values)
    with pytest.warns(ExprWarning, match="as-of"):
        j = a.eval("loss + epoch")
    assert j.values == pytest.approx([2.0, 1.5, 1.2])
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        a.eval("loss + resample(epoch, loss)")
