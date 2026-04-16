"""Unit tests for cairn.server.storage.datadir."""

from __future__ import annotations

import os
from pathlib import Path
from unittest.mock import patch

import pytest

from cairn.server.storage import datadir as datadir_mod
from cairn.server.storage.datadir import DataDir, default_data_dir


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
    # marker shouldn't be overwritten
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


def test_pid_lock_acquire_and_release(tmp_path):
    dd = DataDir(tmp_path)
    dd.acquire_pid_lock()
    assert dd.pid_path.exists()
    assert dd.pid_path.read_text() == str(os.getpid())
    dd.release_pid_lock()
    assert not dd.pid_path.exists()


def test_pid_lock_refuses_when_live(tmp_path):
    dd = DataDir(tmp_path)
    # Simulate another live process by writing its PID (use an arbitrary live pid).
    # Use a PID we control: write a high fake PID, then mock pid_exists.
    dd.pid_path.write_text("99999")
    with patch.object(datadir_mod.psutil, "pid_exists", return_value=True):
        with pytest.raises(RuntimeError, match="already running"):
            dd.acquire_pid_lock()


def test_pid_lock_replaces_stale(tmp_path):
    dd = DataDir(tmp_path)
    dd.pid_path.write_text("99999")
    with patch.object(datadir_mod.psutil, "pid_exists", return_value=False):
        dd.acquire_pid_lock()
    assert dd.pid_path.read_text() == str(os.getpid())


def test_pid_lock_handles_garbage_file(tmp_path):
    dd = DataDir(tmp_path)
    dd.pid_path.write_text("not-a-number")
    # garbage => not alive => stale => replaced
    dd.acquire_pid_lock()
    assert dd.pid_path.read_text() == str(os.getpid())


def test_release_ignores_other_owner(tmp_path):
    dd = DataDir(tmp_path)
    dd.pid_path.write_text("99999")
    # Not our PID, should leave alone.
    dd.release_pid_lock()
    assert dd.pid_path.exists()
