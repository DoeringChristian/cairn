"""Cursor-based /updates endpoint — the one poll per live run."""

from __future__ import annotations

import hashlib
import io
import json
from datetime import datetime, timezone


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _point(name: str, step: int, value: float, **extra) -> dict:
    return {
        "name": name,
        "step": step,
        "wall_time": iso_now(),
        "object_type": "scalar",
        "scalar_value": value,
        **extra,
    }


def _make_run(client) -> str:
    return client.post("/api/runs", json={"project": "p"}).json()["run_id"]


def test_updates_from_zero_returns_everything_with_a_cursor(client):
    rid = _make_run(client)
    client.post(
        f"/api/runs/{rid}/batch",
        json={
            "points": [
                _point("loss", 0, 1.0),
                _point("loss", 1, 0.5),
                _point("acc", 0, 0.1, context={"subset": "val"}),
            ]
        },
    )

    body = client.get(f"/api/runs/{rid}/updates?since=0").json()
    assert body["run_id"] == rid
    assert body["status"] == "running"
    assert body["more"] is False
    assert body["cursor"] > 0

    pts = body["points"]
    assert len(pts) == 3
    # Every point carries the routing keys the client needs to find the
    # cached sequence query, plus the same shape as the sequence endpoint.
    assert {p["name"] for p in pts} == {"loss", "acc"}
    for p in pts:
        assert set(p) == {
            "name",
            "context_hash",
            "step",
            "wall_time",
            "scalar_value",
            "artifact_hash",
            "context",
            "object_type",
            "artifact_mime",
            "artifact_size",
            "artifact_metadata",
        }
    acc = next(p for p in pts if p["name"] == "acc")
    assert acc["context_hash"] != ""
    assert json.loads(acc["context"]) == {"subset": "val"}


def test_updates_since_cursor_returns_only_new_points(client):
    rid = _make_run(client)
    client.post(
        f"/api/runs/{rid}/batch",
        json={"points": [_point("loss", 0, 1.0), _point("loss", 1, 0.5)]},
    )
    first = client.get(f"/api/runs/{rid}/updates?since=0").json()
    cursor = first["cursor"]

    # Nothing new yet.
    idle = client.get(f"/api/runs/{rid}/updates?since={cursor}").json()
    assert idle["points"] == []
    assert idle["cursor"] == cursor

    client.post(
        f"/api/runs/{rid}/batch",
        json={"points": [_point("loss", 2, 0.25), _point("other", 0, 7.0)]},
    )
    delta = client.get(f"/api/runs/{rid}/updates?since={cursor}").json()
    assert [(p["name"], p["step"]) for p in delta["points"]] == [
        ("loss", 2),
        ("other", 0),
    ]
    assert delta["cursor"] > cursor


def test_updates_reports_run_status(client):
    rid = _make_run(client)
    client.post(f"/api/runs/{rid}/batch", json={"points": [_point("loss", 0, 1.0)]})
    assert client.get(f"/api/runs/{rid}/updates").json()["status"] == "running"

    client.post(f"/api/runs/{rid}/finish", json={"status": "completed"})
    body = client.get(f"/api/runs/{rid}/updates").json()
    assert body["status"] == "completed"


def test_updates_unknown_run_404s(client):
    assert client.get("/api/runs/deadbeef/updates").status_code == 404


def test_sequence_response_carries_a_cursor(client):
    rid = _make_run(client)
    client.post(
        f"/api/runs/{rid}/batch",
        json={"points": [_point("loss", 0, 1.0), _point("loss", 1, 0.5)]},
    )
    seq = client.get(f"/api/runs/{rid}/sequences/loss").json()
    assert len(seq["points"]) == 2
    # The internal rowid never leaks into a point.
    assert all("_rowid" not in p for p in seq["points"])

    # Resuming /updates from the sequence's cursor yields nothing new, which
    # is exactly how the client avoids re-downloading what it already has.
    resumed = client.get(f"/api/runs/{rid}/updates?since={seq['cursor']}").json()
    assert resumed["points"] == []

    client.post(f"/api/runs/{rid}/batch", json={"points": [_point("loss", 2, 0.25)]})
    resumed = client.get(f"/api/runs/{rid}/updates?since={seq['cursor']}").json()
    assert [p["step"] for p in resumed["points"]] == [2]


def test_artifact_bytes_are_immutably_cacheable(client):
    payload = b"fake-png-bytes"
    digest = hashlib.sha256(payload).hexdigest()
    client.post(
        "/api/artifacts",
        files={"file": ("img.png", io.BytesIO(payload), "image/png")},
        data={"mime_type": "image/png"},
    )

    full = client.get(f"/api/artifacts/{digest}")
    assert full.status_code == 200
    assert full.headers["cache-control"] == "public, max-age=31536000, immutable"

    ranged = client.get(f"/api/artifacts/{digest}", headers={"Range": "bytes=0-3"})
    assert ranged.status_code == 206
    assert ranged.headers["cache-control"] == "public, max-age=31536000, immutable"
