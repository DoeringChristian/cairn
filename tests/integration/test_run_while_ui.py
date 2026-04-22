"""Simultaneous `cairn ui` + SDK ``Run(repo=...)`` via HTTP handoff.

When a UI is serving a repo, a Run on the same repo should transparently
switch from ``LocalTransport`` to HTTP ``Transport`` against the UI's port.
"""

from __future__ import annotations

import json
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


@pytest.mark.slow
def test_run_joins_via_http_when_ui_is_serving(ui_subprocess):
    repo, port = ui_subprocess

    # The lock file should record host + port.
    lock = json.loads((repo / "repo.lock").read_text())
    assert lock["mode"] == "ui"
    assert lock["host"] == "127.0.0.1"
    assert lock["port"] == port

    # Now create a Run pointing at the SAME repo. It must NOT error; it
    # must pick up the UI's HTTP endpoint.
    with cairn.Run(
        project="coexist",
        repo=repo,
        capture_source=False,
        capture_stdout=False,
        capture_env=False,
        capture_system_metrics=False,
    ) as run:
        # run.url must be http://, not file:// — proof we took the HTTP path.
        assert run.url.startswith(f"http://127.0.0.1:{port}"), run.url
        for step in range(5):
            run.track(float(step), name="loss", step=step)
        run_id = run.id

    # The UI must see the run we just logged via its API.
    with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=5.0) as c:
        seq = c.get(f"/api/runs/{run_id}/sequences/loss").json()
        steps = sorted(p["step"] for p in seq["points"])
        assert steps == [0, 1, 2, 3, 4]
        detail = c.get(f"/api/runs/{run_id}").json()
        assert detail["run"]["status"] == "completed"


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
        assert run.url.startswith("file://"), run.url
        run.track(1.0, name="x", step=0)


@pytest.mark.slow
def test_hung_holder_produces_clear_error(tmp_path):
    """If the lock claims a UI at host:port but nothing answers, error out."""
    from cairn.server.storage.datadir import DataDir

    # Fake a lock file claiming a live-looking UI on a certainly-dead port.
    dd = DataDir(tmp_path / ".cairn")
    # Hand-write the lock so holder_is_live returns True (use current pid) but
    # the declared port has nobody listening.
    import os

    (tmp_path / ".cairn" / "repo.lock").write_text(
        json.dumps({
            "pid": os.getpid(),
            "mode": "ui",
            "host": "127.0.0.1",
            "port": 1,  # port 1 → connection refused
            "started_at": "2026-01-01T00:00:00Z",
        })
    )
    from cairn.server.storage.datadir import RepoLockedError

    with pytest.raises(RepoLockedError) as exc:
        cairn.Run(
            project="x",
            repo=tmp_path / ".cairn",
            capture_source=False,
            capture_stdout=False,
            capture_env=False,
            capture_system_metrics=False,
        )
    msg = str(exc.value)
    # Expect the friendly hint mentioning the URL and the lock path.
    assert "127.0.0.1:1" in msg or "hint" in exc.value.holder
