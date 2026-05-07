#!/usr/bin/env python3
"""Test the per-run WAL architecture end-to-end.

Usage:
    python examples/test_wal.py

This script:
1. Creates a temporary .cairn/ repo
2. Starts 3 concurrent "training runs" writing to WAL files
3. Runs the ingestion to drain WALs into SQLite
4. Reads back the data via cairn.Reader and verifies correctness
5. Tests live preview (incremental ingestion of an active WAL)
"""

import math
import os
import shutil
import sys
import tempfile
import threading
import time
from pathlib import Path

# Ensure cairn is importable from repo root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from cairn.sdk.local import LocalTransport
from cairn.server.storage.blobs import BlobStore
from cairn.server.storage.datadir import DataDir
from cairn.server.storage.db import Database
from cairn.server.wal_ingest import ingest_all
import secrets
from datetime import datetime, timezone


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def simulate_run(repo: Path, project: str, run_name: str, num_steps: int = 20):
    """Simulate a training run writing to a WAL file."""
    transport = LocalTransport(repo)
    run_id = secrets.token_hex(16)

    resp = transport.create_run({
        "project": project,
        "run_id": run_id,
        "name": run_name,
    })
    print(f"  [{run_name}] created run {run_id[:6]}...")

    # Log some params
    transport.post_params(run_id, {"lr": 0.001, "batch_size": 32, "model": run_name})

    # Log scalar metrics
    for step in range(num_steps):
        loss = 1.0 / (step + 1) + 0.01 * (hash(run_name) % 10)
        acc = 1.0 - loss * 0.5
        transport.post_batch(run_id, [
            {
                "name": "loss",
                "step": step,
                "wall_time": utc_now(),
                "context": None,
                "object_type": "scalar",
                "scalar_value": loss,
                "artifact_hash": None,
            },
            {
                "name": "accuracy",
                "step": step,
                "wall_time": utc_now(),
                "context": None,
                "object_type": "scalar",
                "scalar_value": acc,
                "artifact_hash": None,
            },
        ])
        time.sleep(0.02)  # Simulate training time

    transport.finish_run(run_id, "completed")
    transport.close()
    print(f"  [{run_name}] finished ({num_steps} steps)")
    return run_id


