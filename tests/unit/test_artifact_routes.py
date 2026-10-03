"""The explorer's registry routes over HTTP: shapes and status codes."""

from __future__ import annotations

import json

MANIFEST = "application/vnd.cairn.artifact-manifest+json"


def _blob(client, data: bytes, mime: str) -> str:
    r = client.post("/api/artifacts", files={"file": ("b", data, mime)},
                    data={"mime_type": mime, "metadata": "{}"})
    assert r.status_code == 200, r.text
    return r.json()["hash"]


def _version(client, rid, name="ds", **extra):
    f = _blob(client, b'{"k": 1}', "application/json")
    m = _blob(client, json.dumps({"files": [
        {"path": "d/k.json", "hash": f, "size": 8, "mime": "application/json"},
        {"path": "raw.tar", "uri": "s3://b/raw.tar", "size": 3},
    ]}).encode(), MANIFEST)
    r = client.post("/api/projects/P/artifact-versions",
                    json={"name": name, "digest": m, "created_by_run": rid, **extra})
    assert r.status_code == 200, r.text
    return r.json()


def test_version_routes(client):
    rid = client.post("/api/runs", json={"project": "p", "name": "prod"}).json()["run_id"]
    v = _version(client, rid, type="dataset", step=2, aliases=["best"], tags=["t"],
                 description="d", metadata={"n": 1})
    assert {k: v[k] for k in ("project_id", "name", "type", "version", "ref", "qualified_ref",
                              "step", "aliases", "tags", "file_count", "ref_count", "size")} == {
        "project_id": "p", "name": "ds", "type": "dataset", "version": 1, "ref": "ds:v1",
        "qualified_ref": "p/ds:v1", "step": 2, "aliases": ["latest", "best"], "tags": ["t"],
        "file_count": 2, "ref_count": 1, "size": 8,
    }
    assert v["producer"]["name"] == "prod" and v["consumer_count"] == 0
    vid = v["id"]

    files = client.get(f"/api/artifact-versions/{vid}/files").json()["files"]
    assert [(f["path"], f["digest"] is None, f["uri"]) for f in files] == [
        ("d/k.json", False, None), ("raw.tar", True, "s3://b/raw.tar"),
    ]
    r = client.get(f"/api/artifact-versions/{vid}/file", params={"path": "d/k.json"})
    assert (r.status_code, r.json(), r.headers["content-type"]) == (200, {"k": 1}, "application/json")
    assert client.get(f"/api/artifact-versions/{vid}/file", params={"path": "raw.tar"}).status_code == 409
    assert client.get(f"/api/artifact-versions/{vid}/file", params={"path": "nope"}).status_code == 404

    user = client.post("/api/runs", json={"project": "p", "name": "user"}).json()["run_id"]
    client.post(f"/api/runs/{user}/inputs", json={"artifact_version_id": vid, "role": "train"})
    consumers = client.get(f"/api/artifact-versions/{vid}/consumers").json()
    assert consumers["count"] == 1 and consumers["consumers"][0]["role"] == "train"
    assert consumers["consumers"][0]["run"]["name"] == "user"
    inputs = client.get(f"/api/runs/{user}/inputs").json()["inputs"]
    assert [(i["ref"], i["role"]) for i in inputs] == [("ds:v1", "train")]
    outputs = client.get(f"/api/runs/{rid}/outputs", params={"include": "files"}).json()["outputs"]
    assert [o["ref"] for o in outputs] == ["ds:v1"] and len(outputs[0]["files"]) == 2

    for bad in ("latest", "v2"):
        assert client.post(f"/api/artifact-versions/{vid}/aliases", json={"alias": bad}).status_code == 400
        assert client.delete(f"/api/artifact-versions/{vid}/aliases/{bad}").status_code == 400
    assert client.post(f"/api/artifact-versions/{vid}/aliases", json={"alias": "prod"}).json()["aliases"] == [
        "latest", "best", "prod"]
    assert client.delete(f"/api/artifact-versions/{vid}/aliases/prod").json()["aliases"] == ["latest", "best"]
    assert client.post(f"/api/artifact-versions/{vid}/tags", json={"tag": "x"}).json()["tags"] == ["t", "x"]
    assert client.delete(f"/api/artifact-versions/{vid}/tags/t").json()["tags"] == ["x"]
    patched = client.patch(f"/api/artifact-versions/{vid}", json={"metadata": {"m": 2}}).json()
    assert (patched["metadata"], patched["description"]) == ({"n": 1, "m": 2}, "d")

    for path in (f"/api/artifact-versions/{vid}/lineage", f"/api/runs/{rid}/lineage",
                 "/api/projects/p/lineage"):
        g = client.get(path, params={"cluster": 5} if "projects" not in path else None).json()
        assert {n["kind"] for n in g["nodes"]} == {"run", "artifact_version"}
        assert {e["kind"] for e in g["edges"]} == {"produced", "consumed"}
    assert client.get(f"/api/runs/{rid}/lineage", params={"direction": "sideways"}).status_code == 422

    fam = client.get("/api/projects/p/artifact-families").json()["families"][0]
    assert (fam["version_count"], fam["aliases"]) == (1, {"best": 1, "latest": 1})
    assert client.delete(f"/api/artifact-versions/{vid}").status_code == 409
    assert client.delete(f"/api/artifact-versions/{vid}", params={"force": "true"}).status_code == 200
    assert client.get(f"/api/artifact-versions/{vid}").status_code == 404


def test_create_errors(client):
    assert client.post("/api/projects/p/artifact-versions",
                       json={"name": "x", "digest": "0" * 64}).status_code == 404
    m = _blob(client, json.dumps({"files": [{"path": "a", "uri": "s3://a"}]}).encode(), MANIFEST)
    assert client.post("/api/projects/p/artifact-versions",
                       json={"name": "a:b", "digest": m}).status_code == 400
    assert client.post("/api/projects/p/artifact-versions",
                       json={"name": "x", "digest": m, "aliases": ["latest"]}).status_code == 400
    assert client.post("/api/projects/p/artifact-versions", json={"name": "x", "digest": m}).status_code == 200
    assert client.post("/api/projects/p/artifact-versions",
                       json={"name": "x", "digest": m, "type": "model"}).status_code == 400
    assert client.post("/api/projects/p/resolve-artifact-ref", json={"ref": "x:nope"}).status_code == 404
    assert client.post("/api/projects/q/resolve-artifact-ref", json={"ref": "p/x"}).json()["ref"] == "x:v1"


def test_runs_query_route(client):
    for name in ("a", "b"):
        rid = client.post("/api/runs", json={"project": "p", "name": name}).json()["run_id"]
        client.post(f"/api/runs/{rid}/params", json={"params": {"m": {"d": 1 if name == "a" else 2}}})
    body = {"project": "p", "predicates": [["m", "gt", "d", 1]], "include": ["config"]}
    out = client.post("/api/runs/query", json=body).json()
    assert out["total"] == 1 and out["runs"][0]["config_doc"] == {"m": {"d": 2}}
    assert client.post("/api/runs/query", json={"sort": {"key": "bogus"}}).status_code == 400
    assert client.post("/api/runs/query", json={"predicates": [["m", "nope", None, 1]]}).status_code == 400
    assert [r["display_name"] for r in client.get(
        "/api/runs", params={"sort": "config.m.d", "desc": "true"}).json()["runs"]] == ["b", "a"]
