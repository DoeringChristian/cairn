"""Run progress: total_steps / run.progress through the local run log and
HTTP, the fraction from the highest logged step, the explicit override, the
ETA rule, the migration, and the integrations' totals."""

from __future__ import annotations

import json
import sqlite3
import sys
import types
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

import cairn
from cairn.server import progress
from cairn.server.storage.migrations import apply_migrations
from cairn.sdk.transport import Transport
from tests.conftest import ingest_repo

_RUN_KW = {
    "capture_source": False,
    "capture_stdout": False,
    "capture_env": False,
    "capture_system_metrics": False,
}


@pytest.fixture(autouse=True)
def _reset_capture_state():
    from cairn.sdk.capture import stdout as scap

    scap._active_run_id = None
    yield
    scap._active_run_id = None


def _iso(t: float) -> str:
    return datetime.fromtimestamp(t, timezone.utc).isoformat()


# ---- the ETA rule (pure) -------------------------------------------------------


def test_eta_needs_two_samples_over_min_span():
    s = progress.fold_sample([], 1000.0, 0)
    assert progress.eta_seconds(s, 0, 100) is None
    s = progress.fold_sample(s, 1005.0, 5)
    assert progress.eta_seconds(s, 5, 100) is None  # spans 5 s < MIN_SPAN
    s = progress.fold_sample(s, 1010.0, 10)
    # 10 steps in 10 s: 90 left -> 90 s.
    assert progress.eta_seconds(s, 10, 100) == pytest.approx(90.0)


def test_eta_none_without_increase_and_never_negative():
    s = [[0.0, 5], [20.0, 5]]
    assert progress.eta_seconds(s, 5, 10) is None
    s = [[0.0, 0], [20.0, 20]]
    assert progress.eta_seconds(s, 20, 10) == 0.0


def test_samples_spaced_windowed_and_monotonic():
    s: list = []
    for i in range(0, 1000):  # one sample every 0.5 s for 500 s
        s = progress.fold_sample(s, i * 0.5, i)
    times = [t for t, _ in s]
    assert times[-1] == 999 * 0.5
    # About SAMPLE_SPACING apart, and the window's oldest kept as the anchor.
    assert all(b - a <= progress.SAMPLE_SPACING + 0.5 for a, b in zip(times, times[1:]))
    assert times[1] > times[-1] - progress.WINDOW
    assert times[0] <= times[-1] - progress.WINDOW
    assert len(s) < 80  # bounded: about WINDOW / SAMPLE_SPACING
    # An older sample (a re-sent batch) is ignored.
    assert progress.fold_sample(s, 10.0, 5000) == s


def test_slow_steps_keep_an_anchor_outside_the_window():
    s: list = []
    for i in range(4):  # one step every 10 minutes
        s = progress.fold_sample(s, i * 600.0, i)
    assert len(s) == 2
    assert progress.eta_seconds(s, 3, 10) == pytest.approx(7 * 600.0)


def test_run_progress_shapes():
    base = {"status": "running", "total_steps": None, "max_step": 5, "step_samples": None,
            "progress_value": None, "progress_total": None, "progress_samples": None}
    assert progress.run_progress(base) is None
    p = progress.run_progress({**base, "total_steps": 10})
    assert p == {"fraction": 0.5, "current": 5, "total": 10, "unit": "step", "eta_seconds": None}
    # Explicit wins; its total defaults to total_steps.
    p = progress.run_progress({**base, "total_steps": 10, "progress_value": 2.0})
    assert p["unit"] == "progress" and p["current"] == 2 and p["total"] == 10
    p = progress.run_progress({**base, "total_steps": 10, "progress_value": 2.0,
                               "progress_total": 4.0})
    assert p["total"] == 4 and p["fraction"] == 0.5
    # Past the total: the fraction stops at 1.
    assert progress.run_progress({**base, "total_steps": 4})["fraction"] == 1.0
    # ETA only while running.
    samples = json.dumps([[0, 0], [60, 5]])
    running = progress.run_progress({**base, "total_steps": 10, "step_samples": samples})
    assert running["eta_seconds"] == pytest.approx(60.0)
    ended = progress.run_progress({**base, "status": "completed", "total_steps": 10,
                                   "step_samples": samples})
    assert ended["eta_seconds"] is None


# ---- migration -------------------------------------------------------------------


def test_migration_adds_progress_columns(tmp_path):
    con = sqlite3.connect(str(tmp_path / "old.db"))
    con.execute("CREATE TABLE runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, "
                "display_name TEXT, created_at TEXT NOT NULL, ended_at TEXT, status TEXT NOT NULL)")
    con.execute("INSERT INTO runs VALUES ('r', 'p', NULL, '2026-01-01', NULL, 'completed')")
    con.commit()
    apply_migrations(con)
    cols = {r[1] for r in con.execute("PRAGMA table_info(runs)")}
    assert set(progress.COLUMNS) <= cols
    assert con.execute("SELECT total_steps, max_step FROM runs").fetchone() == (None, None)
    apply_migrations(con)  # idempotent
    con.close()


# ---- local runs (the run log) ------------------------------------------------------