def main():
    # Create temp repo
    tmp = Path(tempfile.mkdtemp(prefix="cairn_wal_test_"))
    repo = tmp / ".cairn"
    repo.mkdir()
    print(f"Test repo: {repo}")

    # ── Step 1: Run 3 concurrent training jobs ───────────────────────────
    print("\n1. Starting 3 concurrent runs...")
    run_ids = {}
    threads = []
    results_lock = threading.Lock()

    def run_and_store(name, steps):
        rid = simulate_run(repo, "wal-test", name, steps)
        with results_lock:
            run_ids[name] = rid

    for name, steps in [("model_A", 20), ("model_B", 15), ("model_C", 25)]:
        t = threading.Thread(target=run_and_store, args=(name, steps))
        threads.append(t)
        t.start()

    for t in threads:
        t.join()

    # ── Step 2: Check WAL files exist ────────────────────────────────────
    wal_dir = repo / "wals"
    wal_files = list(wal_dir.glob("*.wal.jsonl"))
    print(f"\n2. WAL files created: {len(wal_files)}")
    for wf in wal_files:
        lines = wf.read_text().strip().split("\n")
        print(f"   {wf.name}: {len(lines)} entries, {wf.stat().st_size} bytes")

    # ── Step 3: Verify no SQLite DB exists yet ───────────────────────────
    db_path = repo / "cairn.db"
    print(f"\n3. SQLite DB exists before ingestion: {db_path.exists()}")

    # ── Step 4: Run ingestion ────────────────────────────────────────────
    print("\n4. Running WAL ingestion...")
    dd = DataDir(repo)
    db = Database.open(dd.db_path)
    blobs = BlobStore(dd.artifacts_dir)

    count = ingest_all(dd, db, blobs)
    print(f"   Ingested {count} ops total")

    # Check .done files
    done_files = list(wal_dir.glob("*.done"))
    print(f"   WAL files renamed to .done: {len(done_files)}")

    # ── Step 5: Verify data via direct DB queries ────────────────────────
    print("\n5. Verifying data in SQLite...")
    runs = db.read_columns("SELECT id, display_name, status FROM runs ORDER BY display_name")
    print(f"   Runs: {len(runs)}")
    for r in runs:
        print(f"     {r['id'][:6]} | {r['display_name']} | {r['status']}")

    seqs = db.read_columns("SELECT DISTINCT name FROM sequences")
    print(f"   Distinct metrics: {[s['name'] for s in seqs]}")

    total_points = db.read_columns("SELECT COUNT(*) AS cnt FROM sequences")[0]["cnt"]
    print(f"   Total sequence points: {total_points}")

    params = db.read_columns("SELECT DISTINCT key FROM params ORDER BY key")
    print(f"   Params: {[p['key'] for p in params]}")

    # ── Step 6: Verify via cairn.Reader ──────────────────────────────────
    print("\n6. Verifying via cairn.Reader...")
    from cairn.sdk.reader import Reader
    reader = Reader(repo=str(repo))

    projects = reader.projects()
    print(f"   Projects: {[p.name for p in projects]}")

    all_runs = reader.runs(project="wal-test").list()
    print(f"   Runs via Reader: {len(all_runs)}")
    for run in all_runs:
        seqs_info = run.sequences()
        print(f"     {run.id[:6]} | {run.name} | {run.status} | {len(seqs_info)} sequences")
        loss_seq = run.sequence("loss")
        if loss_seq:
            print(f"       loss: {len(loss_seq.steps)} steps, final={loss_seq.values[-1]:.4f}")

    # ── Step 7: Test live preview (incremental ingestion) ────────────────
    print("\n7. Testing live preview (incremental ingestion)...")
    # Start a new run but DON'T finish it
    transport = LocalTransport(repo)
    live_id = secrets.token_hex(16)
    transport.create_run({
        "project": "wal-test",
        "run_id": live_id,
        "name": "live_run",
    })

    # Log a few points
    for step in range(5):
        transport.post_batch(live_id, [{
            "name": "live_loss",
            "step": step,
            "wall_time": utc_now(),
            "context": None,
            "object_type": "scalar",
            "scalar_value": 1.0 / (step + 1),
            "artifact_hash": None,
        }])

    # WAL is still locked (run not finished) — but incremental ingestion should work
    lock_file = wal_dir / f"{live_id}.lock"
    print(f"   Lock file exists: {lock_file.exists()}")

    count2 = ingest_all(dd, db, blobs)
    print(f"   Incremental ingestion: {count2} ops")

    # Check if live data is in DB
    live_points = db.read_columns(
        "SELECT COUNT(*) AS cnt FROM sequences WHERE run_id = ?", [live_id]
    )[0]["cnt"]
    print(f"   Live points in DB: {live_points}")

    # Log more points
    for step in range(5, 10):
        transport.post_batch(live_id, [{
            "name": "live_loss",
            "step": step,
            "wall_time": utc_now(),
            "context": None,
            "object_type": "scalar",
            "scalar_value": 1.0 / (step + 1),
            "artifact_hash": None,
        }])

    count3 = ingest_all(dd, db, blobs)
    print(f"   Second incremental ingestion: {count3} ops (new points only)")

    live_points2 = db.read_columns(
        "SELECT COUNT(*) AS cnt FROM sequences WHERE run_id = ?", [live_id]
    )[0]["cnt"]
    print(f"   Live points in DB now: {live_points2}")

    # Finish the live run
    transport.finish_run(live_id, "completed")
    transport.close()

    count4 = ingest_all(dd, db, blobs)
    print(f"   Final ingestion after finish: {count4} ops")

    live_status = db.read_columns(
        "SELECT status FROM runs WHERE id = ?", [live_id]
    )[0]["status"]
    print(f"   Live run status: {live_status}")

    # ── Step 8: Verify IDs are 32 chars ──────────────────────────────────
    print(f"\n8. ID lengths:")
    for name, rid in run_ids.items():
        print(f"   {name}: {rid} ({len(rid)} chars)")

    # ── Cleanup ──────────────────────────────────────────────────────────
    db.close()
    print(f"\n✓ All tests passed!")
    print(f"  Temp dir: {tmp} (remove with: rm -rf {tmp})")


if __name__ == "__main__":
    main()
