"""A real `cairn ui` process serving a repo while SDK runs log to it.

The UI holds the repo's ingest lease (with its URL) and ingests the runs'
logs every ~2 s; a run keeps writing its own log. What needs an answer now
(use_artifact, a version number, resume, sweep claims) goes to the UI.
"""

from __future__ import annotations

import json
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest

import cairn

REPO_ROOT = Path(__file__).resolve().parents[2]


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_ready(url: str, timeout: float = 10.0) -> bool:
    deadline = time.time() + timeout
    with httpx.Client(timeout=1.0) as c:
        while time.time() < deadline:
            try:
                if c.get(url).status_code == 200:
                    return True
            except (httpx.HTTPError, OSError):
                pass
            time.sleep(0.1)
    return False


@pytest.fixture(autouse=True)
def _reset_capture_state():
    from cairn.sdk.capture import stdout as scap

    scap._active_run_id = None
    yield
    scap._active_run_id = None


@pytest.fixture
def ui_subprocess(tmp_path):
    """Start `cairn ui --repo tmp/.cairn` in a subprocess; yield (repo, port)."""
    # Init the repo so UI has schema to read.
    subprocess.check_call(
        [sys.executable, "-m", "cairn", "init", str(tmp_path)],
        cwd=str(REPO_ROOT),
    )
    repo = tmp_path / ".cairn"
    port = _free_port()
    proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "cairn",
            "ui",
            "--repo",
            str(repo),
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--no-open-browser",
        ],
        cwd=str(REPO_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    try:
        if not _wait_ready(f"http://127.0.0.1:{port}/api/health"):
            proc.kill()
            pytest.fail("cairn ui never became ready")
        yield repo, port
    finally:
        proc.send_signal(signal.SIGINT)
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)


def _client(repo, port):
    token = (repo / "auth" / "local.token").read_text().strip()
    return httpx.Client(
        base_url=f"http://127.0.0.1:{port}", timeout=5.0,
        headers={"Authorization": f"Bearer {token}"},
    )


QUIET = {"capture_source": False, "capture_stdout": False, "capture_env": False,
         "capture_system_metrics": False}


@pytest.mark.slow
def test_run_logs_while_ui_ingests(ui_subprocess):
    from cairn.sdk.local import LocalTransport
    from cairn.server.storage import lease as lease_mod

    repo, port = ui_subprocess
    lease = lease_mod.read_lease(repo.resolve())
    assert (lease["mode"], lease["url"]) == ("ui", f"http://127.0.0.1:{port}")
    assert lease_mod.serving_holder(repo.resolve()) is not None

    with cairn.Run(project="coexist", repo=repo, **QUIET) as run:
        assert isinstance(run._transport, LocalTransport)  # its own log
        assert run.url.startswith(f"http://localhost:{port}/"), run.url
        for step in range(5):
            run.track(float(step), name="loss", step=step)
        run_id = run.id
        log = repo / "wals" / f"{run_id}.wal.jsonl"
        assert log.exists()

    # The UI ingests the log within its ~2 s cycle, then deletes it.
    t0 = time.monotonic()
    with _client(repo, port) as c:
        while True:
            detail = c.get(f"/api/runs/{run_id}")
            if detail.status_code == 200 and detail.json()["run"]["status"] == "completed":
                break
            assert time.monotonic() - t0 < 10, "not ingested within 10 s"
            time.sleep(0.05)
        seq = c.get(f"/api/runs/{run_id}/sequences/loss").json()
        assert sorted(p["step"] for p in seq["points"]) == [0, 1, 2, 3, 4]
    assert time.monotonic() - t0 < 4.5
    deadline = time.monotonic() + 5
    while log.exists():
        assert time.monotonic() < deadline, "finished log not deleted"
        time.sleep(0.05)


@pytest.mark.slow
def test_answers_now_go_through_the_ui(ui_subprocess):
    """use_artifact, log_artifact(...).wait(), resume, fork and sweep claims
    on a served repo: the UI answers (this process never writes SQLite)."""
    repo, _port = ui_subprocess
    with cairn.Run(project="ans", repo=repo, **QUIET) as run:
        v = run.log_artifact(b"weights", "ckpt", aliases=["best"])
        assert v.pending
        assert v.wait(timeout=15).version == 1
        assert run.use_artifact("ckpt:best").id == v.id
        run.track(1.0, "loss", step=0)
        parent = run.id
    with cairn.Run(project="ans", repo=repo, resume=parent, **QUIET) as run:
        run.track(2.0, "loss", step=1)
    with cairn.Run(project="ans", repo=repo, fork_from=(parent, 0), **QUIET) as kid:
        kid_id = kid.id
    # Grid, not the default random: random may draw x=2 twice (each trial
    # samples independently), and then the best value is not 1.
    sw = cairn.sweep({"x": {"values": [1, 2]}}, project="ans", repo=repo, method="grid")
    sw.run(lambda config: float(config["x"]), count=2)
    info = sw.info()
    assert info["trial_count"] == 2 and info["best"]["value"] == 1.0
    with cairn.Reader(repo) as reader:
        deadline = time.monotonic() + 10
        while True:
            try:
                back = reader.run(parent)
                done = back.status == "completed" and reader.run(kid_id).status == "completed"
            except KeyError:
                done = False
            if done:
                break
            assert time.monotonic() < deadline
            time.sleep(0.1)
        assert [r.id for r in reader.artifact("ckpt:best", project="ans").used_by()] == [parent]


@pytest.mark.slow
def test_run_without_ui_uses_local_transport(tmp_path):
    """Inverse: with no UI running, Run should still use LocalTransport."""
    subprocess.check_call(
        [sys.executable, "-m", "cairn", "init", str(tmp_path)],
        cwd=str(REPO_ROOT),
    )
    repo = tmp_path / ".cairn"
    with cairn.Run(
        project="solo",
        repo=repo,
        capture_source=False,
        capture_stdout=False,
        capture_env=False,
        capture_system_metrics=False,
    ) as run:
        from cairn.sdk.local import LocalTransport

        assert isinstance(run._transport, LocalTransport)
        run.track(1.0, name="x", step=0)


@pytest.mark.slow
def test_hung_holder_produces_clear_error(tmp_path):
    """A lease naming a live server whose URL does not answer: the run still
    logs, and an answer it needs fails with a clear error naming the URL."""
    from cairn.sdk.local import ServerUnreachable
    from cairn.server.storage import lease as lease_mod
    from cairn.server.storage.datadir import DataDir

    dd = DataDir(tmp_path / ".cairn")
    lease_mod.lease_path(dd.root).write_text(json.dumps({
        "host": lease_mod.hostname(), "pid": os.getppid(), "token": "t" * 32,
        "mode": "ui", "url": "http://127.0.0.1:1", "expires_at": time.time() + 60,
    }))
    with cairn.Run(project="x", repo=dd.root, **QUIET) as run:
        run.track(1.0, "loss", step=0)
        with pytest.raises(ServerUnreachable, match="127.0.0.1:1"):
            run.use_artifact("anything")
