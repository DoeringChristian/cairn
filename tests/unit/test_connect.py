"""``open_transport`` / ``open_writer``: every target is reached over HTTP."""

from __future__ import annotations

from cairn.sdk.connect import open_transport, open_writer
from cairn.sdk.transport import Transport
from cairn.server.registration import read_info


def test_local_repo_is_reached_through_its_server(tmp_path):
    repo = tmp_path / ".cairn"
    t, url = open_writer(repo)
    try:
        assert isinstance(t, Transport)
        info = read_info(repo.resolve())
        assert info is not None and url == info["url"]
        assert t.get("/api/health").status_code == 200
    finally:
        t.close()


def test_run_transport_is_the_writer_transport(tmp_path):
    repo = tmp_path / ".cairn"
    t1, url1 = open_transport(repo)
    t2, url2 = open_writer(repo)
    try:
        assert url1 == url2  # one server per repo, reused
    finally:
        t1.close()
        t2.close()


def test_cairn_url_opens_http(live_server):
    t, url = open_writer(live_server.replace("http://", "cairn://"))
    try:
        assert isinstance(t, Transport)
        assert url == live_server
    finally:
        t.close()
