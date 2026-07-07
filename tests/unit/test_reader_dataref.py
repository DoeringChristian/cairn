"""WS-PYAPI deliverable 1: ``Run.__getitem__`` / ``DataRef`` (reader.py).

``run[tag]`` must return a lazy handle immediately — no sequence/artifact
fetch at construction time — and resolve only when asked to (``.resolve()``,
``.context_hash()``, or optional step-indexing ``run[tag][step]``).
"""

from __future__ import annotations

import pytest

import cairn
from cairn.sdk.reader import DataRef, Reader, Sequence, SequencePoint


@pytest.fixture
def populated_repo(tmp_path):
    repo = tmp_path / ".cairn"
    run = cairn.Run(
        project="pyapi-test",
        name="run-a",
        repo=str(repo),
        capture_source=False,
        capture_stdout=False,
        capture_env=False,
        capture_system_metrics=False,
    )
    run_id = run.id
    try:
        for i in range(3):
            run.track(float(i) * 0.1, name="loss", step=i)
    finally:
        run.finish()
    return repo, run_id


def test_getitem_returns_dataref_without_fetching(populated_repo, monkeypatch):
    repo, run_id = populated_repo
    reader = Reader(repo=str(repo))
    try:
        r = reader.run(run_id)

        def _boom(*a, **k):
            raise AssertionError("Run.__getitem__ must not touch the backend eagerly")

        monkeypatch.setattr(reader._backend, "get_sequence", _boom)
        monkeypatch.setattr(reader._backend, "list_sequences", _boom)
        monkeypatch.setattr(reader._backend, "list_artifacts", _boom)

        ref = r["loss"]
        assert isinstance(ref, DataRef)
        assert ref.run_id == run_id
        assert ref.tag == "loss"
        assert ref.step is None
    finally:
        reader.close()


def test_dataref_step_indexing(populated_repo):
    repo, run_id = populated_repo
    reader = Reader(repo=str(repo))
    try:
        r = reader.run(run_id)
        ref = r["loss"]
        stepped = ref[1]
        assert isinstance(stepped, DataRef)
        assert stepped.step == 1
        # Indexing narrows, doesn't mutate the original handle.
        assert ref.step is None
    finally:
        reader.close()


def test_dataref_getitem_rejects_non_int():
    class _FakeRun:
        id = "r"

    ref = DataRef(_FakeRun(), "loss")
    with pytest.raises(TypeError):
        ref["not-an-int"]


def test_run_getitem_rejects_non_str_tag(populated_repo):
    repo, run_id = populated_repo
    reader = Reader(repo=str(repo))
    try:
        r = reader.run(run_id)
        with pytest.raises(TypeError):
            r[123]
    finally:
        reader.close()


def test_dataref_resolve_scalar_sequence(populated_repo):
    repo, run_id = populated_repo
    reader = Reader(repo=str(repo))
    try:
        r = reader.run(run_id)
        ref = r["loss"]
        resolved = ref.resolve()
        assert isinstance(resolved, Sequence)
        assert resolved.values == pytest.approx([0.0, 0.1, 0.2])
    finally:
        reader.close()


def test_dataref_resolve_scalar_sequence_with_step(populated_repo):
    repo, run_id = populated_repo
    reader = Reader(repo=str(repo))
    try:
        r = reader.run(run_id)
        ref = r["loss"][1]
        resolved = ref.resolve()
        assert isinstance(resolved, SequencePoint)
        assert resolved.step == 1
        assert resolved.scalar_value == pytest.approx(0.1)
    finally:
        reader.close()


def test_dataref_context_hash_known_and_unknown_tag(populated_repo):
    repo, run_id = populated_repo
    reader = Reader(repo=str(repo))
    try:
        r = reader.run(run_id)
        assert r["loss"].context_hash() == ""
        assert r["does-not-exist"].context_hash() == ""
    finally:
        reader.close()


def test_dataref_repr(populated_repo):
    repo, run_id = populated_repo
    reader = Reader(repo=str(repo))
    try:
        r = reader.run(run_id)
        assert repr(r["loss"]) == f"DataRef(run={run_id!r}, tag='loss')"
        assert repr(r["loss"][2]) == f"DataRef(run={run_id!r}, tag='loss'[2])"
    finally:
        reader.close()
