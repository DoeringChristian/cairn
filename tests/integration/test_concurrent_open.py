"""Many processes opening the same FRESH local repo at once.

The first open of a new database switches it to WAL mode
(``PRAGMA journal_mode=WAL``) and creates the schema. Both need the database to
themselves, and SQLite answers a concurrent journal-mode switch with an
immediate "database is locked" rather than waiting out the busy timeout — so a
sweep launching eight workers against a brand-new repo used to lose some of
them at ``cairn.Run(...)``. ``Database.open`` now serializes that first open
across processes.
"""

from __future__ import annotations

import multiprocessing as mp
import sqlite3
import time
from pathlib import Path

import pytest

N_PROCS = 8


def _open_and_write(repo: str, start_at: float, index: int, out) -> None:
    try:
        # Line everyone up on the same instant so the opens really collide.
        delay = start_at - time.time()
        if delay > 0:
            time.sleep(delay)
        import cairn

        with cairn.Run(
            project="concurrent-open",
            name=f"w{index}",
            repo=repo,
            capture_source=False,
            capture_stdout=False,
            capture_env=False,
            capture_system_metrics=False,
        ) as run:
            for step in range(3):
                run.track(float(step), name="loss", step=step)
        out.put((index, None))
    except BaseException as exc:  # report every failure, not just the first
        out.put((index, f"{type(exc).__name__}: {exc}"))


@pytest.mark.timeout(120)
def test_processes_open_a_fresh_repo_concurrently(tmp_path: Path):
    repo = tmp_path / ".cairn"
    ctx = mp.get_context("spawn")
    out = ctx.Queue()
    # Spawned interpreters take a moment to import cairn; aim past that.
    start_at = time.time() + 3.0
    procs = [
        ctx.Process(target=_open_and_write, args=(str(repo), start_at, i, out))
        for i in range(N_PROCS)
    ]
    for p in procs:
        p.start()
    results = dict(out.get(timeout=90) for _ in procs)
    for p in procs:
        p.join(timeout=30)

    errors = {i: err for i, err in results.items() if err}
    assert not errors, errors

    con = sqlite3.connect(repo / "cairn.db")
    try:
        assert con.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        names = {r[0] for r in con.execute("SELECT display_name FROM runs")}
        assert con.execute("SELECT COUNT(*) FROM schema_version").fetchone()[0] == 1
    finally:
        con.close()
    assert names == {f"w{i}" for i in range(N_PROCS)}
