"""End-to-end Run tests against a live uvicorn server in a thread."""

from __future__ import annotations

import pytest
from PIL import Image as PILImage

import cairn


@pytest.fixture(autouse=True)
def _reset_cairn_state():
    from cairn.sdk.capture import stdout as scap

    scap._active_run_id = None
    yield
    scap._active_run_id = None


@pytest.fixture
def server(live_server):
    """The run's server (its records reach it at every group commit)."""
    return live_server


@pytest.fixture
def reader(live_server):
    import httpx

    with httpx.Client(base_url=live_server, timeout=10.0) as c:
        yield c


def test_basic_run_lifecycle(server, reader):
    run = cairn.Run(
        project="test-proj",
        name="r1",
        capture_source=False,
        capture_stdout=False,
        capture_env=False,
        capture_system_metrics=False,
        server=server,
    )
    try:
        run.config(hparams={"lr": 0.01, "batch": 32})
        for i in range(20):
            run.track(float(i), name="loss", step=i)
        run.track(0.1, name="acc", step=0)
        run.track(0.2, name="acc", step=1)
    finally:
        run.finish()

    run_data = reader.get(f"/api/runs/{run.id}").json()
    assert run_data["run"]["status"] == "completed"
    keys = {p["key"] for p in run_data["params"]}
    assert "hparams.lr" in keys
    assert "hparams.batch" in keys
    seqs = reader.get(f"/api/runs/{run.id}/sequences").json()["sequences"]
    names = {s["name"] for s in seqs}
    assert names == {"loss", "acc"}
    loss_pts = reader.get(f"/api/runs/{run.id}/sequences/loss").json()["points"]
    assert len(loss_pts) == 20
    acc_pts = reader.get(f"/api/runs/{run.id}/sequences/acc").json()["points"]
    assert [p["step"] for p in acc_pts] == [0, 1]


def test_track_image_uploads_artifact(server, reader):
    run = cairn.Run(
        project="p",
        capture_source=False,
        capture_stdout=False,
        capture_env=False,
        capture_system_metrics=False,
        server=server,
    )
    try:
        img = PILImage.new("RGB", (4, 4), (0, 128, 255))
        run.track(img, name="preview", step=0)
    finally:
        run.finish()
    points = reader.get(f"/api/runs/{run.id}/sequences/preview").json()["points"]
    assert points[0]["artifact_hash"] and points[0]["object_type"] == "image"


def test_context_manager_records_failed_on_exception(server, reader):
    with pytest.raises(RuntimeError):
        with cairn.Run(
            project="p",
            capture_source=False,
            capture_stdout=False,
            capture_env=False,
            capture_system_metrics=False,
            server=server,
        ) as run:
            run_id = run.id
            run.track(0.1, name="loss", step=0)
            raise RuntimeError("boom")
    status = reader.get(f"/api/runs/{run_id}").json()["run"]["status"]
    assert status == "failed"


def test_independent_explicit_runs_are_supported(server):
    # Each run owns its lifecycle when stdout capture is disabled.
    kwargs = dict(capture_source=False, capture_stdout=False, capture_env=False,
                  capture_system_metrics=False, server=server)
    with cairn.Run("p", **kwargs) as first, cairn.Run("p", **kwargs) as second:
        first.log({"loss": 1.0})
        second.log({"loss": 2.0})
        assert first.id != second.id


def test_log_artifact(server, reader):
    run = cairn.Run(
        project="p",
        capture_source=False,
        capture_stdout=False,
        capture_env=False,
        capture_system_metrics=False,
        server=server,
    )
    try:
        version = run.log_artifact(cairn.Text("hello world" * 200), "readme")
        # Numbered by the server once the record is uploaded.
        version.wait(timeout=10)
        assert (version.ref, version.aliases) == ("readme:v1", ["latest"])
    finally:
        run.finish()
    outputs = reader.get(f"/api/runs/{run.id}/outputs").json()["outputs"]
    assert [o["name"] for o in outputs] == ["readme"]


def test_tags_and_notes(server, reader):
    run = cairn.Run(
        project="p",
        capture_source=False,
        capture_stdout=False,
        capture_env=False,
        capture_system_metrics=False,
        server=server,
    )
    try:
        run.set_tags(["exp", "ablation"])
        run.add_note("test run")
    finally:
        run.finish()
    import json

    row = reader.get(f"/api/runs/{run.id}").json()["run"]
    assert json.loads(row["tags"]) == ["exp", "ablation"]
    assert row["notes"] == "test run"


def test_prefixed_names_are_separate_series(server, reader):
    run = cairn.Run(
        project="p",
        capture_source=False,
        capture_stdout=False,
        capture_env=False,
        capture_system_metrics=False,
        server=server,
    )
    try:
        for i in range(3):
            run.track(1.0, name="loss", step=i)
            run.track(2.0, name="val.loss", step=i)
    finally:
        run.finish()
    seqs = reader.get(f"/api/runs/{run.id}/sequences").json()["sequences"]
    by_name = {s["name"]: s for s in seqs}
    assert set(by_name) == {"loss", "val.loss"}
    assert len(seqs) == 2
    assert set(by_name["loss"]) == {"name", "object_type", "min_step", "max_step", "count", "monotonic"}
    assert by_name["loss"]["count"] == by_name["val.loss"]["count"] == 3
