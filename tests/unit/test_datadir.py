"""Unit tests for cairn.server.storage.datadir."""

from __future__ import annotations

import json
import os
from pathlib import Path
from unittest.mock import patch

import pytest

from cairn.server.storage import datadir as datadir_mod
from cairn.server.storage.datadir import DataDir, RepoLockedError, default_data_dir


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
