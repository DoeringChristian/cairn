"""Unit tests for cairn.server.storage.datadir."""

from __future__ import annotations

import json
import os
from pathlib import Path
from unittest.mock import patch

import pytest

from cairn.server.storage import datadir as datadir_mod
from cairn.server.storage.datadir import (
    DataDir,
    RepoLockedError,
    default_data_dir,
    read_live_servers,
)


def test_fresh_dir_creates_layout(tmp_path):
    root = tmp_path / "cairn"
    dd = DataDir(root)
    assert root.exists()
    assert dd.artifacts_dir.exists()
    assert dd.sources_dir.exists()
    assert dd.logs_dir.exists()
    assert (root / "version").read_text() == datadir_mod.VERSION_MARKER


def test_existing_dir_is_reused(tmp_path):
    root = tmp_path / "cairn"
    DataDir(root)
    (root / "version").write_text("9")
    DataDir(root)
    assert (root / "version").read_text() == "9"


def test_default_data_dir_uses_env(monkeypatch, tmp_path):
    monkeypatch.setenv("CAIRN_DATA_DIR", str(tmp_path / "custom"))
    assert default_data_dir() == tmp_path / "custom"


def test_default_data_dir_fallback(monkeypatch):
    monkeypatch.delenv("CAIRN_DATA_DIR", raising=False)
    assert default_data_dir() == Path.home() / ".cairn"


def test_run_log_and_source_dirs_created(tmp_path):
    dd = DataDir(tmp_path)
    assert dd.run_log_dir("abc123").exists()
    assert dd.run_source_dir("abc123").exists()


def test_lock_acquire_records_mode_and_pid(tmp_path):
    dd = DataDir(tmp_path)
    dd.acquire_lock("server")
    assert dd.lock_path.exists()
    payload = json.loads(dd.lock_path.read_text())
    assert payload["pid"] == os.getpid()
    assert payload["mode"] == "server"
    assert "started_at" in payload
    dd.release_lock()
    assert not dd.lock_path.exists()


def test_sdk_mode_lock(tmp_path):
    dd = DataDir(tmp_path)
    dd.acquire_lock("sdk")
    try:
        payload = json.loads(dd.lock_path.read_text())
        assert payload["mode"] == "sdk"
    finally:
        dd.release_lock()


def test_lock_records_host_and_port(tmp_path):
    """host/port in the payload let an SDK Run auto-switch to HTTP."""
    dd = DataDir(tmp_path)
    dd.acquire_lock("ui", host="127.0.0.1", port=4301)
    try:
        payload = json.loads(dd.lock_path.read_text())
        assert payload["mode"] == "ui"
        assert payload["host"] == "127.0.0.1"
        assert payload["port"] == 4301
    finally:
        dd.release_lock()


def test_lock_without_host_port_omits_them(tmp_path):
    """Backwards-compat: callers that don't supply network coords don't
    write host/port fields. An SDK reading such a lock won't try to
    proxy and will fail over to the normal RepoLockedError path."""
    dd = DataDir(tmp_path)
    dd.acquire_lock("sdk")
    try:
        payload = json.loads(dd.lock_path.read_text())
        assert "host" not in payload
        assert "port" not in payload
    finally:
        dd.release_lock()


def test_lock_refuses_when_live_holder(tmp_path):
    dd = DataDir(tmp_path)
    dd.lock_path.write_text(json.dumps({"pid": 99999, "mode": "server"}))
    with patch.object(datadir_mod.psutil, "pid_exists", return_value=True):
        with pytest.raises(RepoLockedError) as excinfo:
            dd.acquire_lock("sdk")
    assert "already in use" in str(excinfo.value)
    assert excinfo.value.holder["pid"] == 99999


def test_lock_replaces_stale(tmp_path):
    dd = DataDir(tmp_path)
    dd.lock_path.write_text(json.dumps({"pid": 99999, "mode": "server"}))
    with patch.object(datadir_mod.psutil, "pid_exists", return_value=False):
        dd.acquire_lock("sdk")
    payload = json.loads(dd.lock_path.read_text())
    assert payload["pid"] == os.getpid()
    assert payload["mode"] == "sdk"


def test_lock_handles_garbage_file(tmp_path):
    dd = DataDir(tmp_path)
    dd.lock_path.write_text("not json at all")
    # unreadable holder → treated as stale → replaced
    dd.acquire_lock("server")
    payload = json.loads(dd.lock_path.read_text())
    assert payload["pid"] == os.getpid()


def test_release_ignores_other_owner(tmp_path):
    dd = DataDir(tmp_path)
    dd.lock_path.write_text(json.dumps({"pid": 99999, "mode": "server"}))
    dd.release_lock()
    assert dd.lock_path.exists()


