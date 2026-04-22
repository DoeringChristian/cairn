"""Resolution-priority tests for cairn.config.resolve_target."""

from __future__ import annotations

from pathlib import Path

import pytest

from cairn import config


@pytest.fixture(autouse=True)
def _reset(monkeypatch, tmp_path):
    # Isolate from user environment and config file.
    monkeypatch.delenv("CAIRN_SERVER", raising=False)
    monkeypatch.delenv("CAIRN_REPO", raising=False)
    monkeypatch.setattr(config, "config_file_path", lambda: tmp_path / "config.toml")
    config.reset_configured()
    # cwd without .cairn/ to avoid auto-discovery
    monkeypatch.chdir(tmp_path / "scratch" if (tmp_path / "scratch").exists() else tmp_path)
    yield
    config.reset_configured()


def test_default_fallback_to_cwd_cairn():
    target = config.resolve_target()
    assert target.kind == "local"
    assert target.location == str(Path.cwd() / ".cairn")


def test_explicit_repo_wins_over_server_kwarg(tmp_path):
    target = config.resolve_target(repo=tmp_path / "a", server="http://s")
    assert target.is_local
    assert target.location.endswith("a")


def test_server_kwarg_used_when_no_repo():
    target = config.resolve_target(server="http://srv")
    assert target.kind == "server"
    assert target.location == "http://srv"


def test_env_cairn_repo_wins_over_cairn_server(monkeypatch, tmp_path):
    monkeypatch.setenv("CAIRN_REPO", str(tmp_path / "local"))
    monkeypatch.setenv("CAIRN_SERVER", "http://s")
    target = config.resolve_target()
    assert target.is_local
    assert target.location.endswith("local")


def test_kwarg_beats_env(monkeypatch, tmp_path):
    monkeypatch.setenv("CAIRN_REPO", "/env/repo")
    target = config.resolve_target(server="http://kw")
    assert target.kind == "server"
    assert target.location == "http://kw"


def test_configured_repo_beats_env(monkeypatch, tmp_path):
    monkeypatch.setenv("CAIRN_SERVER", "http://env")
    config.configure(repo=str(tmp_path / "cfg"))
    target = config.resolve_target()
    assert target.is_local
    assert target.location.endswith("cfg")


def test_config_file_repo_used(tmp_path):
    config.write_config_file({"repo": str(tmp_path / "fromfile")})
    target = config.resolve_target()
    assert target.is_local


def test_explicit_kwarg_overrides_default(tmp_path):
    target = config.resolve_target(server="http://explicit")
    assert target.kind == "server"
