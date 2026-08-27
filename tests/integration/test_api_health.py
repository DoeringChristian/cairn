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


def test_root_serves_spa_or_placeholder(client):
    """When the UI bundle exists we serve HTML; otherwise the JSON placeholder."""
    import pathlib

    r = client.get("/")
    assert r.status_code == 200
    ui_dist = (
        pathlib.Path(__file__).resolve().parents[2]
        / "cairn"
        / "ui"
        / "dist"
        / "index.html"
    )
    if ui_dist.exists():
        assert r.headers["content-type"].startswith("text/html")
        assert "<html" in r.text.lower()
    else:
        assert r.json()["status"] == "no_ui"
