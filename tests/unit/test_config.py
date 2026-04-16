"""Unit tests for cairn.config — server URL resolution + TOML I/O."""

from __future__ import annotations

from pathlib import Path

import pytest

from cairn import config


@pytest.fixture(autouse=True)
def _reset_configured():
    config.reset_configured()
    yield
    config.reset_configured()


@pytest.fixture(autouse=True)
def _isolate_env_and_config(monkeypatch, tmp_path):
    monkeypatch.delenv("CAIRN_SERVER", raising=False)
    # Redirect config file to a temp path so user's real config isn't read.
    monkeypatch.setattr(config, "config_file_path", lambda: tmp_path / "config.toml")


def test_default_when_nothing_set():
    assert config.resolve_server() == config.DEFAULT_SERVER


def test_explicit_kwarg_wins():
    config.configure(server="http://cfg.local")
    assert config.resolve_server("http://explicit.local") == "http://explicit.local"


def test_configured_beats_env(monkeypatch):
    monkeypatch.setenv("CAIRN_SERVER", "http://env.local")
    config.configure(server="http://cfg.local")
    assert config.resolve_server() == "http://cfg.local"


def test_env_beats_file(monkeypatch, tmp_path):
    monkeypatch.setenv("CAIRN_SERVER", "http://env.local")
    config.write_config_file({"server": "http://file.local"})
    assert config.resolve_server() == "http://env.local"


def test_file_used_when_nothing_else(tmp_path):
    config.write_config_file({"server": "http://file.local"})
    assert config.resolve_server() == "http://file.local"


def test_write_and_read_roundtrip(tmp_path):
    data = {"server": "http://x:4300", "other": "y"}
    config.write_config_file(data)
    assert config.load_config_file() == data


def test_load_missing_returns_empty(tmp_path):
    assert config.load_config_file() == {}


def test_load_malformed_returns_empty(tmp_path):
    path = config.config_file_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"this is = not ] valid [ toml")
    assert config.load_config_file() == {}


def test_configure_ignores_none():
    config.configure(server="http://a.local")
    config.configure(server=None)  # should not overwrite with None
    assert config.resolve_server() == "http://a.local"


def test_reset_configured():
    config.configure(server="http://a.local")
    config.reset_configured()
    assert config.resolve_server() == config.DEFAULT_SERVER