def _local_progress(repo, run_id):
    from cairn.sdk.local import RepoTransport
    from cairn.server.routes._common import api_run_row

    rt = RepoTransport(repo)
    try:
        rows = rt.under_lease(
            lambda db: db.read_columns("SELECT * FROM runs WHERE id = ?", [run_id]))
    finally:
        rt.close()
    return api_run_row(rows[0])["progress"]


def test_local_total_steps_from_max_logged_step(tmp_path):
    repo = tmp_path / ".cairn"
    with cairn.Run("p", repo=repo, total_steps=200, **_RUN_KW) as run:
        for s in range(50):
            run.track(float(s), "loss", s)
        run.track(1.0, "system.cpu", 10_000)  # sampler counters do not count
        run.track(1.0, "eval.acc", 59)
        assert run.total_steps == 200
    p = _local_progress(repo, run.id)
    assert p["unit"] == "step" and p["current"] == 59 and p["total"] == 200
    assert p["fraction"] == pytest.approx(59 / 200)
    assert p["eta_seconds"] is None  # ended


def test_local_total_steps_settable_and_clearable(tmp_path):
    repo = tmp_path / ".cairn"
    with cairn.Run("p", repo=repo, **_RUN_KW) as run:
        run.track(1.0, "loss", 9)
        run.total_steps = 10
    assert _local_progress(repo, run.id)["fraction"] == pytest.approx(0.9)
    with cairn.Run("p", repo=repo, **_RUN_KW) as run2:
        run2.total_steps = 10
        run2.total_steps = None
    assert _local_progress(repo, run2.id) is None


def test_local_explicit_progress_wins_and_defaults_total(tmp_path):
    repo = tmp_path / ".cairn"
    with cairn.Run("p", repo=repo, total_steps=1000, **_RUN_KW) as run:
        run.track(1.0, "loss", 500)
        run.progress(3)  # total: total_steps
    p = _local_progress(repo, run.id)
    assert (p["unit"], p["current"], p["total"]) == ("progress", 3, 1000)
    with cairn.Run("p", repo=repo, **_RUN_KW) as run2:
        run2.progress(1, total=5)
        run2.progress(2, total=5)  # within the throttle: held, sent at finish
    p = _local_progress(repo, run2.id)
    assert (p["unit"], p["current"], p["total"], p["fraction"]) == ("progress", 2, 5, 0.4)


def test_progress_validation(tmp_path):
    with cairn.Run("p", repo=tmp_path / ".cairn", **_RUN_KW) as run:
        with pytest.raises(ValueError):
            run.total_steps = 0
        with pytest.raises(ValueError):
            run.total_steps = 2.5  # type: ignore[assignment]
        with pytest.raises(ValueError):
            run.progress(-1)
        with pytest.raises(ValueError):
            run.progress(1, total=0)
    with pytest.raises(ValueError):
        cairn.Run("p", repo=tmp_path / ".cairn", total_steps=-3, **_RUN_KW)


def test_local_eta_from_point_wall_times(tmp_path):
    """Points carry the client's wall time; the ETA comes from them."""
    from cairn.server import ingest_ops
    from cairn.server.storage.db import Database

    db = Database.open(tmp_path / "db.sqlite")
    ingest_ops.create_run(db, project="p", run_id="r")
    ingest_ops.set_total_steps(db, "r", 1000)
    t0 = 1_700_000_000.0
    for i in range(0, 61):  # one point per second, step = i * 2
        ingest_ops.insert_batch(db, "r", [{
            "name": "loss", "step": i * 2, "wall_time": _iso(t0 + i),
            "object_type": "scalar", "scalar_value": 1.0,
        }])
    row = db.read_columns("SELECT * FROM runs WHERE id = 'r'")[0]
    p = progress.run_progress(row)
    # 2 steps/s; 1000 - 120 = 880 left -> 440 s.
    assert p["current"] == 120 and p["eta_seconds"] == pytest.approx(440.0)
    # Rewind recomputes the highest step and drops the samples.
    ingest_ops.rewind_run(db, "r", 50)
    row = db.read_columns("SELECT * FROM runs WHERE id = 'r'")[0]
    p = progress.run_progress(row)
    assert p["current"] == 50 and p["eta_seconds"] is None
    db.close()


def test_explicit_progress_eta(tmp_path):
    from cairn.server import ingest_ops
    from cairn.server.storage.db import Database

    db = Database.open(tmp_path / "db.sqlite")
    ingest_ops.create_run(db, project="p", run_id="r")
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    for epoch in range(1, 4):  # one epoch per minute
        ingest_ops.set_progress(db, "r", epoch, 10, (t0 + timedelta(minutes=epoch)).isoformat())
    p = progress.run_progress(db.read_columns("SELECT * FROM runs WHERE id = 'r'")[0])
    assert p["unit"] == "progress" and p["fraction"] == pytest.approx(0.3)
    assert p["eta_seconds"] == pytest.approx(7 * 60.0)
    db.close()


