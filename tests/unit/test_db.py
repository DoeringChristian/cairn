"""Unit tests for the Database wrapper: writes, reads, concurrency, transactions."""

from __future__ import annotations

import threading

import pytest

from cairn.server.storage.db import Database


@pytest.fixture
def db(tmp_path):
    d = Database.open(tmp_path / "cairn.db")
    yield d
    d.close()


def _insert_project(db: Database, pid: str) -> None:
    db.write(
        "INSERT INTO projects VALUES (?, ?, '2025-01-01T00:00:00', NULL, NULL)",
        [pid, pid.upper()],
    )


def test_write_and_read(db):
    _insert_project(db, "alpha")
    rows = db.read("SELECT id FROM projects")
    assert rows == [("alpha",)]


def test_read_columns_returns_dicts(db):
    _insert_project(db, "alpha")
    rows = db.read_columns("SELECT id, name FROM projects")
    assert rows == [{"id": "alpha", "name": "ALPHA"}]


def test_executemany(db):
    db.executemany(
        "INSERT INTO projects VALUES (?, ?, '2025-01-01T00:00:00', NULL, NULL)",
        [("a", "A"), ("b", "B"), ("c", "C")],
    )
    rows = sorted(r[0] for r in db.read("SELECT id FROM projects"))
    assert rows == ["a", "b", "c"]


def test_transaction_commits(db):
    with db.transaction() as con:
        con.execute(
            "INSERT INTO projects VALUES ('p1', 'P1', '2025-01-01T00:00:00', NULL, NULL)"
        )
    assert db.read("SELECT id FROM projects") == [("p1",)]


def test_transaction_rolls_back_on_error(db):
    with pytest.raises(RuntimeError):
        with db.transaction() as con:
            con.execute(
                "INSERT INTO projects VALUES ('p1', 'P1', '2025-01-01T00:00:00', NULL, NULL)"
            )
            raise RuntimeError("boom")
    assert db.read("SELECT id FROM projects") == []


def test_concurrent_writes_all_land(db):
    """Spawn 10 threads each inserting 20 rows; expect 200 rows total."""
    errors: list[BaseException] = []

    def worker(idx: int) -> None:
        try:
            for i in range(20):
                db.write(
                    "INSERT INTO projects VALUES (?, ?, '2025-01-01T00:00:00', NULL, NULL)",
                    [f"p{idx:02d}-{i:02d}", f"project{idx}-{i}"],
                )
        except BaseException as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(10)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors, errors
    (count,) = db.read_one("SELECT COUNT(*) FROM projects") or (0,)
    assert count == 200


def test_reader_sees_writes_after_commit(db):
    _insert_project(db, "x")
    assert db.read("SELECT id FROM projects WHERE id='x'") == [("x",)]


def test_close_is_idempotent(tmp_path):
    d = Database.open(tmp_path / "c.db")
    d.close()
    d.close()  # should not raise
