"""Run logs under stress: many processes logging to one repo, writers and
ingesters killed with SIGKILL, a server ingesting while runs log."""

from __future__ import annotations

import multiprocessing as mp
import signal
import subprocess
import sys
import textwrap
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import cairn
from cairn.server import config_doc, wal_ingest
from cairn.server.app import create_app
from cairn.server.storage.blobs import BlobStore
from cairn.server.storage.datadir import DataDir
from cairn.server.storage.db import Database
from tests.conftest import ingest_repo

QUIET = {"capture_source": False, "capture_stdout": False, "capture_env": False,
         "capture_system_metrics": False}
N_PROCS = 8
RUNS_PER_PROC = 3
STEPS = 150


def _writer(repo: str, index: int, start_at: float, out) -> None:
    try:
        delay = start_at - time.time()
        if delay > 0:
            time.sleep(delay)
        import cairn as c

        for k in range(RUNS_PER_PROC):
            with c.Run("stress", name=f"p{index}-r{k}", repo=repo, **QUIET) as run:
                run.config(proc=index, run=k)
                for s in range(STEPS):
                    run.track(float(s * index), name="loss", step=s)
                    if s % 50 == 0:
                        run.track(c.Text(f"t{index}-{k}-{s}"), name="txt", step=s)
                run.summary(final=float(index * k))
                run.set_tag(f"proc{index}")
        out.put((index, None))
    except BaseException as exc:  # noqa: BLE001
        out.put((index, f"{type(exc).__name__}: {exc}"))


def _spawn_writers(repo: Path) -> None:
    ctx = mp.get_context("spawn")
    out = ctx.Queue()
    start_at = time.time() + 3.0
    procs = [ctx.Process(target=_writer, args=(str(repo), i, start_at, out)) for i in range(N_PROCS)]
    for p in procs:
        p.start()
    results = dict(out.get(timeout=150) for _ in procs)
    for p in procs:
        p.join(timeout=30)
    errors = {i: e for i, e in results.items() if e}
    assert not errors, errors


def _check_exact(repo: Path) -> None:
    db = Database.open(DataDir(repo).db_path)
    try:
        n_runs = N_PROCS * RUNS_PER_PROC
        assert db.read_one("SELECT COUNT(*) FROM runs WHERE status = 'completed'") == (n_runs,)
        assert db.read_one("SELECT COUNT(*) FROM runs") == (n_runs,)
        assert db.read_one("SELECT COUNT(*) FROM sequences WHERE name = 'loss'") == (n_runs * STEPS,)
        assert db.read_one("SELECT COUNT(*) FROM sequences WHERE name = 'txt'") == (n_runs * 3,)
        for name, total in db.read(
            "SELECT r.display_name, SUM(s.scalar_value) FROM runs r "
            "JOIN sequences s ON s.run_id = r.id AND s.name = 'loss' GROUP BY r.id"
        ):
            index = int(name[1:].split("-")[0])
            assert total == pytest.approx(sum(s * index for s in range(STEPS))), name
        assert db.read_one("SELECT COUNT(*) FROM params") == (2 * n_runs,)
        assert db.read_one("SELECT COUNT(*) FROM summary") == (n_runs,)
        # Every finished log was deleted with its progress row.
        assert db.read_one("SELECT COUNT(*) FROM wal_progress") == (0,)
    finally:
        db.close()
    assert list((repo / "wals").glob("*")) == []


@pytest.mark.timeout(240)
def test_many_processes_without_a_server(tmp_path):
    repo = tmp_path / ".cairn"
    _spawn_writers(repo)
    with cairn.Reader(repo) as reader:  # catches up under the lease
        assert len(reader.runs("stress").list()) == N_PROCS * RUNS_PER_PROC
    _check_exact(repo)


@pytest.mark.timeout(240)
def test_many_processes_while_a_server_ingests(tmp_path):
    repo = tmp_path / ".cairn"
    with TestClient(create_app(data_dir=repo)):
        _spawn_writers(repo)
        deadline = time.monotonic() + 30
        while list((repo / "wals").glob("*.wal.jsonl")):
            assert time.monotonic() < deadline, "the server did not finish ingesting"
            time.sleep(0.2)
    _check_exact(repo)


_KILLED_WRITER = textwrap.dedent("""
    import sys, cairn
    run = cairn.Run("k", repo=sys.argv[1], capture_source=False, capture_stdout=False,
                    capture_env=False, capture_system_metrics=False)
    print(run.id, flush=True)
    s = 0
    while True:
        run.track(float(s), name="loss", step=s)
        run.track(cairn.Text("x" * 5000), name="big", step=s)
        s += 1
""")


@pytest.mark.timeout(120)
def test_kill_9_writer_mid_append(tmp_path, monkeypatch):
    """A writer killed mid-append: its torn last line is skipped, everything
    complete is ingested once, and the run turns ``crashed`` once its log
    has been idle for the (here shortened) stale time."""
    repo = tmp_path / ".cairn"
    proc = subprocess.Popen(
        [sys.executable, "-c", _KILLED_WRITER, str(repo)], stdout=subprocess.PIPE, text=True,
    )
    rid = proc.stdout.readline().strip()
    log = repo / "wals" / f"{rid}.wal.jsonl"
    deadline = time.monotonic() + 30
    while not log.exists() or log.stat().st_size < 200_000:
        assert time.monotonic() < deadline
        time.sleep(0.02)
    proc.send_signal(signal.SIGKILL)
    proc.wait(timeout=30)

    monkeypatch.setattr(wal_ingest, "STALE_SECONDS", 0.5)
    dd = DataDir(repo)
    db = Database.open(dd.db_path)
    blobs = BlobStore(dd.artifacts_dir)
    try:
        wal_ingest.ingest_all(dd, db, blobs)
        complete = log.read_bytes()
        complete = complete[: complete.rfind(b"\n") + 1]
        (offset,) = db.read_one('SELECT "offset" FROM wal_progress')
        assert offset == len(complete)  # a torn tail, if any, is not consumed
        points = db.read_one("SELECT COUNT(*) FROM sequences WHERE run_id = ?", [rid])[0]
        assert points > 0
        time.sleep(1.0)
        wal_ingest.ingest_all(dd, db, blobs)
        assert db.read_one("SELECT status FROM runs WHERE id = ?", [rid]) == ("crashed",)
        # Nothing was applied twice.
        assert db.read_one("SELECT COUNT(*) FROM sequences WHERE run_id = ?", [rid])[0] == points
        assert db.read_one(
            "SELECT COUNT(*) FROM (SELECT name, step FROM sequences WHERE run_id = ? "
            "GROUP BY name, step HAVING COUNT(*) > 1)", [rid],
        ) == (0,)
    finally:
        db.close()
    assert log.exists()  # no finish record: kept


