"""The lineage graph's node/edge shape (what the UI's LineagePage reads)."""

from __future__ import annotations

from cairn.server import artifact_registry_ops as ops
from cairn.server import ingest_ops


def test_run_nodes_carry_label_and_status(fresh_db, blob_store):
    db = fresh_db
    producer = ingest_ops.create_run(db, project="p", name="train")["run_id"]
    consumer = ingest_ops.create_run(db, project="p", name="eval")["run_id"]
    ingest_ops.finish_run(db, producer, "completed")
    digest = ingest_ops.put_artifact(db, blob_store, b"w", "application/octet-stream")["hash"]
    version = ops.create_artifact_version(
        db, project_id="p", family_name="model", digest=digest, size_bytes=1,
        created_by_run=producer,
    )
    ops.record_input(db, run_id=consumer, artifact_version_id=version["id"])

    graph = ops.get_lineage_graph(db, "p")

    runs = {n["id"]: n for n in graph["nodes"] if n["type"] == "run"}
    assert runs[producer]["label"] == "train"
    assert runs[producer]["metadata"] == {"status": "completed"}
    assert runs[consumer]["label"] == "eval"
    assert runs[consumer]["metadata"] == {"status": "running"}
    assert sorted((e["source"], e["target"], e["relation"]) for e in graph["edges"]) == sorted([
        (producer, version["id"], "produced"),
        (version["id"], consumer, "consumed"),
    ])
    # Each run appears once even with several edges.
    assert len([n for n in graph["nodes"] if n["type"] == "run"]) == 2
