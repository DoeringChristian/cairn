"""A local repo's server (0.6 spec §5): started on demand as a real daemon
(``cairn server --daemon``), registered in ``<repo>/server.json``, reused,
alone per repo, and gone after its idle timeout."""

from __future__ import annotations

import os
import stat
import subprocess
import sys
import time

import httpx
import psutil
import pytest

import cairn
from cairn.endpoint import live_server, local_endpoint, resolve_endpoint
from cairn.server.registration import read_info

pytestmark = pytest.mark.real_daemons

QUIET = dict(capture_source=False, capture_stdout=False, capture_env=False,
             capture_system_metrics=False)


def _stop(root) -> None:
    ep = live_server(root)
    if ep is None:
        return
    pid = read_info(root)["pid"]
    with ep.client() as c:
        c.post("/api/server/shutdown")
    _wait_gone(root, pid)


def _wait_gone(root, pid: int, timeout: float = 15.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if read_info(root, live_only=False) is None and not psutil.pid_exists(pid):
            return
        time.sleep(0.05)
    raise AssertionError(f"the daemon server (pid {pid}) of {root} did not exit")


@pytest.fixture
def repo(tmp_path, monkeypatch):
    for var in ("CAIRN_REPO", "CAIRN_SERVER", "CAIRN_TOKEN"):
        monkeypatch.delenv(var, raising=False)
    root = tmp_path / ".cairn"
    yield root
    _stop(root)


def test_daemon_starts_registers_and_is_reused(repo):
    ep = local_endpoint(repo)
    info = read_info(repo)
    assert info["daemon"] is True and info["pid"] != os.getpid()
    assert info["url"] == ep.url and ep.url.startswith("http://127.0.0.1:")
    assert stat.S_IMODE((repo / "server.json").stat().st_mode) == 0o600
    # Auth is on, with the repo's same-user token.
    assert ep.token and info["token"] == ep.token
    assert httpx.get(f"{ep.url}/api/projects").status_code == 401
    assert httpx.get(f"{ep.url}/api/projects", headers=ep.headers()).status_code == 200
    # Found again, not started again.
    assert local_endpoint(repo) == ep
    assert resolve_endpoint(repo=str(repo)).url == ep.url


def test_reader_and_cli_go_through_the_daemon(repo, monkeypatch, tmp_path):
    from click.testing import CliRunner

    from cairn import cli

    with cairn.Run("proj", name="r", repo=str(repo), **QUIET) as run:
        run.track(1.0, "loss", step=0)
        rid = run.id
    with cairn.Reader(repo=str(repo)) as r:
        assert r.run(rid).name == "r"
        assert r.run(rid).sequence("loss").values == [1.0]
    assert live_server(repo) is not None
    result = CliRunner().invoke(cli.main, ["list", "--project", "proj", "--repo", str(repo)])
    assert result.exit_code == 0 and rid[:8] in result.output


def test_one_server_per_repo(repo):
    local_endpoint(repo)
    proc = subprocess.run(
        [sys.executable, "-m", "cairn", "server", "--repo", str(repo), "--port", "0"],
        capture_output=True, text=True, timeout=60, env={**os.environ, "BROWSER": "true"},
    )
    assert proc.returncode != 0
    assert "already served" in (proc.stderr + proc.stdout)


def test_idle_daemon_exits(tmp_path, monkeypatch):
    for var in ("CAIRN_REPO", "CAIRN_SERVER", "CAIRN_TOKEN"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("CAIRN_SERVER_IDLE_TIMEOUT", "1")
    root = tmp_path / ".cairn"
    local_endpoint(root)
    pid = read_info(root)["pid"]
    _wait_gone(root, pid, timeout=20)
    # Started again on the next use.
    monkeypatch.setenv("CAIRN_SERVER_IDLE_TIMEOUT", "60")
    try:
        assert local_endpoint(root).url
        assert read_info(root)["pid"] != pid
    finally:
        _stop(root)


def test_a_dead_registration_is_replaced(repo):
    local_endpoint(repo)
    pid = read_info(repo)["pid"]
    os.kill(pid, 9)
    deadline = time.monotonic() + 10
    while psutil.pid_exists(pid) and time.monotonic() < deadline:
        time.sleep(0.05)
    ep = local_endpoint(repo)
    assert read_info(repo)["pid"] != pid
    with ep.client() as c:
        assert c.get("/api/projects").status_code == 200


def test_shutdown_is_for_daemons_only(client):
    assert client.post("/api/server/shutdown").status_code == 409
