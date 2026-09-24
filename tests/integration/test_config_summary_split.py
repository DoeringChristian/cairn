"""config vs summary: two channels, one shape, opposite meanings.

``config`` is what went in, ``summary`` is what the author claims came out, and
neither is a metric. The third channel — ``track`` — is the one that produces a
series, and the point of this split is that a component recording a PROPERTY no
longer has to pretend it is emitting one.
"""
from __future__ import annotations

import cairn
import pytest

from cairn.server.storage.blobs import BlobStore
from cairn.server.storage.db import Database


def _inspect(repo):
    return Database(repo / "cairn.db"), BlobStore(repo / "blobs")


def _run(repo, **kw):
    return cairn.Run(
        project="split",
        repo=repo,
        capture_source=False,
        capture_stdout=False,
        capture_env=False,
        capture_system_metrics=False,
        **kw,
    )


def _keys(db, table, run_id):
    return {
        r["key"]: r["value"]
        for r in db.read_columns(
            f"SELECT key, value FROM {table} WHERE run_id = ?", [run_id]
        )
    }


def test_config_and_summary_land_in_separate_tables(tmp_path):
    repo = tmp_path / ".cairn"
    with _run(repo) as run:
        run.config(lr=3e-4)
        run.summary(best_val=0.91)
        run_id = run.id

    db, _ = _inspect(repo)
    try:
        assert _keys(db, "params", run_id) == {"lr": "0.0003"}
        assert _keys(db, "summary", run_id) == {"best_val": "0.91"}
    finally:
        db.close()


def test_the_same_key_can_be_config_and_summary(tmp_path):
    """`lr` as scheduled vs `lr` as ended: two facts, not a collision."""
    repo = tmp_path / ".cairn"
    with _run(repo) as run:
        run.config(lr=3e-4)
        run.summary(lr=1e-6)
        run_id = run.id

    db, _ = _inspect(repo)
    try:
        assert _keys(db, "params", run_id)["lr"] == "0.0003"
        assert _keys(db, "summary", run_id)["lr"] == "1e-06"
    finally:
        db.close()


def test_both_channels_flatten_nested_mappings(tmp_path):
    repo = tmp_path / ".cairn"
    with _run(repo) as run:
        run.config(hparams={"opt": {"lr": 1e-3}})
        run.summary({"test": {"psnr": 31.4}})
        run_id = run.id

    db, _ = _inspect(repo)
    try:
        assert "hparams.opt.lr" in _keys(db, "params", run_id)
        assert "test.psnr" in _keys(db, "summary", run_id)
    finally:
        db.close()


def test_summary_writes_nothing_on_its_own(tmp_path):
    """A tracked metric is NOT a summary entry.

    The run table merges the two at read time, preferring an explicit summary
    key. If ingest also wrote there, that preference would be unobservable and
    'who claimed this number' would stop having an answer.
    """
    repo = tmp_path / ".cairn"
    with _run(repo) as run:
        for step in range(5):
            run.track(float(step), name="loss", step=step)
        run_id = run.id

    db, _ = _inspect(repo)
    try:
        assert _keys(db, "summary", run_id) == {}
    finally:
        db.close()


def test_neither_channel_creates_a_sequence(tmp_path):
    """The bug this exists to kill: a property rendering as a one-point plot."""
    repo = tmp_path / ".cairn"
    with _run(repo) as run:
        run.config(n_samples=1000)
        run.summary(final=0.5)
        run_id = run.id

    db, _ = _inspect(repo)
    try:
        (n,) = db.read_one(
            "SELECT COUNT(*) FROM sequences WHERE run_id = ?", [run_id]
        ) or (0,)
        assert n == 0
    finally:
        db.close()


