"""End-to-end Run tests against a live uvicorn server in a thread."""

from __future__ import annotations

import pytest
from PIL import Image as PILImage

import cairn
from cairn.sdk.transport import Transport


@pytest.fixture(autouse=True)
def _reset_cairn_state():
    from cairn.sdk.capture import stdout as scap

    scap._active_run_id = None
    yield
    scap._active_run_id = None


@pytest.fixture
def transport(live_server):
    t = Transport(live_server, max_retries=1, backoff_base=0.001, backoff_cap=0.001)
    yield t
    t.close()


@pytest.fixture
def reader(live_server):
    import httpx

    with httpx.Client(base_url=live_server, timeout=10.0) as c:
        yield c


def test_basic_run_lifecycle(transport, reader):
    run = cairn.Run(
        project="test-proj",
        name="r1",
        capture_source=False,
        capture_stdout=False,
        capture_env=False,
        capture_system_metrics=False,
        transport=transport,
    )
    try:
        run["hparams"] = {"lr": 0.01, "batch": 32}
        for i in range(20):
            run.track(float(i), name="loss", step=i)
        run.track(0.1, name="acc")
        run.track(0.2, name="acc")
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


def test_track_image_uploads_artifact(transport, reader):
    run = cairn.Run(
        project="p",
        capture_source=False,
        capture_stdout=False,
        capture_env=False,
        capture_system_metrics=False,
        transport=transport,
    )
    try:
        img = PILImage.new("RGB", (4, 4), (0, 128, 255))
        run.track(img, name="preview", step=0)
    finally:
        run.finish()
    arts = reader.get(f"/api/runs/{run.id}/artifacts").json()
    assert any(a["name"] == "preview" for a in arts["from_sequences"])


def test_context_manager_records_failed_on_exception(transport, reader):
    with pytest.raises(RuntimeError):
        with cairn.Run(
            project="p",
            capture_source=False,
            capture_stdout=False,
            capture_env=False,
            capture_system_metrics=False,
            transport=transport,
        ) as run:
            run_id = run.id
            run.track(0.1, name="loss", step=0)
            raise RuntimeError("boom")
    status = reader.get(f"/api/runs/{run_id}").json()["run"]["status"]
    assert status == "failed"


def test_nested_run_raises(transport):
    run = cairn.Run(
        project="p",
        capture_source=False,
        capture_stdout=False,
        capture_env=False,
        capture_system_metrics=False,
        transport=transport,
    )
    try:
        with pytest.raises(RuntimeError, match="Nested"):
            cairn.Run(
                project="p",
                capture_source=False,
                capture_stdout=False,
                capture_env=False,
                capture_system_metrics=False,
                transport=transport,
            )
    finally:
        run.finish()


def test_log_artifact(transport, reader):
    run = cairn.Run(
        project="p",
        capture_source=False,
        capture_stdout=False,
        capture_env=False,
        capture_system_metrics=False,
        transport=transport,
    )
    try:
        digest = run.log_artifact(
            cairn.Text("hello world" * 200),
            name="readme",
        )
        assert len(digest) == 64
    finally:
        run.finish()
    arts = reader.get(f"/api/runs/{run.id}/artifacts").json()
    assert any(a["name"] == "readme" for a in arts["named"])


def test_tags_and_notes(transport, reader):
    run = cairn.Run(
        project="p",
        capture_source=False,
        capture_stdout=False,
        capture_env=False,
        capture_system_metrics=False,
        transport=transport,
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


def test_context_separates_series(transport, reader):
    run = cairn.Run(
        project="p",
        capture_source=False,
        capture_stdout=False,
        capture_env=False,
        capture_system_metrics=False,
        transport=transport,
    )
    try:
        for i in range(3):
            run.track(1.0, name="loss", step=i)
            run.track(2.0, name="loss", step=i, context={"subset": "val"})
    finally:
        run.finish()
    seqs = reader.get(f"/api/runs/{run.id}/sequences").json()["sequences"]
    loss_seqs = [s for s in seqs if s["name"] == "loss"]
    assert len(loss_seqs) == 2
