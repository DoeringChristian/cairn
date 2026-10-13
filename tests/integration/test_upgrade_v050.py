"""Upgrading a real cairn 0.5.0 repo to 0.6 loses nothing (spec §7).

``tests/fixtures/repo-v0.5.0.tar.gz`` was made by the RELEASED 0.5.0 code
(``tests/fixtures/make_v050_repo.py``, run in a venv of the v0.5.0 tag): runs
already ingested into ``cairn.db``, runs whose logs are still pending in
``wals/`` (one half ingested), media, artifacts with aliases and a consumer,
a fork, a failed run, a report. Next to the repo, ``expected.json`` holds
every row of every table as 0.5 itself stores them once all its logs are
ingested (made from a copy, so the fixture keeps its pending logs).

The 0.6 server starts on it as a real daemon (``cairn server --daemon``,
the way a Reader starts one): it backs the 0.5 database up, migrates it,
imports the pending logs and renames them ``*.imported``. Then every 0.5 row
must be in the 0.6 database with the same values, every blob in the store,
and the runs readable over HTTP.
"""

from __future__ import annotations

import json
import os
import math
import sqlite3
import tarfile
from pathlib import Path

import pytest

import cairn
from cairn.endpoint import live_server, local_endpoint

#: ``CAIRN_V050_FIXTURE``: a tarball freshly made by ``make_v050_repo.py``
#: under the v0.5.0 tag, instead of the committed one.
FIXTURE = Path(os.environ.get("CAIRN_V050_FIXTURE")
               or Path(__file__).parent.parent / "fixtures" / "repo-v0.5.0.tar.gz")

#: Columns whose value is the moment of ingestion, not logged data: where
#: ``expected.json`` holds a value 0.5 stamped while ingesting the PENDING
#: logs (the 0.5 database did not hold it yet), the 0.6 import stamps its own.
#: Values the 0.5 database already held must be kept exactly.
INGEST_TIME_COLUMNS = {
    ("runs", "last_heartbeat"),
    ("artifacts", "created_at"),
    ("metric_stats", "updated_at"),
    ("artifact_families", "updated_at"),
    ("artifact_versions", "created_at"),
    ("projects", "created_at"),
}
#: Bookkeeping of the 0.5 ingester, not data: 0.6 retires the logs it imports.
BOOKKEEPING_TABLES = {"wal_progress", "schema_version"}


def _same(a, b) -> bool:
    if isinstance(a, float) and isinstance(b, float) and math.isnan(a) and math.isnan(b):
        return True
    if isinstance(a, str) and isinstance(b, str) and a[:1] in "{[" and b[:1] in "{[":
        try:
            return json.loads(a) == json.loads(b)
        except ValueError:
            pass
    return a == b


def _pk(con: sqlite3.Connection, table: str) -> list[str]:
    cols = sorted(
        (r[5], r[1]) for r in con.execute(f'PRAGMA table_info("{table}")') if r[5]
    )
    return [c for _, c in cols]


@pytest.fixture
def v050_repo(tmp_path) -> tuple[Path, dict]:
    with tarfile.open(FIXTURE) as tf:
        tf.extractall(tmp_path, filter="data")
    return tmp_path / ".cairn", json.loads((tmp_path / "expected.json").read_text())


@pytest.mark.real_daemons
def test_upgrade_from_v050_keeps_everything(v050_repo, monkeypatch):
    repo, expected = v050_repo
    monkeypatch.delenv("CAIRN_SERVER", raising=False)
    monkeypatch.setenv("CAIRN_REPO", str(repo))
    pending = sorted(p.name for p in (repo / "wals").glob("*.wal.jsonl"))
    assert pending == expected["pending_logs"]
    with sqlite3.connect(repo / "cairn.db") as con:
        (old_version,) = con.execute("SELECT version FROM schema_version").fetchone()
    con.close()

    ep = local_endpoint(repo)  # starts the 0.6 daemon server on the 0.5 repo
    try:
        # Readable over HTTP, as 0.5 read it.
        with cairn.Reader(repo=str(repo)) as r:
            seen = {}
            for project in {v["project"] for v in expected["runs"].values()}:
                for run in r.runs(project).list():
                    seen[run.id] = {"project": project, "name": run.name,
                                    "status": run.status, "tags": sorted(run.tags)}
            assert seen == expected["runs"]
            base = r.run(expected["ids"]["base"])
            assert base.config["lr"] == 0.1
            late = r.run(expected["ids"]["late"])
            assert late.sequence("loss").values[:2] == [3.0, 2.9]
    finally:
        with ep.client() as c:
            c.post("/api/server/shutdown")
        import time

        deadline = time.monotonic() + 15
        while live_server(repo) is not None and time.monotonic() < deadline:
            time.sleep(0.05)

    # A real daemon served it (not the test suite's in-process stand-in).
    assert "cairn daemon server for" in (repo / "server.log").read_text()

    # The 0.5 database was backed up, untouched, before migrating.
    backups = sorted((repo / "backups").glob("cairn-*-pre-0.6.db"))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as con:
        assert con.execute("SELECT version FROM schema_version").fetchone() == (old_version,)
        assert con.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    con.close()

    # The pending logs were imported and kept, renamed.
    assert sorted(p.name for p in (repo / "wals").glob("*.wal.jsonl")) == []
    assert sorted(p.name for p in (repo / "wals").glob("*.imported")) == [
        f"{n}.imported" for n in pending
    ]

    # Every 0.5 row, column by column.
    con = sqlite3.connect(f"file:{repo / 'cairn.db'}?mode=ro", uri=True)
    old = sqlite3.connect(f"file:{backups[0]}?mode=ro", uri=True)

    def held_before(table: str, keys: list[str], rec: dict, col: str) -> bool:
        where = " AND ".join(f'"{k}" IS ?' for k in keys)
        row = old.execute(f'SELECT "{col}" FROM "{table}" WHERE {where}', [rec[k] for k in keys]).fetchone()
        return row is not None and _same(row[0], rec[col])

    try:
        missing: list[str] = []
        for table, dump in expected["tables"].items():
            if table in BOOKKEEPING_TABLES:
                continue
            cols = dump["columns"]
            have = {r[1] for r in con.execute(f'PRAGMA table_info("{table}")')}
            assert have, f"table {table} is gone"
            assert set(cols) <= have, f"{table} lost columns {set(cols) - have}"
            keys = _pk(con, table) or cols
            for row in dump["rows"]:
                rec = dict(zip(cols, row, strict=True))
                where = " AND ".join(f'"{k}" IS ?' for k in keys)
                found = con.execute(
                    f'SELECT {", ".join(chr(34) + c + chr(34) for c in cols)} FROM "{table}" WHERE {where}',
                    [rec[k] for k in keys],
                ).fetchall()
                if not found:
                    missing.append(f"{table}: no row {({k: rec[k] for k in keys})}")
                    continue
                got = dict(zip(cols, found[0], strict=True))
                for c in cols:
                    if _same(got[c], rec[c]):
                        continue
                    if (table, c) not in INGEST_TIME_COLUMNS or held_before(table, keys, rec, c):
                        missing.append(f"{table}.{c} of {({k: rec[k] for k in keys})}: "
                                       f"{rec[c]!r} became {got[c]!r}")
        assert not missing, "\n".join(missing)
        # Nothing ingested twice: the half-imported log resumed at its offset.
        for table in ("sequences", "runs", "artifact_versions", "reports"):
            (n,) = con.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()
            assert n == len(expected["tables"][table]["rows"]), table
    finally:
        con.close()
        old.close()
    for rel in expected["blob_files"]:
        assert (repo / rel).is_file(), rel
