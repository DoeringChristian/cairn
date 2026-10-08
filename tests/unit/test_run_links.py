"""Direct run -> run links (``run.use_run`` / ``uses=``), their lineage
edges, and the group graph / group list endpoints."""

from __future__ import annotations

import httpx
import pytest

import cairn
from cairn.sdk.local import LocalTransport
from cairn.server import artifact_registry_ops
from cairn.server.storage.datadir import DataDir
from cairn.server.storage.db import Database
from tests.conftest import ingest_repo

QUIET = {"capture_source": False, "capture_stdout": False, "capture_env": False,
         "capture_system_metrics": False}


def _create(client, name=None, group=None, project="p", **kw) -> str:
    r = client.post("/api/runs", json={"project": project, "name": name, "group": group, **kw})
    assert r.status_code == 200, r.text
    return r.json()["run_id"]


def _use(client, run_id, used, role=None):
    return client.post(f"/api/runs/{run_id}/uses", json={"run_id": used, "role": role})


# ---- run links: local --------------------------------------------------------


def test_use_run_on_a_local_repo(tmp_path):
    repo = tmp_path / ".cairn"
    with cairn.Run("p", name="train", repo=repo, **QUIET) as train:
        pass
    with cairn.Run("p", name="prep", repo=repo, **QUIET) as prep:
        pass
    with cairn.Run("p", name="eval", repo=repo, uses=[train], **QUIET) as ev:
        ev.use_run(prep.id, role="data")
        ev.use_run(train.id, role="ignored")  # idempotent: the first role stays
        with pytest.raises(ValueError):
            ev.use_run(ev.id)
        with pytest.raises(ValueError):
            ev.use_run("")
        with pytest.raises(LookupError):
            ev.use_run("nope")

    reader = cairn.Reader(repo=repo)
    try:
        run = reader.run(ev.id)
        assert [r.id for r in run.uses()] == [train.id, prep.id]
        assert [r.id for r in reader.run(train.id).used_by()] == [ev.id]
        graph = reader.lineage("p")
    finally:
        reader.close()
    assert {"source": train.id, "target": ev.id, "kind": "used", "role": None} in graph["edges"]
    assert {"source": prep.id, "target": ev.id, "kind": "used", "role": "data"} in graph["edges"]


def test_use_run_record_is_replayed_from_the_log(tmp_path):
    repo = tmp_path / ".cairn"
    t = LocalTransport(repo)
    up = t.create_run({"project": "p", "run_id": "a" * 32})["run_id"]
    t.close()
    t = LocalTransport(repo)
    down = t.create_run({"project": "p", "run_id": "b" * 32})["run_id"]
    # The used run is still only in its (un-ingested) log: known all the same.
    t.record_run_use(down, up, "base")
    t.close()
    ingest_repo(repo)
    db = Database.open(DataDir(repo).db_path)
    try:
        assert artifact_registry_ops.run_uses(db, down) == {
            "uses": [{"run_id": up, "role": "base"}], "used_by": [],
        }
    finally:
        db.close()


def test_uses_validates_entries_before_creating_the_run(tmp_path):
    repo = tmp_path / ".cairn"
    with pytest.raises(ValueError):
        cairn.Run("p", repo=repo, uses=[""], **QUIET)
    with pytest.raises(ValueError):
        cairn.Run("p", repo=repo, uses=[123], **QUIET)
    # An unknown run fails the new run.
    with pytest.raises(LookupError):
        cairn.Run("p", repo=repo, uses=["missing"], run_id="x" * 32, **QUIET)
    ingest_repo(repo)
    reader = cairn.Reader(repo=repo)
    try:
        assert reader.run("x" * 32).status == "failed"
    finally:
        reader.close()


def test_disabled_run_ignores_uses(tmp_path):
    run = cairn.Run("p", mode="disabled", uses=["whatever"])
    run.use_run("other")
    run.finish()


# ---- run links: HTTP ----------------------------------------------------------


def test_uses_route(client):
    a, b, c = _create(client, "a"), _create(client, "b"), _create(client, "c")
    assert _use(client, b, a).status_code == 200
    assert _use(client, b, a, role="other").status_code == 200  # no-op
    assert _use(client, c, b, role="eval").status_code == 200
    assert client.get(f"/api/runs/{b}/uses").json() == {
        "uses": [{"run_id": a, "role": None}],
        "used_by": [{"run_id": c, "role": "eval"}],
    }
    assert _use(client, b, b).status_code == 400
    assert _use(client, b, "missing").status_code == 404
    assert _use(client, "missing", a).status_code == 404
    assert client.get("/api/runs/missing/uses").status_code == 404

    edges = client.get(f"/api/runs/{b}/lineage").json()["edges"]
    assert {"source": a, "target": b, "kind": "used", "role": None} in edges
    assert {"source": b, "target": c, "kind": "used", "role": "eval"} in edges
    nodes = {n["id"]: n for n in client.get(f"/api/runs/{b}/lineage").json()["nodes"]}
    assert nodes[b]["full_degree"] == {"in": 1, "out": 1}
    up = client.get(f"/api/runs/{b}/lineage", params={"direction": "upstream"}).json()
    assert {n["id"] for n in up["nodes"]} == {a, b}
    project = client.get("/api/projects/p/lineage").json()["edges"]
    assert sum(e["kind"] == "used" for e in project) == 2

    # Deleting a run drops its links both ways.
    assert client.delete(f"/api/runs/{b}").status_code == 200
    assert client.get(f"/api/runs/{a}/uses").json() == {"uses": [], "used_by": []}
    assert client.get(f"/api/runs/{c}/uses").json() == {"uses": [], "used_by": []}


