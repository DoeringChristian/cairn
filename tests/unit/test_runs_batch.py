"""``POST /api/runs/batch``: many runs' per-run reads in one request, each
part exactly what its per-run route returns."""

from __future__ import annotations

import json

MANIFEST = "application/vnd.cairn.artifact-manifest+json"
T = "2026-01-01T00:00:00Z"


def _blob(client, data: bytes, mime: str, meta: dict | None = None) -> str:
    r = client.post("/api/artifacts", files={"file": ("b", data, mime)},
                    data={"mime_type": mime, "metadata": json.dumps(meta or {})})
    assert r.status_code == 200, r.text
    return r.json()["hash"]


def _runs(client) -> list[str]:
    """Three runs: params, summary, scalars, an image series and an output
    artifact on the first; scalars on the second; nothing on the third."""
    ids = []
    for name in ("a", "b", "c"):
        ids.append(client.post("/api/runs", json={"project": "p", "name": name, "env": {"K": "v"}}).json()["run_id"])
    a, b, _ = ids
    client.post(f"/api/runs/{a}/params", json={"params": {"lr": 0.1, "opt": {"name": "adam"}}})
    client.post(f"/api/runs/{a}/summary", json={"summary": {"best": 0.9}})
    img = _blob(client, b"\x89PNG fake", "image/png")
    for run, k in ((a, 1.0), (b, 2.0)):
        r = client.post(f"/api/runs/{run}/batch", json={"points": [
            {"name": "loss", "step": s, "wall_time": T, "object_type": "scalar", "scalar_value": k / (s + 1)}
            for s in range(3)
        ]})
        assert r.status_code == 200, r.text
    client.post(f"/api/runs/{a}/batch", json={"points": [
        {"name": "samples", "step": 0, "wall_time": T, "object_type": "image", "artifact_hash": img},
    ]})
    f = _blob(client, b'{"k": 1}', "application/json")
    m = _blob(client, json.dumps({"files": [
        {"path": "d/k.json", "hash": f, "size": 8, "mime": "application/json"},
    ]}).encode(), MANIFEST)
    r = client.post("/api/projects/p/artifact-versions", json={"name": "ds", "digest": m, "created_by_run": a})
    assert r.status_code == 200, r.text
    return ids


def test_each_part_is_the_per_run_routes_body(client):
    ids = _runs(client)
    r = client.post("/api/runs/batch", json={"ids": ids})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["missing"] == [] and body["forbidden"] == []
    assert list(body["runs"]) == ids
    for rid in ids:
        got = body["runs"][rid]
        assert got["run"] == client.get(f"/api/runs/{rid}").json()
        assert got["sequences"] == client.get(f"/api/runs/{rid}/sequences").json()["sequences"]
        assert got["outputs"] == client.get(f"/api/runs/{rid}/outputs", params={"include": "files"}).json()["outputs"]
    a = body["runs"][ids[0]]
    # The fixture is not empty: the comparison above compares something.
    assert {s["name"] for s in a["sequences"]} == {"loss", "samples"}
    assert [o["ref"] for o in a["outputs"]] == ["ds:v1"] and len(a["outputs"][0]["files"]) == 1
    assert a["run"]["run"]["env_snapshot"] and a["run"]["params"]


def test_include_picks_the_parts(client):
    ids = _runs(client)
    body = client.post("/api/runs/batch", json={"ids": ids, "include": ["sequences"]}).json()
    assert all(set(v) == {"sequences"} for v in body["runs"].values())
    body = client.post("/api/runs/batch", json={"ids": ids, "include": []}).json()
    assert body["runs"] == {rid: {} for rid in ids}
    r = client.post("/api/runs/batch", json={"ids": ids, "include": ["run", "logs"]})
    assert r.status_code == 400 and "logs" in r.json()["detail"]


def test_unknown_and_repeated_ids(client):
    a, b, _ = _runs(client)
    body = client.post("/api/runs/batch", json={"ids": [b, "nope", a, b], "include": ["run"]}).json()
    assert list(body["runs"]) == [b, a]
    assert body["missing"] == ["nope"]
    assert client.post("/api/runs/batch", json={"ids": []}).json() == {"runs": {}, "missing": [], "forbidden": []}


def test_at_most_a_thousand_ids(client):
    assert client.post("/api/runs/batch", json={"ids": [f"r{i}" for i in range(1001)]}).status_code == 422
    body = client.post("/api/runs/batch", json={"ids": [f"r{i}" for i in range(1000)]}).json()
    assert len(body["missing"]) == 1000
