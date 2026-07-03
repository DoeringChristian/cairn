"""Route-layer tests for GET /api/runs/<id>/sequences/<name>.

Covers the %2F-encoded slash-in-metric-name bug: the UI encodes metric
names with ``encodeURIComponent`` before building the sequence URL, so a
metric named e.g. ``weights/layer1`` is requested as
``.../sequences/weights%2Flayer1``. Uvicorn/Starlette percent-decode the
path before routing, turning ``%2F`` back into a literal ``/`` — which,
without a ``:path`` converter on the route, splits the request into more
path segments than the route declares and falls through to the SPA
catch-all (200 OK with ``text/html``, not the JSON sequence payload).
"""

from __future__ import annotations

from datetime import datetime, timezone


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def test_slash_named_metric_sequence_roundtrip(client):
    rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
    client.post(
        f"/api/runs/{rid}/batch",
        json={
            "points": [
                {
                    "name": "weights/layer1",
                    "step": 0,
                    "wall_time": iso_now(),
                    "object_type": "scalar",
                    "scalar_value": 0.5,
                },
                {
                    "name": "weights/layer1",
                    "step": 1,
                    "wall_time": iso_now(),
                    "object_type": "scalar",
                    "scalar_value": 0.75,
                },
            ]
        },
    )

    # Listed correctly regardless of the slash.
    seqs = client.get(f"/api/runs/{rid}/sequences").json()["sequences"]
    assert {s["name"] for s in seqs} == {"weights/layer1"}

    # Fetched exactly as the UI's api client encodes it
    # (encodeURIComponent -> %2F for the slash).
    r = client.get(f"/api/runs/{rid}/sequences/weights%2Flayer1")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/json")
    body = r.json()
    assert body["name"] == "weights/layer1"
    assert [p["step"] for p in body["points"]] == [0, 1]


def test_slash_named_artifact_family_lookup_by_name(client):
    project_id = client.post("/api/runs", json={"project": "p"}).json()["project_id"]
    client.post(
        f"/api/projects/{project_id}/artifact-families",
        json={"name": "checkpoints/epoch", "type": "artifact"},
    )

    r = client.get(
        f"/api/projects/{project_id}/artifact-families/by-name/checkpoints%2Fepoch"
    )
    assert r.status_code == 200
    assert r.json()["name"] == "checkpoints/epoch"
