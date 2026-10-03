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
    runs = {n["id"]: n for n in graph["nodes"] if n["type"] == "run"}
    assert runs[ids["train"]]["name"] == "train"
    assert runs[ids["train"]]["status"] == "completed"
    assert runs[ids["eval"]]["status"] == "running"
    versions = {n["id"]: n for n in graph["nodes"] if n["type"] == "artifact_version"}
    assert versions[ids["data"]]["qualified_ref"] == "p/data:v1"
    assert versions[ids["data"]]["aliases"] == ["latest"]
    edges = {(e["source"], e["target"], e["relation"], e.get("role")) for e in graph["edges"]}
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
