"""Health/info/workspace endpoints."""

from __future__ import annotations


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "version" in body
    assert "uptime_sec" in body


def test_info(client):
    r = client.get("/api/info")
    assert r.status_code == 200
    body = r.json()
    assert body["run_count"] == 0
    assert "data_dir" in body


def test_root_is_api_only_by_default(client):
    """A server built without `mount_ui` never serves a page."""
    r = client.get("/")
    assert r.status_code == 200
    assert r.json()["status"] == "ingest"


def test_root_serves_the_spa_when_the_viewer_is_mounted(ui_client):
    """Stronger than branching on bundle presence: this cannot pass vacuously."""
    r = ui_client.get("/")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/html")
    assert "<html" in r.text.lower()
