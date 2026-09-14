"""`cairn.Scope` + the `__cairn_track__` protocol.

Spec: docs/superpowers/specs/2026-09-14-scope-track-protocol-design.md

A component records what is worth recording about ITSELF; the caller no longer
re-lists another object's internals. `run.track` walks any value implementing
`__cairn_track__`, threading the name prefix and the step down the tree.
"""
from __future__ import annotations

import pytest

import cairn


class Leafy:
    """A component that records two scalars."""

    def __init__(self, a: float, b: float) -> None:
        self.a, self.b = a, b

    def __cairn_track__(self, scope) -> None:
        scope.track(self.a, "a")
        scope.track(self.b, "b")


class Nested:
    """A component holding another component."""

    def __init__(self, child: Leafy, rms: float) -> None:
        self.child, self.rms = child, rms

    def __cairn_track__(self, scope) -> None:
        scope.track(self.rms, "rms")
        scope.track(self.child, "child")


@pytest.fixture()
def run(tmp_path):
    r = cairn.Run(project="scope", repo=tmp_path / ".cairn", capture_system_metrics=False,
                  capture_source=False)
    yield r
    if not r._finished:
        r.finish()


def names(tmp_path, project="scope"):
    reader = cairn.Reader(repo=tmp_path / ".cairn")
    run = reader.runs(project).list()[0]
    return {s.name for s in run.sequences() if not s.name.startswith("system.")}


def series(tmp_path, name, project="scope"):
    reader = cairn.Reader(repo=tmp_path / ".cairn")
    run = reader.runs(project).list()[0]
    seq = run.sequence(name)
    return list(seq.steps), list(seq.values)


# --------------------------------------------------------------------------
# step is required outside a scope
# --------------------------------------------------------------------------

def test_track_requires_step(run):
    with pytest.raises(TypeError) as excinfo:
        run.track(1.0, "loss")  # type: ignore[call-arg]
    assert "step" in str(excinfo.value)


def test_track_accepts_step_positionally(run, tmp_path):
    run.track(1.5, "loss", 3)
    run.finish()
    assert series(tmp_path, "loss") == ([3], [1.5])


# --------------------------------------------------------------------------
# the protocol
# --------------------------------------------------------------------------

def test_run_track_walks_a_component(run, tmp_path):
    run.track(Leafy(1.0, 2.0), "model", step=0)
    run.finish()
    assert names(tmp_path) == {"model.a", "model.b"}


def test_names_join_with_a_dot_and_nest(run, tmp_path):
    run.track(Nested(Leafy(1.0, 2.0), 9.0), "model", step=0)
    run.finish()
    assert names(tmp_path) == {"model.rms", "model.child.a", "model.child.b"}


def test_empty_root_name_leaves_children_unprefixed(run, tmp_path):
    run.track(Leafy(1.0, 2.0), "", step=0)
    run.finish()
    assert names(tmp_path) == {"a", "b"}


def test_every_leaf_shares_the_root_step(run, tmp_path):
    """The whole point: one iteration is one step across the entire tree."""
    for it in range(3):
        run.track(Nested(Leafy(float(it), float(it)), float(it)), "m", step=it)
    run.finish()
    for name in ("m.rms", "m.child.a", "m.child.b"):
        steps, _ = series(tmp_path, name)
        assert steps == [0, 1, 2], name


def test_optional_member_is_a_silent_skip_without_drifting_siblings(run, tmp_path):
    """`track(None)` skips, and because the step is BOUND the surviving points
    keep their true iteration numbers instead of sliding down."""

    class Sometimes:
        def __init__(self, it: int) -> None:
            self.it = it

        def __cairn_track__(self, scope) -> None:
            scope.track(float(self.it), "always")
            scope.track(float(self.it) if self.it % 2 == 0 else None, "sometimes")

    for it in range(6):
        run.track(Sometimes(it), "m", step=it)
    run.finish()
    assert series(tmp_path, "m.always") == ([0, 1, 2, 3, 4, 5], [0, 1, 2, 3, 4, 5])
    # The pre-scope bug recorded these at steps [0,1,2]; they must stay 0,2,4.
    assert series(tmp_path, "m.sometimes") == ([0, 2, 4], [0, 2, 4])


# --------------------------------------------------------------------------
# scope object
# --------------------------------------------------------------------------

def test_run_scope_binds_step_for_non_component_code(run, tmp_path):
    scope = run.scope(step=7)
    assert isinstance(scope, cairn.Scope)
    assert scope.step == 7
    assert scope.run is run
    scope.track(1.0, "a")
    run.finish()
    assert series(tmp_path, "a") == ([7], [1.0])


def test_scope_child_joins_names_and_keeps_the_step(run, tmp_path):
    child = run.scope(step=2).scope("outer").scope("inner")
    child.track(5.0, "v")
    assert child.step == 2
    run.finish()
    assert series(tmp_path, "outer.inner.v") == ([2], [5.0])


def test_scope_track_defaults_name_to_empty(run, tmp_path):
    run.scope(step=1).scope("m").track(Leafy(1.0, 2.0))
    run.finish()
    assert names(tmp_path) == {"m.a", "m.b"}


def test_scope_track_of_none_is_a_silent_skip(run, tmp_path):
    run.scope(step=0).track(None, "nope")
    run.track(1.0, "yes", step=0)
    run.finish()
    assert names(tmp_path) == {"yes"}


# --------------------------------------------------------------------------
# guards
# --------------------------------------------------------------------------

def test_a_cycle_does_not_recurse_forever(run, tmp_path):
    class Node:
        def __init__(self, name: str) -> None:
            self.name, self.peer = name, None

        def __cairn_track__(self, scope) -> None:
            scope.track(1.0, self.name)
            scope.track(self.peer, "peer")

    a, b = Node("a"), Node("b")
    a.peer, b.peer = b, a  # back-reference
    run.track(a, "root", step=0)
    run.finish()
    # `a` is on the path when `peer.peer` points back at it, so the walk stops.
    assert "root.a" in names(tmp_path)


def test_runaway_depth_raises_naming_the_path(run):
    class Forever:
        def __cairn_track__(self, scope) -> None:
            # A NEW object every level, so the cycle guard cannot catch it.
            scope.track(Forever(), "d")

    with pytest.raises(RecursionError) as excinfo:
        run.track(Forever(), "root", step=0)
    assert "root" in str(excinfo.value)


def test_system_metrics_still_work_without_an_explicit_step(tmp_path):
    """The one legitimately stepless caller keeps its per-name counter."""
    r = cairn.Run(project="sys", repo=tmp_path / ".cairn", capture_system_metrics=False,
                  capture_source=False)
    r._track_sample("system.fake", 1.0)
    r._track_sample("system.fake", 2.0)
    r.finish()
    reader = cairn.Reader(repo=tmp_path / ".cairn")
    seq = reader.runs("sys").list()[0].sequence("system.fake")
    assert list(seq.steps) == [0, 1]
    assert list(seq.values) == [1.0, 2.0]
