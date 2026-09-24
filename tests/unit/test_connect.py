"""``open_transport``: the one repo → transport resolution (Run, CLI, Reader edits)."""

from __future__ import annotations

import json
import os

import pytest

from cairn.sdk.connect import open_transport
from cairn.sdk.local import LocalTransport
from cairn.sdk.transport import Transport
from cairn.server.storage.datadir import DataDir, RepoLockedError


def test_local_repo_opens_a_local_transport(tmp_path):
    repo = tmp_path / ".cairn"
    t, url = open_transport(repo)
    try:
        assert isinstance(t, LocalTransport) and t.db is not None
        assert url == f"file://{DataDir(repo).root}"
    finally:
        t.close()


def test_local_wal_flag_selects_wal_mode(tmp_path):
    t, _ = open_transport(tmp_path / ".cairn", local_wal=True)
    try:
        assert isinstance(t, LocalTransport) and t.db is None
    finally:
        t.close()


def test_served_repo_upgrades_to_http(tmp_path, live_server):
    host, port = live_server.removeprefix("http://").split(":")
    dd = DataDir(tmp_path / ".cairn")
    dd.lock_path.write_text(json.dumps({
        "pid": os.getpid(), "mode": "ui", "host": host, "port": int(port),
        "started_at": "2026-01-01T00:00:00Z",
    }))
    (dd.root / "auth").mkdir(exist_ok=True)
    (dd.root / "auth" / "local.token").write_text("tok\n")
    t, url = open_transport(dd.root)
    try:
        assert isinstance(t, Transport)
        assert url == live_server
        assert t.token == "tok"
    finally:
        t.close()


def test_served_repo_with_dead_endpoint_raises(tmp_path):
    dd = DataDir(tmp_path / ".cairn")
    dd.lock_path.write_text(json.dumps({
        "pid": os.getpid(), "mode": "ui", "host": "127.0.0.1", "port": 1,
        "started_at": "2026-01-01T00:00:00Z",
    }))
    with pytest.raises(RepoLockedError):
        open_transport(dd.root)


def test_cairn_url_opens_http(live_server):
    t, url = open_transport("cairn://" + live_server.removeprefix("http://"))
    try:
        assert isinstance(t, Transport)
        assert url == live_server
    finally:
        t.close()