_KILLED_INGESTER = textwrap.dedent("""
    import os, sys
    from cairn.server import config_doc, wal_ingest
    from cairn.server.storage.blobs import BlobStore
    from cairn.server.storage.datadir import DataDir
    from cairn.server.storage.db import Database

    real = wal_ingest._apply_record
    n = {"i": 0}
    def dying(*a, **kw):
        n["i"] += 1
        if n["i"] == int(sys.argv[2]):
            os.kill(os.getpid(), 9)   # SIGKILL mid-batch, before the commit
        return real(*a, **kw)
    wal_ingest._apply_record = dying
    dd = DataDir(sys.argv[1])
    db = Database.open(dd.db_path)
    wal_ingest.ingest_all(dd, db, BlobStore(dd.artifacts_dir))
""")


@pytest.mark.timeout(120)
def test_ingester_killed_before_committing(tmp_path):
    """SIGKILL between applying a batch's ops and committing its offset: the
    next ingester applies the batch again, exactly once."""
    repo = tmp_path / ".cairn"
    with cairn.Run("k", repo=repo, **QUIET) as run:
        for s in range(300):
            run.track(float(s), name="loss", step=s)
            if s % 100 == 0:
                run.alert(f"a{s}")
        rid = run.id
    r = subprocess.run([sys.executable, "-c", _KILLED_INGESTER, str(repo), "4"], timeout=60, check=False)
    assert r.returncode == -9
    db = Database.open(DataDir(repo).db_path)
    try:
        assert db.read_one("SELECT COUNT(*) FROM runs") == (0,)  # nothing committed
    finally:
        db.close()
    ingest_repo(repo)
    db = Database.open(DataDir(repo).db_path)
    try:
        assert db.read_one("SELECT COUNT(*) FROM sequences WHERE run_id = ?", [rid]) == (300,)
        assert db.read_one("SELECT COUNT(*) FROM alerts WHERE run_id = ?", [rid]) == (3,)
        assert db.read_one("SELECT status FROM runs WHERE id = ?", [rid]) == ("completed",)
    finally:
        db.close()


@pytest.mark.timeout(60)
def test_server_restart_mid_run_does_not_reread(tmp_path, monkeypatch):
    """Two server lifetimes over one live run: every record of its log is
    applied exactly once in total (none re-read from 0 after the restart)."""
    applied = []
    real = wal_ingest._apply_record

    def counting(db, data_dir, blobs, record, run_id):
        applied.append(record["seq"])
        return real(db, data_dir, blobs, record, run_id)

    monkeypatch.setattr(wal_ingest, "_apply_record", counting)
    repo = tmp_path / ".cairn"
    run = cairn.Run("r", repo=repo, **QUIET)
    for s in range(50):
        run.track(float(s), name="loss", step=s)
    time.sleep(1.0)  # the metric buffer flushes every 0.5 s
    with TestClient(create_app(data_dir=repo)) as client:
        client.post("/api/ingest/pending")
        first = client.app.state.db.read_one('SELECT "offset" FROM wal_progress')[0]
        assert first > 0 and applied
    n_first = len(applied)
    for s in range(50, 60):
        run.track(float(s), name="loss", step=s)
    run.finish()
    log = repo / "wals" / f"{run.id}.wal.jsonl"
    total = len(log.read_bytes().splitlines())
    with TestClient(create_app(data_dir=repo)) as client:  # "restarted"
        client.post("/api/ingest/pending")
        db = client.app.state.db
        assert db.read_one("SELECT COUNT(*) FROM sequences WHERE name = 'loss'") == (60,)
        assert db.read_one("SELECT status FROM runs") == ("completed",)
    assert sorted(applied) == list(range(1, total + 1))  # each record once
    assert len(applied) - n_first == total - n_first < total
    assert not log.exists()


@pytest.mark.timeout(60)
def test_latency_from_log_to_ingested(tmp_path):
    """A server ingests a record within its ~2 s cycle."""
    repo = tmp_path / ".cairn"
    lat = []
    with TestClient(create_app(data_dir=repo)) as client:
        db = client.app.state.db
        with cairn.Run("lat", repo=repo, **QUIET) as run:
            for i in range(5):
                t0 = time.monotonic()
                run.summary(i=i)
                while True:
                    row = db.read_one("SELECT summary FROM runs WHERE id = ?", [run.id])
                    if row and row[0] and config_doc.loads(row[0]).get("i") == i:
                        break
                    assert time.monotonic() - t0 < 5, "not ingested within 5 s"
                    time.sleep(0.01)
                lat.append(time.monotonic() - t0)
    print(f"log -> ingested latency: {[f'{x:.2f}' for x in lat]}")
    assert max(lat) < 2.6