def test_server_and_sdk_cannot_coexist(tmp_path):
    """Core guarantee: no two writers to the same .cairn/ regardless of mode."""
    dd1 = DataDir(tmp_path)
    dd1.acquire_lock("server")
    try:
        dd2 = DataDir(tmp_path)
        with pytest.raises(RepoLockedError):
            dd2.acquire_lock("sdk")
    finally:
        dd1.release_lock()


def test_backcompat_pid_lock_aliases(tmp_path):
    """Ensure ``acquire_pid_lock`` / ``release_pid_lock`` still work."""
    dd = DataDir(tmp_path)
    dd.acquire_pid_lock()
    try:
        # Lock file should be populated with server-mode JSON.
        payload = json.loads(dd.pid_path.read_text())
        assert payload["mode"] == "server"
    finally:
        dd.release_pid_lock()
    assert not dd.pid_path.exists()


# ---------------------------------------------------------------------------
# Live-server advertisement (WS-SRVDISC: notebook auto-discovery of `cairn
# ui` regardless of which port it landed on).
# ---------------------------------------------------------------------------


def test_add_live_server_writes_servers_json(tmp_path):
    dd = DataDir(tmp_path)
    dd.add_live_server("ui", host="127.0.0.1", port=4302)
    assert dd.servers_path.exists()
    entries = json.loads(dd.servers_path.read_text())
    assert len(entries) == 1
    assert entries[0]["pid"] == os.getpid()
    assert entries[0]["mode"] == "ui"
    assert entries[0]["host"] == "127.0.0.1"
    assert entries[0]["port"] == 4302
    assert "started_at" in entries[0]


def test_read_live_servers_matches_written_entry(tmp_path):
    dd = DataDir(tmp_path)
    dd.add_live_server("ui", host="127.0.0.1", port=4302)
    live = read_live_servers(dd.root)
    assert len(live) == 1
    assert live[0]["port"] == 4302


def test_read_live_servers_prunes_dead_pid(tmp_path):
    dd = DataDir(tmp_path)
    dd.servers_path.write_text(
        json.dumps([{"pid": 999999, "mode": "ui", "host": "127.0.0.1", "port": 4301}])
    )
    with patch.object(datadir_mod.psutil, "pid_exists", return_value=False):
        assert read_live_servers(dd.root) == []


def test_read_live_servers_missing_file_returns_empty(tmp_path):
    dd = DataDir(tmp_path)
    assert read_live_servers(dd.root) == []


def test_read_live_servers_handles_garbage_file(tmp_path):
    dd = DataDir(tmp_path)
    dd.servers_path.write_text("not json at all")
    assert read_live_servers(dd.root) == []


def test_add_live_server_replaces_own_stale_entry(tmp_path):
    """Re-advertising (e.g. restart under the same pid, or a second call)
    doesn't accumulate duplicate entries for this process."""
    dd = DataDir(tmp_path)
    dd.add_live_server("ui", host="127.0.0.1", port=4301)
    dd.add_live_server("ui", host="127.0.0.1", port=4302)
    entries = json.loads(dd.servers_path.read_text())
    assert len(entries) == 1
    assert entries[0]["port"] == 4302


def test_multiple_concurrent_servers_all_listed(tmp_path):
    """Two live processes serving the same repo both show up — the reader
    picks whichever health-probes as live (datadir.py's docstring: 'keep a
    small list; the reader picks a LIVE one')."""
    dd = DataDir(tmp_path)
    dd.add_live_server("ui", host="127.0.0.1", port=4301)
    with (
        patch("os.getpid", return_value=os.getpid() + 1),
        patch.object(datadir_mod.psutil, "pid_exists", return_value=True),
    ):
        dd2 = DataDir(tmp_path)
        dd2.add_live_server("ui", host="127.0.0.1", port=4302)
    with patch.object(datadir_mod.psutil, "pid_exists", return_value=True):
        live = read_live_servers(dd.root)
    assert {e["port"] for e in live} == {4301, 4302}


def test_remove_live_server_drops_own_entry_only(tmp_path):
    dd = DataDir(tmp_path)
    dd.add_live_server("ui", host="127.0.0.1", port=4301)
    with (
        patch("os.getpid", return_value=os.getpid() + 1),
        patch.object(datadir_mod.psutil, "pid_exists", return_value=True),
    ):
        dd2 = DataDir(tmp_path)
        dd2.add_live_server("ui", host="127.0.0.1", port=4302)
    with patch.object(datadir_mod.psutil, "pid_exists", return_value=True):
        dd.remove_live_server()
        live = read_live_servers(dd.root)
    assert [e["port"] for e in live] == [4302]


def test_add_live_server_never_raises_on_write_failure(tmp_path):
    dd = DataDir(tmp_path)
    with patch.object(datadir_mod, "_write_servers", side_effect=OSError("disk full")):
        dd.add_live_server("ui", host="127.0.0.1", port=4301)  # must not raise
