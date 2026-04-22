"""End-to-end ingest lifecycle via FastAPI TestClient."""

from __future__ import annotations

import hashlib
import io
import json
from datetime import datetime, timezone

import pytest


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def test_create_run_creates_project(client):
    resp = client.post(
        "/api/runs",
        json={"project": "Image Class", "name": "r1"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["run_id"]) == 12
    assert body["project_id"] == "image-class"

    # Project is now visible via read API.
    assert client.get("/api/projects").json()["projects"][0]["id"] == "image-class"


def test_full_lifecycle(client):
    # 1. Create
    rid = client.post(
        "/api/runs",
        json={
            "project": "p",
            "env": {"python": "3.11"},
            "git": {"sha": "abc", "branch": "main", "dirty": False},
            "cli_args": ["train.py", "--lr", "0.01"],
        },
    ).json()["run_id"]

    # 2. Params (flatten nested dict)
    r = client.post(
        f"/api/runs/{rid}/params",
        json={"params": {"model": {"layers": 3}, "lr": 0.01}},
    )
    assert r.status_code == 200
    assert r.json()["updated"] == 2

    # 3. Batch — two scalar points and one with context
    r = client.post(
        f"/api/runs/{rid}/batch",
        json={
            "points": [
                {
                    "name": "loss",
                    "step": 0,
                    "wall_time": iso_now(),
                    "object_type": "scalar",
                    "scalar_value": 1.0,
                },
                {
                    "name": "loss",
                    "step": 1,
                    "wall_time": iso_now(),
                    "object_type": "scalar",
                    "scalar_value": 0.5,
                },
                {
                    "name": "loss",
                    "step": 0,
                    "wall_time": iso_now(),
                    "context": {"subset": "val"},
                    "object_type": "scalar",
                    "scalar_value": 1.2,
                },
            ]
        },
    )
    assert r.status_code == 200
    assert r.json()["accepted"] == 3

    # 4. Artifact dedup via HEAD
    payload = b"fake-png-bytes"
    digest = hashlib.sha256(payload).hexdigest()
    assert client.head(f"/api/artifacts/{digest}").status_code == 404
    r = client.post(
        "/api/artifacts",
        files={"file": ("img.png", io.BytesIO(payload), "image/png")},
        data={"mime_type": "image/png", "metadata": json.dumps({"w": 1, "h": 1})},
    )
    assert r.status_code == 200
    assert r.json()["hash"] == digest
    assert client.head(f"/api/artifacts/{digest}").status_code == 200
    # Second POST is a no-op (idempotent).
    r2 = client.post(
        "/api/artifacts",
        files={"file": ("img.png", io.BytesIO(payload), "image/png")},
        data={"mime_type": "image/png"},
    )
    assert r2.json()["hash"] == digest

    # 5. Reference artifact from a sequence point
    client.post(
        f"/api/runs/{rid}/batch",
        json={
            "points": [
                {
                    "name": "predictions",
                    "step": 0,
                    "wall_time": iso_now(),
                    "object_type": "image",
                    "artifact_hash": digest,
                }
            ]
        },
    )

    # 6. Logs
    r = client.post(
        f"/api/runs/{rid}/logs",
        json={
            "lines": [
                {
                    "stream": "stdout",
                    "wall_time": iso_now(),
                    "line_no": 1,
                    "content": "hello",
                },
                {
                    "stream": "stderr",
                    "wall_time": iso_now(),
                    "line_no": 2,
                    "content": "oops",
                    "content_raw": "\x1b[31moops\x1b[0m",
                },
            ]
        },
    )
    assert r.status_code == 200

    # 7. Finish
    r = client.post(f"/api/runs/{rid}/finish", json={"status": "completed"})
    assert r.json()["status"] == "completed"

    # Verify via read API
    run = client.get(f"/api/runs/{rid}").json()
    assert run["run"]["status"] == "completed"
    assert len(run["params"]) == 2
    assert {p["key"] for p in run["params"]} == {"model.layers", "lr"}

    seqs = client.get(f"/api/runs/{rid}/sequences").json()["sequences"]
    names = {s["name"] for s in seqs}
    assert names == {"loss", "predictions"}

    loss = client.get(f"/api/runs/{rid}/sequences/loss").json()
    assert len(loss["points"]) == 3

    artifacts_list = client.get(f"/api/runs/{rid}/artifacts").json()
    assert any(a["hash"] == digest for a in artifacts_list["from_sequences"])

    logs = client.get(f"/api/runs/{rid}/logs").json()["lines"]
    assert len(logs) == 2


def test_create_run_with_bad_project_name(client):
    r = client.post("/api/runs", json={"project": "   "})
    assert r.status_code == 400


def test_params_for_unknown_run_404s(client):
    r = client.post("/api/runs/deadbeef/params", json={"params": {"x": 1}})
    assert r.status_code == 404


def test_run_attach_artifact(client):
    rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
    payload = b"archive-bytes"
    digest = hashlib.sha256(payload).hexdigest()
    # Upload first
    client.post(
        "/api/artifacts",
        files={"file": ("f.bin", io.BytesIO(payload), "application/octet-stream")},
        data={"mime_type": "application/octet-stream"},
    )
    r = client.post(
        f"/api/runs/{rid}/artifacts",
        json={"name": "checkpoint", "hash": digest},
    )
    assert r.status_code == 200
    # List
    listing = client.get(f"/api/runs/{rid}/artifacts").json()
    assert listing["named"][0]["name"] == "checkpoint"


def test_run_tags_and_notes(client):
    rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
    client.post(f"/api/runs/{rid}/tags", json={"tags": ["ablation", "v2"]})
    client.post(f"/api/runs/{rid}/notes", json={"notes": "hi"})
    run = client.get(f"/api/runs/{rid}").json()["run"]
    assert json.loads(run["tags"]) == ["ablation", "v2"]
    assert run["notes"] == "hi"


def test_delete_run(client):
    rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
    client.post(
        f"/api/runs/{rid}/batch",
        json={
            "points": [
                {
                    "name": "loss",
                    "step": 0,
                    "wall_time": iso_now(),
                    "object_type": "scalar",
                    "scalar_value": 0.5,
                }
            ]
        },
    )
    r = client.delete(f"/api/runs/{rid}")
    assert r.status_code == 200
    assert client.get(f"/api/runs/{rid}").status_code == 404


def test_finish_with_failed_status(client):
    rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
    client.post(f"/api/runs/{rid}/finish", json={"status": "failed", "exit_code": 2})
    run = client.get(f"/api/runs/{rid}").json()["run"]
    assert run["status"] == "failed"
    assert run["exit_code"] == 2
