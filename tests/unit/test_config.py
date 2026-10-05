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


def test_config_file_written_0600(tmp_path):
    """The config file may hold a plaintext bearer token — it must be
    owner-only readable, and its parent dir owner-only, on POSIX hosts."""
    import os
    import stat

    cfg = tmp_path / "cfgdir" / "config.toml"
    config.write_config_file({"server": "http://x:4300", "tokens": {"http://x:4300": "secret"}}, path=cfg)
    mode = stat.S_IMODE(os.stat(cfg).st_mode)
    assert mode == 0o600, oct(mode)
    parent_mode = stat.S_IMODE(os.stat(cfg.parent).st_mode)
    assert parent_mode == 0o700, oct(parent_mode)


def test_config_file_rewrite_tightens_existing_loose_perms(tmp_path):
    """A pre-existing world-readable config gets tightened on the next write
    (O_CREAT keeps an existing file's old mode, so we chmod explicitly)."""
    import os
    import stat

    cfg = tmp_path / "config.toml"
    cfg.write_text("server = 'http://old'\n")
    os.chmod(cfg, 0o644)
    config.write_config_file({"server": "http://new", "tokens": {"http://x:4300": "secret"}}, path=cfg)
    mode = stat.S_IMODE(os.stat(cfg).st_mode)
    assert mode == 0o600, oct(mode)


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


# ---------------------------------------------------------------------------
# Per-server tokens
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "spelling,canonical",
    [
        ("http://gpubox:4300", "http://gpubox:4300"),
        ("http://gpubox:4300/", "http://gpubox:4300"),
        ("cairn://gpubox:4300", "http://gpubox:4300"),
        ("cairn://GPUBox:4300//", "http://gpubox:4300"),
        ("HTTP://gpubox:4300", "http://gpubox:4300"),
        ("gpubox:4300", "http://gpubox:4300"),
        ("http://gpubox:80", "http://gpubox"),
        ("https://gpubox:443/", "https://gpubox"),
        ("https://gpubox:4300", "https://gpubox:4300"),
        ("http://127.0.0.1:4301", "http://localhost:4301"),
        ("http://[::1]:4301", "http://localhost:4301"),
        ("http://[fe80::1]:4301/", "http://[fe80::1]:4301"),
        ("https://lab.example/cairn/a/", "https://lab.example/cairn/a"),
        ("http://user:pw@gpubox:4300/?x=1#y", "http://gpubox:4300"),
    ],
)
def test_normalize_server_url(spelling, canonical):
    assert config.normalize_server_url(spelling) == canonical


@pytest.mark.parametrize("bad", ["ftp://gpubox", "http://", "http://gpubox:notaport"])
def test_normalize_server_url_rejects_non_servers(bad):
    with pytest.raises(ValueError):
        config.normalize_server_url(bad)


def test_resolve_token_picks_the_target_servers_entry(monkeypatch):
    monkeypatch.delenv("CAIRN_TOKEN", raising=False)
    config.save_token("cairn://a.local:4300", "tok-a")
    config.save_token("http://b.local:4300/", "tok-b")
    assert config.resolve_token("http://a.local:4300") == "tok-a"
    assert config.resolve_token("cairn://b.local:4300") == "tok-b"
    # Another port on the same host is another server.
    assert config.resolve_token("http://a.local:4301") is None
    assert config.resolve_token(None) is None
    # CAIRN_TOKEN applies to every server; an explicit token beats both.
    monkeypatch.setenv("CAIRN_TOKEN", "env")
    assert config.resolve_token("http://a.local:4300") == "env"
    assert config.resolve_token("http://a.local:4300", "explicit") == "explicit"


def test_save_token_rekeys_and_removes(monkeypatch):
    config.write_config_file(
        {"server": "http://a.local:4300", "tokens": {"cairn://A.local:4300/": "old"}}
    )
    assert config.save_token("http://a.local:4300", "new") == "http://a.local:4300"
    data = config.load_config_file()
    assert data["tokens"] == {"http://a.local:4300": "new"}
    assert data["server"] == "http://a.local:4300"
    config.save_token("a.local:4300", None)
    assert "tokens" not in config.load_config_file()


def test_single_token_key_is_not_read(monkeypatch):
    monkeypatch.delenv("CAIRN_TOKEN", raising=False)
    config.write_config_file({"token": "legacy"})
    assert config.resolve_token("http://localhost:4300") is None
