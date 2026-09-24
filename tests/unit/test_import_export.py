"""Export → import round trips through the HTTP API."""

from __future__ import annotations

import io


def _roundtrip(client, run_ids: list[str]) -> dict[str, str]:
    exported = client.post("/api/export", json={"run_ids": run_ids})
    assert exported.status_code == 200, exported.text
    imported = client.post(
        "/api/import",
        files={"file": ("runs.zip", io.BytesIO(exported.content), "application/zip")},
    )
    assert imported.status_code == 200, imported.text
    return {r["original_id"]: r["new_id"] for r in imported.json()["imported"]}


def _upload(client, data: bytes) -> str:
    r = client.post(
        "/api/artifacts",
        files={"file": ("blob", data, "text/plain")},
        data={"mime_type": "text/plain", "metadata": "{}", "object_type": "text"},
    )
    assert r.status_code == 200, r.text
    return r.json()["hash"]


def test_run_artifacts_survive_import(client):
    rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
    digest = _upload(client, b"hello")
    client.post(f"/api/runs/{rid}/artifacts", json={"name": "notes", "hash": digest})
    client.post(f"/api/runs/{rid}/artifacts", json={"name": "ckpt", "hash": digest, "step": 3})
    db = client.app.state.db
    before = {
        (r["name"], r["step"]): r["created_at"]
        for r in db.read_columns("SELECT * FROM run_artifacts WHERE run_id = ?", [rid])
    }

    new_id = _roundtrip(client, [rid])[rid]

    after = {
        (r["name"], r["step"]): r["created_at"]
        for r in db.read_columns("SELECT * FROM run_artifacts WHERE run_id = ?", [new_id])
    }
    assert after == before
    names = {a["name"] for a in client.get(f"/api/runs/{new_id}/artifacts").json()["named"]}
    assert names == {"notes", "ckpt"}
