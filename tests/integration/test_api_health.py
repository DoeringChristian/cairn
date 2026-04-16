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


def test_workspace_default_layout(client):
    rid = client.post("/api/runs", json={"project": "p", "task": "t"}).json()["run_id"]
    # Log a scalar and an image
    import hashlib
    import io
    from datetime import datetime, timezone

    payload = b"x"
    digest = hashlib.sha256(payload).hexdigest()
    client.post(
        "/api/artifacts",
        files={"file": ("x.png", io.BytesIO(payload), "image/png")},
        data={"mime_type": "image/png"},
    )
    now = datetime.now(timezone.utc).isoformat()
    client.post(
        f"/api/runs/{rid}/batch",
        json={
            "points": [
                {
                    "name": "loss",
                    "step": 0,
                    "wall_time": now,
                    "object_type": "scalar",
                    "scalar_value": 0.1,
                },
                {
                    "name": "pred",
                    "step": 0,
                    "wall_time": now,
                    "object_type": "image",
                    "artifact_hash": digest,
                },
            ]
        },
    )
    layout = client.get(f"/api/workspaces/run/{rid}").json()
    assert layout["version"] == 1
    types = sorted(c["type"] for c in layout["cards"])
    assert types == ["image_gallery", "scalar_plot"]


def test_root_without_ui(client):
    r = client.get("/")
    assert r.status_code == 200
    assert r.json()["status"] == "no_ui"
