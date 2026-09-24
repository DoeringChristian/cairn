"""Deleting a run removes every row that references it, so the FK holds."""

from __future__ import annotations

import cairn
from cairn.server import ingest_ops
from cairn.server.storage.datadir import DataDir
from cairn.server.storage.db import Database


def _run(repo, name):
    return cairn.Run(project="p", name=name, repo=str(repo), capture_source=False, capture_stdout=False,
                     capture_env=False, capture_system_metrics=False)


def test_delete_run_with_summary_and_inputs(tmp_path):
    repo = tmp_path / ".cairn"
    producer = _run(repo, "producer")
    producer.log_artifact(b"weights-bytes", name="weights", artifact_type="model")
    producer.finish()

    run = _run(repo, "consumer")
    run.config({"lr": 0.1})
    run.summary({"acc": 0.9})
    run.use_artifact("weights:latest")
    run.track(0.5, name="loss", step=0)
    rid = run.id
    run.finish()

    db = Database.open(repo / "cairn.db")
    ingest_ops.delete_run(db, DataDir(repo), rid)
    for table in ("runs", "params", "summary", "sequences", "run_inputs"):
        column = "id" if table == "runs" else "run_id"
        assert db.read_columns(f"SELECT 1 AS x FROM {table} WHERE {column} = ?", [rid]) == [], table
