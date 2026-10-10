"""``open_writer``: where writes that are not a run's own logging go."""

from __future__ import annotations

import json
import os
import time

import pytest

from cairn.sdk.connect import open_writer
from cairn.sdk.local import RepoTransport, ServerUnreachable
from cairn.sdk.transport import Transport
from cairn.server.storage import lease as lease_mod
from cairn.server.storage.datadir import DataDir


def _fake_server_lease(root, url: str) -> None:
    """A lease as a live server in another process (on this host) writes it."""
    root.mkdir(parents=True, exist_ok=True)
    lease_mod.lease_path(root).write_text(json.dumps({
        "host": lease_mod.hostname(), "pid": os.getppid(), "token": "t" * 32,
        "mode": "ui", "url": url, "expires_at": time.time() + 30,
    }))


def test_writer_on_served_repo_goes_to_the_server(tmp_path, live_server):
    dd = DataDir(tmp_path / ".cairn")
    _fake_server_lease(dd.root, live_server)
    (dd.root / "auth").mkdir(exist_ok=True)
    (dd.root / "auth" / "local.token").write_text("tok\n")
    t, _ = open_writer(dd.root)
    try:
        assert isinstance(t, RepoTransport)
        served = t.served_by()
        assert isinstance(served, Transport)
        assert served.server_url == live_server
        assert served.token == "tok"
        t.create_sweep({"project": "p", "parameters": {"x": {"values": [1]}}})
        assert len(t.list_sweeps("p")) == 1  # answered by the server
        assert not dd.db_path.exists()  # nothing written here
    finally:
        t.close()


def test_writer_on_served_repo_with_dead_endpoint_raises(tmp_path):
    dd = DataDir(tmp_path / ".cairn")
    _fake_server_lease(dd.root, "http://127.0.0.1:1")
    t, _ = open_writer(dd.root)
    try:
        with pytest.raises(ServerUnreachable):
            t.list_sweeps()
    finally:
        t.close()


def test_writer_without_server_writes_under_the_lease(tmp_path):
    dd = DataDir(tmp_path / ".cairn")
    t, _ = open_writer(dd.root)
    try:
        t.create_sweep({"project": "p", "parameters": {"x": {"values": [1]}}})
        assert len(t.list_sweeps("p")) == 1
        assert not lease_mod.lease_path(dd.root).exists()  # released again
    finally:
        t.close()


def test_cairn_url_opens_http(live_server):
    t, url = open_writer("cairn://" + live_server.removeprefix("http://"))
    try:
        assert isinstance(t, Transport)
        assert url == live_server
    finally:
        t.close()
