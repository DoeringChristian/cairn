"""Tests for the `cairn ui` and dual-server `cairn server` commands."""

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
from click.testing import CliRunner

from cairn import cli

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


@pytest.fixture
def fresh_repo(tmp_path):
    repo = tmp_path / ".cairn"
    # init via the CLI so we know the shape is right.
    subprocess.check_call(
        [sys.executable, "-m", "cairn", "init", str(tmp_path)],
        cwd=str(REPO_ROOT),
    )
    assert (repo / "cairn.db").exists()
    return repo


@pytest.mark.slow
def test_cairn_server_with_ui_starts_both_ports(fresh_repo: Path):
    ingest_port = _free_port()
    ui_port = _free_port()
    # Avoid collision if _free_port happened to pick the same port twice.
    while ui_port == ingest_port:
        ui_port = _free_port()
    proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "cairn",
            "server",
            "--repo",
            str(fresh_repo),
            "--host",
            "127.0.0.1",
            "--port",
            str(ingest_port),
            "--ui-port",
            str(ui_port),
            "--ui",
        ],
        cwd=str(REPO_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    try:
        assert _wait_ready(f"http://127.0.0.1:{ingest_port}/api/health"), (
            "ingest server never became ready"
        )
        assert _wait_ready(f"http://127.0.0.1:{ui_port}/api/health"), (
            "UI server never became ready"
        )
        # Ingest root serves the distinct placeholder, not the SPA.
        with httpx.Client(timeout=2.0) as c:
            r = c.get(f"http://127.0.0.1:{ingest_port}/")
            assert r.json()["status"] == "ingest"
            # UI root may return JSON (no bundle) or HTML (bundle present).
            r2 = c.get(f"http://127.0.0.1:{ui_port}/")
            assert r2.status_code == 200
    finally:
        proc.send_signal(signal.SIGINT)
        proc.wait(timeout=10)


@pytest.mark.slow
def test_cairn_server_defaults_to_ingest_only(fresh_repo: Path):
    ingest_port = _free_port()
    unused_ui_port = _free_port()
    while unused_ui_port == ingest_port:
        unused_ui_port = _free_port()
    proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "cairn",
            "server",
            "--repo",
            str(fresh_repo),
            "--host",
            "127.0.0.1",
            "--port",
            str(ingest_port),
            "--ui-port",
            str(unused_ui_port),
        ],
        cwd=str(REPO_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    try:
        assert _wait_ready(f"http://127.0.0.1:{ingest_port}/api/health")
        with pytest.raises(httpx.ConnectError):
            httpx.get(f"http://127.0.0.1:{unused_ui_port}/api/health", timeout=0.5)
    finally:
        proc.send_signal(signal.SIGINT)
        proc.wait(timeout=10)


@pytest.mark.slow
def test_cairn_ui_standalone(fresh_repo: Path):
    """`cairn ui` with no server running opens the repo and serves /api.

    ``--no-auth``: this test exercises startup/routing mechanics, not auth
    (covered separately in tests/unit/test_auth.py) — auth is ON by default
    as of the AUTH epic, so this must opt out explicitly, matching the
    documented dev/agent-workflow guidance (always launch test/dev servers
    with --no-auth).
    """
    ui_port = _free_port()
    proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "cairn",
            "ui",
            "--repo",
            str(fresh_repo),
            "--host",
            "127.0.0.1",
            "--port",
            str(ui_port),
            "--no-auth",
        ],
        cwd=str(REPO_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    try:
        assert _wait_ready(f"http://127.0.0.1:{ui_port}/api/health")
        # Writes work in ui mode.
        with httpx.Client(timeout=2.0) as c:
            r = c.post(
                f"http://127.0.0.1:{ui_port}/api/runs",
                json={"project": "p"},
            )
            assert r.status_code == 200
    finally:
        proc.send_signal(signal.SIGINT)
        proc.wait(timeout=10)


@pytest.mark.slow
def test_cairn_ui_errors_when_server_running(fresh_repo: Path):
    """Starting `cairn ui` on a repo held by `cairn server` must fail fast."""
    ingest_port = _free_port()
    ui_port_server = _free_port()
    while ui_port_server == ingest_port:
        ui_port_server = _free_port()
    server_proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "cairn",
            "server",
            "--repo",
            str(fresh_repo),
            "--host",
            "127.0.0.1",
            "--port",
            str(ingest_port),
            "--ui-port",
            str(ui_port_server),
        ],
        cwd=str(REPO_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    try:
        assert _wait_ready(f"http://127.0.0.1:{ingest_port}/api/health")
        # Now try to start `cairn ui` on the same repo — must exit non-zero.
        ui_port = _free_port()
        r = subprocess.run(
            [
                sys.executable,
                "-m",
                "cairn",
                "ui",
                "--repo",
                str(fresh_repo),
                "--host",
                "127.0.0.1",
                "--port",
                str(ui_port),
            ],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            timeout=10,
        )
        assert r.returncode != 0
        combined = (r.stdout or "") + (r.stderr or "")
        assert "already running" in combined or "in use" in combined
    finally:
        server_proc.send_signal(signal.SIGINT)
        server_proc.wait(timeout=10)


def test_cairn_ui_remote_repo_selects_local_proxy(monkeypatch):
    import uvicorn
    from cairn.server import proxy

    captured = {}
    real_factory = proxy.create_proxy_app

    def capture_factory(upstream, *, token=None, disable_webgpu=False, transport=None):
        captured.update(
            upstream=upstream,
            token=token,
            disable_webgpu=disable_webgpu,
        )
        return real_factory(
            upstream,
            token=token,
            disable_webgpu=disable_webgpu,
            transport=transport,
        )

    opened = []
    monkeypatch.setattr(proxy, "create_proxy_app", capture_factory)
    monkeypatch.setattr(uvicorn.Server, "run", lambda self: None)
    monkeypatch.setattr(cli, "_open_browser_soon", opened.append)
    monkeypatch.setenv("CAIRN_TOKEN", "from-environment")

    captured_port = _free_port()
    result = CliRunner().invoke(
        cli.main,
        [
            "ui",
            "--repo",
            "cairn://fermat:4300",
            "--port",
            str(captured_port),
            "--no-webgpu",
        ],
    )
    assert result.exit_code == 0, result.output
    assert captured == {
        "upstream": "http://fermat:4300",
        "token": "from-environment",
        "disable_webgpu": True,
    }
    assert "Cairn UI proxy" in result.output
    assert "Remote:  http://fermat:4300" in result.output
    assert "from-environment" not in result.output
    assert "Renderer: CPU (--no-webgpu)" in result.output
    assert opened == [f"http://localhost:{captured_port}/"]


def test_cairn_ui_no_open_browser_opt_out(monkeypatch):
    import uvicorn

    opened = []
    monkeypatch.setattr(uvicorn.Server, "run", lambda self: None)
    monkeypatch.setattr(cli, "_open_browser_soon", opened.append)
    monkeypatch.setenv("CAIRN_TOKEN", "from-environment")
    result = CliRunner().invoke(
        cli.main,
        [
            "ui",
            "--repo",
            "cairn://fermat:4300",
            "--port",
            str(_free_port()),
            "--no-open-browser",
        ],
    )
    assert result.exit_code == 0, result.output
    assert opened == []


def test_cairn_ui_remote_proxy_rejects_non_loopback_bind():
    result = CliRunner().invoke(
        cli.main,
        [
            "ui",
            "--repo",
            "cairn://fermat:4300",
            "--host",
            "0.0.0.0",
            "--port",
            str(_free_port()),
        ],
    )
    assert result.exit_code != 0
    assert "must bind to loopback" in result.output


def test_cairn_server_creates_repo_if_missing(tmp_path):
    """`cairn server` against a non-existent path should create the repo."""
    repo = tmp_path / "not-yet" / ".cairn"
    assert not repo.exists()
    ingest_port = _free_port()
    ui_port = _free_port()
    while ui_port == ingest_port:
        ui_port = _free_port()
    proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "cairn",
            "server",
            "--repo",
            str(repo),
            "--host",
            "127.0.0.1",
            "--port",
            str(ingest_port),
            "--ui-port",
            str(ui_port),
            "--no-ui",
        ],
        cwd=str(REPO_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    try:
        assert _wait_ready(f"http://127.0.0.1:{ingest_port}/api/health")
        assert repo.exists()
        assert (repo / "cairn.db").exists()
    finally:
        proc.send_signal(signal.SIGINT)
        proc.wait(timeout=10)
