"""End-to-end Run tests in LOCAL mode — no server involved.

The SDK writes straight to ./.cairn/cairn.db via LocalTransport.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image as PILImage

import cairn
from cairn.server.storage.blobs import BlobStore
from cairn.server.storage.datadir import DataDir, RepoLockedError
from cairn.server.storage.db import Database


@pytest.fixture(autouse=True)
def _reset_capture_state():
    from cairn.sdk.capture import stdout as scap

    scap._active_run_id = None
    yield
    scap._active_run_id = None


def _inspect(repo: Path):
    """Open the repo read-only-ish to verify what was written, after the Run is closed."""
    # Repo must be unlocked at this point.
    db = Database.open(DataDir(repo).db_path)
    blobs = BlobStore(DataDir(repo).artifacts_dir)
    return db, blobs


def test_local_run_full_lifecycle(tmp_path):
    repo = tmp_path / ".cairn"
    with cairn.Run(
        project="local-demo",
        task="smoke",
        name="local-r1",
        repo=repo,
        capture_source=False,
        capture_stdout=False,
        capture_env=False,
        capture_system_metrics=False,
    ) as run:
        run["hparams"] = {"lr": 3e-4, "batch": 16}
        for step in range(5):
            run.track(float(step) * 0.5, name="loss", step=step)
            run.track(float(step) * 0.6, name="loss", step=step, context={"subset": "val"})
        # Image
        img = PILImage.new("RGB", (4, 4), (255, 0, 0))
        run.track(img, name="preview", step=0)
        # Named artifact via log_artifact
        run.log_artifact(cairn.Text("a" * 2000), name="generation")
        run_id = run.id
        # url should be a file:// URL, not http://
        assert run.url.startswith("file://")

    # After close, verify state directly in the DB.
    db, blobs = _inspect(repo)
    try:
        # Run row, completed
        row = db.read_columns("SELECT * FROM runs WHERE id = ?", [run_id])[0]
        assert row["status"] == "completed"
        # Params were flattened
        keys = {p["key"] for p in db.read_columns(
            "SELECT key FROM params WHERE run_id = ?", [run_id]
        )}
        assert "hparams.lr" in keys
        assert "hparams.batch" in keys
        # Scalars
        (count,) = db.read_one(
            "SELECT COUNT(*) FROM sequences WHERE run_id = ? AND name = 'loss'",
            [run_id],
        )
        assert count == 10  # 5 steps × 2 contexts
        # Image artifact
        (imgcount,) = db.read_one(
            "SELECT COUNT(*) FROM sequences WHERE run_id = ? AND name = 'preview'",
            [run_id],
        )
        assert imgcount == 1
        # Named artifact
        (named_count,) = db.read_one(
            "SELECT COUNT(*) FROM run_artifacts WHERE run_id = ? AND name = 'generation'",
            [run_id],
        )
        assert named_count == 1
        # Blobs on disk
        assert len(list(blobs.root.rglob("blob"))) >= 2
    finally:
        db.close()


def test_local_run_releases_lock_on_finish(tmp_path):
    repo = tmp_path / ".cairn"
    with cairn.Run(
        project="x", task="y", repo=repo,
        capture_source=False, capture_stdout=False,
        capture_env=False, capture_system_metrics=False,
    ):
        pass
    # Lock file should be gone, and a fresh run can be started.
    with cairn.Run(
        project="x", task="y", repo=repo,
        capture_source=False, capture_stdout=False,
        capture_env=False, capture_system_metrics=False,
    ):
        pass


def test_second_run_while_first_active_raises(tmp_path):
    repo = tmp_path / ".cairn"
    run1 = cairn.Run(
        project="x", task="y", repo=repo,
        capture_source=False, capture_stdout=False,
        capture_env=False, capture_system_metrics=False,
    )
    try:
        # Note: nested-run guard in stdout_capture triggers first even before
        # lock contention would. Either error is acceptable for the user.
        with pytest.raises((RepoLockedError, RuntimeError)):
            cairn.Run(
                project="x", task="y", repo=repo,
                capture_source=False, capture_stdout=False,
                capture_env=False, capture_system_metrics=False,
            )
    finally:
        run1.finish()


def test_local_mode_uses_env_var(tmp_path, monkeypatch):
    repo = tmp_path / ".cairn"
    monkeypatch.setenv("CAIRN_REPO", str(repo))
    monkeypatch.delenv("CAIRN_SERVER", raising=False)
    with cairn.Run(
        project="x", task="y",
        capture_source=False, capture_stdout=False,
        capture_env=False, capture_system_metrics=False,
    ) as run:
        run.track(0.5, name="loss", step=0)
        rid = run.id

    # Verify it wrote to repo, not some other location.
    db, _ = _inspect(repo)
    try:
        (count,) = db.read_one("SELECT COUNT(*) FROM runs WHERE id = ?", [rid])
        assert count == 1
    finally:
        db.close()
