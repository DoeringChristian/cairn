"""The lineage graph's node/edge shapes and walks (what the lineage viewer reads)."""

from __future__ import annotations

import json

import pytest

from cairn.server import artifact_registry_ops as ops
from cairn.server import ingest_ops


def _version(db, blobs, name, run=None, payload=b"w"):
    digest = ingest_ops.put_artifact(db, blobs, payload, "application/octet-stream")["hash"]
    manifest = json.dumps({"files": [{"path": "w.bin", "hash": digest, "size": len(payload),
                                      "mime": "application/octet-stream"}]}).encode()
    mdigest = ingest_ops.put_artifact(
        db, blobs, manifest, "application/vnd.cairn.artifact-manifest+json",
    )["hash"]
    return ops.create_version(db, blobs, project_id="p", name=name, digest=mdigest,
                              created_by_run=run)


@pytest.fixture
def chain(fresh_db, blob_store):
    """train -> data:v1 -> eval -> report:v1 -> publish; train also -> other:v1."""
    db = fresh_db
    train = ingest_ops.create_run(db, project="p", name="train")["run_id"]
    ev = ingest_ops.create_run(db, project="p", name="eval")["run_id"]
    pub = ingest_ops.create_run(db, project="p", name="publish")["run_id"]
    ingest_ops.finish_run(db, train, "completed")
    data = _version(db, blob_store, "data", train)
    other = _version(db, blob_store, "other", train, b"o")
    ops.record_input(db, run_id=ev, artifact_version_id=data["id"], role="dataset")
    report = _version(db, blob_store, "report", ev, b"r")
    ops.record_input(db, run_id=pub, artifact_version_id=report["id"])
    return db, {"train": train, "eval": ev, "publish": pub, "data": data["id"],
                "other": other["id"], "report": report["id"]}


def _ids(graph):
    return {n["id"] for n in graph["nodes"]}


def test_project_graph_nodes_and_edges(chain):
    db, ids = chain
    graph = ops.project_lineage(db, "p")
    runs = {n["id"]: n for n in graph["nodes"] if n["kind"] == "run"}
    assert runs[ids["train"]]["name"] == "train"
    assert runs[ids["train"]]["status"] == "completed"
    assert runs[ids["eval"]]["status"] == "running"
    versions = {n["id"]: n for n in graph["nodes"] if n["kind"] == "artifact_version"}
    assert versions[ids["data"]]["qualified_ref"] == "p/data:v1"
    assert versions[ids["data"]]["aliases"] == ["latest"]
    edges = {(e["source"], e["target"], e["kind"], e.get("role")) for e in graph["edges"]}
    assert (ids["train"], ids["data"], "produced", None) in edges
    assert (ids["data"], ids["eval"], "consumed", "dataset") in edges
    assert len(runs) == 3


def test_version_centred_walks(chain):
    db, ids = chain
    down = ops.lineage_graph(db, version_id=ids["data"], direction="downstream")
    assert down["center"] == ids["data"]
    assert _ids(down) == {ids["data"], ids["eval"], ids["report"], ids["publish"]}
    up = ops.lineage_graph(db, version_id=ids["report"], direction="upstream")
    assert _ids(up) == {ids["report"], ids["eval"], ids["data"], ids["train"]}
    # "both" never turns around: train's other output is a sibling, not lineage.
    both = ops.lineage_graph(db, version_id=ids["data"])
    assert ids["other"] not in _ids(both)
    one = ops.lineage_graph(db, version_id=ids["data"], depth=1)
    assert _ids(one) == {ids["data"], ids["train"], ids["eval"]}


def test_run_centred_walk(chain):
    db, ids = chain
    graph = ops.lineage_graph(db, run_id=ids["eval"], depth=1)
    assert _ids(graph) == {ids["eval"], ids["data"], ids["report"]}
    with pytest.raises(LookupError):
        ops.lineage_graph(db, run_id="nope")
    with pytest.raises(ValueError):
        ops.lineage_graph(db, run_id=ids["eval"], direction="sideways")


def test_nodes_carry_what_the_viewer_edits(fresh_db, blob_store):
    db = fresh_db
    rid = ingest_ops.create_run(db, project="p", name="train", tags=["a"], group="g",
                                job_type="train")["run_id"]
    v = _version(db, blob_store, "m", rid)
    ops.add_tag(db, v["id"], "candidate")
    graph = ops.lineage_graph(db, run_id=rid)
    run = next(n for n in graph["nodes"] if n["kind"] == "run")
    assert (run["label"], run["tags"], run["group"], run["job_type"], run["status"]) == (
        "train", ["a"], "g", "train", "running")
    ver = next(n for n in graph["nodes"] if n["kind"] == "artifact_version")
    assert (ver["label"], ver["type"], ver["aliases"], ver["tags"]) == (
        "m:v1", "artifact", ["latest"], ["candidate"])
    assert run["degree"] == {"in": 0, "out": 1} and ver["degree"] == {"in": 1, "out": 0}


def test_sibling_groups_and_server_side_clustering(fresh_db, blob_store):
    """50 runs use one dataset and each log a checkpoint: the runs share a
    group, so do their checkpoints; cluster=N collapses sets larger than N."""
    db = fresh_db
    prep = ingest_ops.create_run(db, project="p", name="prep")["run_id"]
    data = _version(db, blob_store, "data", prep)
    runs = []
    for i in range(50):
        rid = ingest_ops.create_run(db, project="p", name=f"t{i}")["run_id"]
        ops.record_input(db, run_id=rid, artifact_version_id=data["id"])
        _version(db, blob_store, "ckpt", rid, f"c{i}".encode())
        runs.append(rid)

    graph = ops.lineage_graph(db, version_id=data["id"], direction="downstream")
    assert len(graph["nodes"]) == 101
    kinds = {g["member_kind"]: g for g in graph["groups"]}
    assert sorted(kinds["run"]["members"]) == sorted(runs)
    assert len(kinds["artifact_version"]["members"]) == 50
    by_id = {n["id"]: n for n in graph["nodes"]}
    assert by_id[data["id"]]["group_key"] is None  # the centre is never grouped
    assert {by_id[r]["group_key"] for r in runs} == {kinds["run"]["group_key"]}

    small = ops.lineage_graph(db, version_id=data["id"], direction="downstream", cluster=10)
    nodes = {n["id"]: n for n in small["nodes"]}
    groups = [n for n in small["nodes"] if n["kind"] == "group"]
    assert len(small["nodes"]) == 3 and len(groups) == 2
    run_group = next(g for g in groups if g["member_kind"] == "run")
    assert run_group["count"] == 50 and run_group["label"] == "50 runs"
    edge_counts = {(e["source"], e["target"], e["kind"]): e["count"] for e in small["edges"]}
    assert edge_counts[(data["id"], run_group["id"], "consumed")] == 50
    assert set(nodes) == {data["id"], *(g["id"] for g in groups)}
    # Below the threshold nothing collapses.
    assert len(ops.lineage_graph(db, version_id=data["id"], cluster=60)["nodes"]) == 102  # + prep