def test_a_component_records_properties_under_its_scope_name(tmp_path):
    """`__cairn_track__` can now say 'property', not just 'metric'."""

    class Dataset:
        def __cairn_track__(self, scope):
            scope.config(n_samples=1000, augment=True)
            scope.summary(final_epoch_seen=7)

    class Model:
        def __init__(self):
            self.data = Dataset()

        def __cairn_track__(self, scope):
            scope.config(depth=12)
            scope.track(0.5, "rms")
            scope.track(self.data, "data")

    repo = tmp_path / ".cairn"
    with _run(repo) as run:
        run.track(Model(), "model", step=0)
        run_id = run.id

    db, _ = _inspect(repo)
    try:
        params = _keys(db, "params", run_id)
        assert params["model.depth"] == "12"
        assert params["model.data.n_samples"] == "1000"
        assert params["model.data.augment"] == "true"
        assert _keys(db, "summary", run_id) == {"model.data.final_epoch_seen": "7"}
        # ...and only the real metric became a series.
        names = {
            r["name"]
            for r in db.read_columns(
                "SELECT name FROM sequences WHERE run_id = ?", [run_id]
            )
        }
        assert names == {"model.rms"}
    finally:
        db.close()


def test_scope_nests_mappings_under_the_prefix(tmp_path):
    class Comp:
        def __cairn_track__(self, scope):
            scope.config(opt={"lr": 1e-3})

    repo = tmp_path / ".cairn"
    with _run(repo) as run:
        run.track(Comp(), "model", step=0)
        run_id = run.id

    db, _ = _inspect(repo)
    try:
        assert "model.opt.lr" in _keys(db, "params", run_id)
    finally:
        db.close()


def test_positional_args_must_be_mappings(tmp_path):
    repo = tmp_path / ".cairn"
    with _run(repo) as run:
        with pytest.raises(TypeError, match="run.summary"):
            run.summary("not a mapping")
        with pytest.raises(TypeError, match="run.config"):
            run.config("not a mapping")


def test_both_channels_refuse_writes_after_finish(tmp_path):
    repo = tmp_path / ".cairn"
    run = _run(repo)
    run.finish()
    with pytest.raises(RuntimeError):
        run.config(a=1)
    with pytest.raises(RuntimeError):
        run.summary(b=2)


def test_the_deprecated_item_setter_is_gone(tmp_path):
    """No backwards compatibility: `run[k] = v` is not an API any more."""
    repo = tmp_path / ".cairn"
    with _run(repo) as run:
        with pytest.raises(TypeError):
            run["lr"] = 3e-4


# --- the HTTP path -------------------------------------------------------
# Everything above runs through LocalTransport. The server route and the
# read-back are a separate limb and were once separately broken.


def _new_run(client) -> str:
    resp = client.post("/api/runs", json={"project": "split", "name": "r1"})
    assert resp.status_code == 200, resp.text
    return resp.json()["run_id"]


def test_summary_round_trips_over_http(client):
    run_id = _new_run(client)

    assert client.post(
        f"/api/runs/{run_id}/params", json={"params": {"lr": 3e-4}}
    ).status_code == 200
    assert client.post(
        f"/api/runs/{run_id}/summary", json={"summary": {"best_val": 0.91}}
    ).status_code == 200

    body = client.get(f"/api/runs/{run_id}").json()
    assert {p["key"]: p["value"] for p in body["params"]} == {"lr": "0.0003"}
    assert {s["key"]: s["value"] for s in body["summary"]} == {"best_val": "0.91"}


def test_summary_upserts_rather_than_duplicating(client):
    run_id = _new_run(client)
    client.post(f"/api/runs/{run_id}/summary", json={"summary": {"acc": 0.1}})
    client.post(f"/api/runs/{run_id}/summary", json={"summary": {"acc": 0.9}})

    body = client.get(f"/api/runs/{run_id}").json()
    assert [(s["key"], s["value"]) for s in body["summary"]] == [("acc", "0.9")]


def test_summary_for_an_unknown_run_is_a_404(client):
    resp = client.post(
        "/api/runs/deadbeef/summary", json={"summary": {"a": 1}}
    )
    assert resp.status_code == 404, resp.text


# --- WAL replay ----------------------------------------------------------
# A run that outlives its server writes ops to a WAL that is drained later.
# Nothing exercised cairn/server/wal_ingest.py before this, so an op the
# dispatcher does not know is dropped in silence.


