"""CLI smoke tests using CliRunner."""

from __future__ import annotations

import json

import pytest
from click.testing import CliRunner

from cairn import config
from cairn import cli


@pytest.fixture(autouse=True)
def _isolate_config(monkeypatch, tmp_path):
    # Redirect config path and spill dir so tests don't touch user state.
    monkeypatch.setattr(
        config, "config_file_path", lambda: tmp_path / "config.toml"
    )
    config.reset_configured()
    yield
    config.reset_configured()


def _table(output: str) -> list[list[str]]:
    return [line.split() for line in output.strip().splitlines()]


def test_login_to_an_auth_off_server_saves_nothing(live_server):
    """It used to report `Logged in ... as None (role=admin)` and save the
    pasted token for a server that ignores tokens."""
    result = CliRunner().invoke(cli.main, ["login", live_server, "--token", "whatever"])
    assert result.exit_code == 0, result.output
    assert "runs without auth" in result.output
    assert config.saved_tokens() == {}
