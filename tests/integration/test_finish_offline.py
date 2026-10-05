"""The server goes down before ``finish()``: finish returns within its bound
without raising, and ``cairn sync`` later delivers the data AND the final
status (the finish used to be a plain POST, lost when it failed)."""

from __future__ import annotations

import time

import httpx
from click.testing import CliRunner

import cairn
from cairn import cli


class Switch(httpx.BaseTransport):
    """A real HTTP transport that can be turned off (connection refused)."""

    down = False

    def __init__(self) -> None:
        self._inner = httpx.HTTPTransport()

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        if Switch.down:
            raise httpx.ConnectError("connection refused", request=request)
        return self._inner.handle_request(request)


def test_finish_while_server_down_then_sync(live_server, monkeypatch, tmp_path):
    monkeypatch.setenv("CAIRN_WAL_DIR", str(tmp_path / "wal"))
    monkeypatch.setenv("CAIRN_SERVER", live_server)
    Switch.down = False
    # The class Run checks against (a unit test reloads the module).
    from cairn.sdk.run import Transport as RunTransport

    transport = RunTransport(live_server, timeout=1.0, client=httpx.Client(
        base_url=live_server, transport=Switch(), timeout=1.0,
    ))
    run = cairn.Run(project="p", transport=transport, timeout=1.0, capture_source=False,
                    capture_stdout=False, capture_env=False, capture_system_metrics=False)
    run.track(1.0, "loss", step=0)
    run.config(lr=0.1)
    Switch.down = True
    for s in range(1, 50):
        run.track(float(s), "loss", step=s)

    t0 = time.monotonic()
    run.finish()  # must not raise, must not hang
    assert time.monotonic() - t0 < 5.0

    Switch.down = False
    result = CliRunner().invoke(cli.main, ["sync"])
    assert result.exit_code == 0, result.output

    with httpx.Client(base_url=live_server, timeout=5.0) as c:
        r = c.get(f"/api/runs/{run.id}").json()["run"]
        pts = c.get(f"/api/runs/{run.id}/sequences/loss").json()["points"]
    assert r["status"] == "completed"
    assert len(pts) == 50