def test_wal_replay_restores_both_channels(tmp_path):
    import json as _json

    from cairn.server import wal_ingest
    from cairn.server.storage.datadir import DataDir

    repo = tmp_path / ".cairn"
    repo.mkdir()
    data_dir = DataDir(repo)
    db = Database.open(repo / "cairn.db")   # .open() runs migrations; Database() does not
    blobs = BlobStore(repo / "blobs")

    wal_path = tmp_path / "run.wal"
    ops = [
        {"seq": 1, "op": "create_run", "payload": {"run_id": "r1", "project": "split"}},
        {"seq": 2, "op": "params", "payload": {"run_id": "r1", "params": {"lr": 3e-4}}},
        {"seq": 3, "op": "summary", "payload": {"run_id": "r1", "summary": {"acc": 0.9}}},
    ]
    wal_path.write_text("\n".join(_json.dumps(o) for o in ops) + "\n")

    try:
        processed = wal_ingest.ingest_wal(db, data_dir, blobs, wal_path)
        assert processed == 3
        assert _keys(db, "params", "r1") == {"lr": "0.0003"}
        assert _keys(db, "summary", "r1") == {"acc": "0.9"}
    finally:
        db.close()


# --- the read-time merge the run table uses ------------------------------


def _track(client, run_id, name, step, value):
    return client.post(
        f"/api/runs/{run_id}/batch",
        json={"points": [{
            "name": name, "step": step, "wall_time": "2026-01-01T00:00:00+00:00",
            "object_type": "scalar", "scalar_value": value,
        }]},
    )


def _values(client, run_id):
    runs = client.get("/api/runs").json()["runs"]
    return next(r["values"] for r in runs if r["id"] == run_id)


def test_the_run_table_shows_a_metrics_last_point(client):
    run_id = _new_run(client)
    for step, v in enumerate([3.0, 2.0, 1.0]):
        _track(client, run_id, "loss", step, v)
    assert _values(client, run_id) == {"loss": 1.0}


def test_an_explicit_summary_key_overrides_the_last_point(client):
    """The whole point of the split: a claim outranks a leftover.

    The series ends at 1.0 because that was the last epoch logged; the author
    says the result is 0.5 (best checkpoint, early stop, final eval). The table
    shows 0.5, and `summary` still records only what was declared.
    """
    run_id = _new_run(client)
    for step, v in enumerate([3.0, 2.0, 1.0]):
        _track(client, run_id, "loss", step, v)
    client.post(f"/api/runs/{run_id}/summary", json={"summary": {"loss": 0.5}})

    assert _values(client, run_id)["loss"] == 0.5
    # The override is a READ-time preference; storage still separates them.
    body = client.get(f"/api/runs/{run_id}").json()
    assert {s["key"]: s["value"] for s in body["summary"]} == {"loss": "0.5"}


def test_summary_only_keys_appear_as_columns_too(client):
    run_id = _new_run(client)
    client.post(f"/api/runs/{run_id}/summary", json={"summary": {"params_m": 7}})
    assert _values(client, run_id) == {"params_m": 7}


def test_a_run_with_nothing_logged_resolves_to_no_columns(client):
    assert _values(client, _new_run(client)) == {}


def test_values_do_not_bleed_between_runs(client):
    a, b = _new_run(client), _new_run(client)
    _track(client, a, "acc", 0, 0.1)
    client.post(f"/api/runs/{b}/summary", json={"summary": {"acc": 0.9}})
    assert _values(client, a) == {"acc": 0.1}
    assert _values(client, b) == {"acc": 0.9}


def test_non_scalar_sequences_are_not_table_columns(client):
    """An image tag is not a number; it must not become a sortable column."""
    run_id = _new_run(client)
    client.post(
        f"/api/runs/{run_id}/batch",
        json={"points": [{
            "name": "preview", "step": 0, "wall_time": "2026-01-01T00:00:00+00:00",
            "object_type": "image", "artifact_hash": None,
        }]},
    )
    assert "preview" not in _values(client, run_id)
