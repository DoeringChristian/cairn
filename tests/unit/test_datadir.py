"""Unit tests for cairn.server.storage.datadir."""

from __future__ import annotations

import json
import os
from pathlib import Path
from unittest.mock import patch

from cairn.server.storage import datadir as datadir_mod
from cairn.server.storage.datadir import (
    DataDir,
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


# ---------------------------------------------------------------------------
# Live-server advertisement (notebook auto-discovery of `cairn
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