def test_progress_ops_are_exactly_once(tmp_path):
    """Records of the new ops are applied with the rest of the log, once."""
    repo = tmp_path / ".cairn"
    with cairn.Run("p", repo=repo, total_steps=10, **_RUN_KW) as run:
        run.track(1.0, "loss", 4)
        ingest_repo(repo)
        ingest_repo(repo)
        run.progress(1, total=2)
    ingest_repo(repo)
    ingest_repo(repo)
    p = _local_progress(repo, run.id)
    assert (p["current"], p["total"]) == (1, 2)


def test_disabled_run_accepts_progress():
    run = cairn.Run("p", mode="disabled", total_steps=5)
    run.total_steps = 7
    run.progress(3, total=4)
    assert run.total_steps == 7
    run.finish()


# ---- over HTTP --------------------------------------------------------------------


def test_http_total_steps_and_progress(live_server):
    import httpx

    t = Transport(live_server, max_retries=1, backoff_base=0.001, backoff_cap=0.001)
    run = cairn.Run("p", transport=t, total_steps=100, **_RUN_KW)
    for s in range(25):
        run.track(0.5, "loss", s)
    run.finish()
    run2 = cairn.Run("p", transport=t, **_RUN_KW)
    run2.progress(3, total=12)
    with httpx.Client(base_url=live_server) as c:
        p = c.get(f"/api/runs/{run.id}").json()["run"]["progress"]
        assert (p["unit"], p["current"], p["total"]) == ("step", 24, 100)
        listed = {r["id"]: r for r in c.get("/api/runs", params={"project": "p"}).json()["runs"]}
        assert listed[run.id]["progress"]["fraction"] == pytest.approx(0.24)
        p2 = listed[run2.id]["progress"]
        assert (p2["unit"], p2["current"], p2["total"]) == ("progress", 3, 12)
        assert "total_steps" not in listed[run2.id]
        r = c.post(f"/api/runs/{run2.id}/total-steps", json={"total_steps": 0})
        assert r.status_code == 400
        r = c.post(f"/api/runs/{run2.id}/progress", json={"value": -1})
        assert r.status_code == 400
        assert c.post("/api/runs/nope/progress", json={"value": 1}).status_code == 404
    run2.finish()
    t.close()


# ---- integrations ------------------------------------------------------------------


def test_hf_sets_total_steps_from_max_steps():
    pytest.importorskip("transformers")
    from cairn.integrations.huggingface import CairnCallback

    run = MagicMock()
    cb = CairnCallback(run=run)
    args = SimpleNamespace(output_dir="out", to_dict=lambda: {})
    cb.on_train_begin(args, SimpleNamespace(max_steps=321), None)
    assert run.total_steps == 321


def test_lightning_sets_total_from_estimated_stepping_batches():
    try:
        from cairn.integrations.lightning import CairnLogger
    except ImportError:
        pytest.skip("lightning unavailable")
    run = MagicMock()
    logger = CairnLogger(run=run)
    trainer = SimpleNamespace(state=SimpleNamespace(fn="fit"), estimated_stepping_batches=480)
    logger.log_graph(SimpleNamespace(_trainer=trainer))
    assert run.total_steps == 480
    run2 = MagicMock()
    logger2 = CairnLogger(run=run2)
    endless = SimpleNamespace(state=SimpleNamespace(fn="fit"),
                              estimated_stepping_batches=float("inf"))
    logger2.log_graph(SimpleNamespace(_trainer=endless))
    testing = SimpleNamespace(state=SimpleNamespace(fn="test"), estimated_stepping_batches=9)
    logger2.log_graph(SimpleNamespace(_trainer=testing))
    assert not isinstance(run2.total_steps, int)  # never set


def test_keras_reports_epochs_as_progress():
    import os

    os.environ.setdefault("KERAS_BACKEND", "torch")
    try:
        from cairn.integrations.keras import CairnCallback
    except Exception as exc:  # noqa: BLE001 - Keras without a backend
        pytest.skip(f"keras unavailable: {exc}")
    run = MagicMock()
    cb = CairnCallback(run=run)
    cb.params = {"epochs": 5, "steps": 3}
    cb.on_epoch_end(1, {"loss": 0.5})
    run.progress.assert_called_once_with(2, total=5)


def test_ultralytics_reports_epochs_as_progress(monkeypatch):
    monkeypatch.delitem(sys.modules, "cairn.integrations.ultralytics", raising=False)
    pkg, utils = types.ModuleType("ultralytics"), types.ModuleType("ultralytics.utils")
    utils.RANK = -1
    pkg.utils = utils
    monkeypatch.setitem(sys.modules, "ultralytics", pkg)
    monkeypatch.setitem(sys.modules, "ultralytics.utils", utils)
    import cairn.integrations.ultralytics as mod

    try:
        cbs = mod.CairnCallbacks()
        cbs.run = MagicMock()
        trainer = SimpleNamespace(epoch=2, epochs=10, tloss=[1.0],
                                  label_loss_items=lambda tloss, prefix: {"train/l": 1.0},
                                  lr={"lr/pg0": 0.1})
        cbs.on_train_epoch_end(trainer)
        cbs.run.progress.assert_called_once_with(3, total=10)
    finally:
        sys.modules.pop("cairn.integrations.ultralytics", None)