def test_use_run_over_http(live_server):
    with cairn.Run("p", name="train", repo=live_server, **QUIET) as train:
        pass
    with cairn.Run("p", name="eval", repo=live_server, uses=[train.id], **QUIET) as ev:
        with pytest.raises(LookupError):
            ev.use_run("missing")
        with pytest.raises(ValueError):
            ev.use_run(ev)
    body = httpx.get(f"{live_server}/api/runs/{ev.id}/uses").json()
    assert body == {"uses": [{"run_id": train.id, "role": None}], "used_by": []}
    reader = cairn.Reader(repo=live_server)
    try:
        assert [r.id for r in reader.run(train.id).used_by()] == [ev.id]
    finally:
        reader.close()


# ---- groups -------------------------------------------------------------------


def test_group_graph_and_groups_over_http(live_server):
    def run(name, group="exp", **kw):
        return cairn.Run("p", name=name, group=group, repo=live_server, **QUIET, **kw)

    with run("prep") as prep:
        prep.log_artifact(cairn.Text("d"), "data", type="dataset")
        prep.log_artifact(cairn.Text("s"), "split", type="dataset")
    with run("other", group="elsewhere") as outside:
        outside.log_artifact(cairn.Text("w"), "foreign")
    with run("train") as train:
        train.use_artifact("data")
        train.use_artifact("split", role="split")
        train.use_artifact("foreign")  # cross-group: no edge
        train.log_artifact(cairn.Text("m"), "model")
        train.use_artifact("model")  # its own output: no self-edge
    with run("eval", uses=[train, outside]) as ev:  # the outside link: no edge
        ev.use_artifact("model")
    with run("train") as train2:
        pass
    with run("old") as old:
        old.use_run(train.id)
    with run(None) as unnamed:
        pass
    assert httpx.post(f"{live_server}/api/runs/{old.id}/archive").status_code == 200

    r = httpx.get(f"{live_server}/api/projects/p/groups/exp/graph")
    assert r.status_code == 200
    g = r.json()
    assert g["group"] == "exp"
    assert [(x["id"], x["name"], x["version"]) for x in g["runs"]] == [
        (prep.id, "prep", 1), (train.id, "train", 1), (ev.id, "eval", 1),
        (train2.id, "train", 2), (unnamed.id, None, None),
    ]
    assert set(g["runs"][0]) == {"id", "name", "display_name", "version", "status",
                                 "created_at", "ended_at"}
    assert g["runs"][0]["status"] == "completed"
    assert g["edges"] == [
        {"from": prep.id, "to": train.id, "via": "artifact", "artifacts": [
            {"artifact_version_id": g["edges"][0]["artifacts"][0]["artifact_version_id"],
             "artifact": "data:v1", "role": "input"},
            {"artifact_version_id": g["edges"][0]["artifacts"][1]["artifact_version_id"],
             "artifact": "split:v1", "role": "split"},
        ]},
        {"from": train.id, "to": ev.id, "via": "artifact", "artifacts": [
            {"artifact_version_id": g["edges"][1]["artifacts"][0]["artifact_version_id"],
             "artifact": "model:v1", "role": "input"},
        ]},
        {"from": train.id, "to": ev.id, "via": "run", "role": None},
    ]

    empty = httpx.get(f"{live_server}/api/projects/p/groups/nothing/graph").json()
    assert empty == {"group": "nothing", "runs": [], "edges": []}
    assert httpx.get(f"{live_server}/api/projects/nope/groups/exp/graph").status_code == 404

    groups = httpx.get(f"{live_server}/api/projects/p/groups").json()["groups"]
    assert [(x["group"], x["run_count"]) for x in groups] == [("exp", 5), ("elsewhere", 1)]
    assert all(x["last_activity"] for x in groups)
    assert httpx.get(f"{live_server}/api/projects/nope/groups").status_code == 404


def test_group_names_with_slashes(client):
    a = _create(client, "a", group="sweeps/lr")
    b = _create(client, "b", group="sweeps/lr")
    assert _use(client, b, a).status_code == 200
    g = client.get("/api/projects/p/groups/sweeps%2Flr/graph").json()
    assert g["group"] == "sweeps/lr"
    assert g["edges"] == [{"from": a, "to": b, "via": "run", "role": None}]
