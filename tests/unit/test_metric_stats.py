"""``metric_stats`` against the point scans it replaced.

The runs table's values/stats and the ``summary=`` rules used to be computed
by scanning every point at read time. They now read the ``metric_stats``
index maintained at ingest. The old scans live on here only, as the oracle:
random histories (out-of-order steps, re-sent points, NaN/None, +-inf, media
points, rules, summary keys, rewinds, forks, deletes, archive restores) must
give the same results through both.
"""

from __future__ import annotations

import io
import json
import math
import random
import zipfile
from typing import Any

import pytest

from cairn.server import ingest_ops
from cairn.server.routes.runs import _metric_stats
from cairn.server.run_archive import restore_archive, write_archive
from cairn.server.storage.blobs import BlobStore
from cairn.server.storage.db import Database
from cairn.server.storage.metric_stats import rebuild_metric_stats
from cairn.server.summary_rules import resolve_summary_rules, resolved_values

WALL = "2026-01-01T00:00:00+00:00"


# ---- the oracle: the scan-based SQL these functions ran before ----------------


def _oracle_rules(db: Database, run_ids: list[str]) -> dict[str, dict[str, Any]]:
    if not run_ids:
        return {}
    holes = ",".join("?" * len(run_ids))
    defs: dict[str, dict[str, str]] = {}
    for r in db.read_columns(
        f"SELECT run_id, name, summary FROM metric_defs "
        f"WHERE run_id IN ({holes}) AND summary IS NOT NULL",
        list(run_ids),
    ):
        defs.setdefault(r["run_id"], {})[r["name"]] = r["summary"]
    if not defs:
        return {}
    ruled = list(defs)
    holes = ",".join("?" * len(ruled))
    out: dict[str, dict[str, Any]] = {}
    for r in db.read_columns(
        f"""SELECT s.run_id AS run_id, s.name AS name,
                   MIN(s.scalar_value) AS min, MAX(s.scalar_value) AS max,
                   AVG(s.scalar_value) AS mean,
                   (SELECT l.scalar_value FROM sequences l
                     WHERE l.run_id = s.run_id AND l.name = s.name
                       AND l.scalar_value IS NOT NULL
                     ORDER BY l.step DESC LIMIT 1) AS last
              FROM sequences s
              JOIN metric_defs d
                ON d.run_id = s.run_id AND d.name = s.name AND d.summary IS NOT NULL
             WHERE s.run_id IN ({holes}) AND s.scalar_value IS NOT NULL
             GROUP BY s.run_id, s.name""",
        ruled,
    ):
        kind = defs[r["run_id"]].get(r["name"])
        if kind is not None:
            out.setdefault(r["run_id"], {})[r["name"]] = r[kind]
    return out


def _oracle_values(db: Database, run_ids: list[str]) -> dict[str, dict[str, Any]]:
    if not run_ids:
        return {}
    holes = ",".join("?" * len(run_ids))
    out: dict[str, dict[str, Any]] = {rid: {} for rid in run_ids}
    for r in db.read_columns(
        f"""SELECT s.run_id AS run_id, s.name AS name, s.scalar_value AS value
              FROM sequences s
              JOIN (SELECT run_id, name, MAX(step) AS step
                      FROM sequences
                     WHERE run_id IN ({holes}) AND scalar_value IS NOT NULL
                     GROUP BY run_id, name) m
                ON s.run_id = m.run_id AND s.name = m.name AND s.step = m.step
             WHERE s.scalar_value IS NOT NULL""",
        list(run_ids),
    ):
        out[r["run_id"]][r["name"]] = r["value"]
    for rid, values in _oracle_rules(db, run_ids).items():
        out[rid].update(values)
    for r in db.read_columns(
        f"SELECT run_id, key, value FROM summary WHERE run_id IN ({holes})",
        list(run_ids),
    ):
        out[r["run_id"]][r["key"]] = json.loads(r["value"])
    return out


def _oracle_stats(db: Database, run_ids: list[str]) -> dict[str, dict[str, Any]]:
    if not run_ids:
        return {}
    holes = ",".join("?" * len(run_ids))
    out: dict[str, dict[str, Any]] = {rid: {} for rid in run_ids}
    for r in db.read_columns(
        f"""SELECT g.run_id AS run_id, g.name AS name, g.count AS count,
                   f.scalar_value AS first, l.scalar_value AS last,
                   g.min AS min, g.max AS max, g.mean AS mean,
                   g.first_step AS first_step, g.last_step AS last_step,
                   d.summary AS rule
              FROM (SELECT run_id, name, COUNT(*) AS count,
                           MIN(scalar_value) AS min, MAX(scalar_value) AS max,
                           AVG(scalar_value) AS mean,
                           MIN(step) AS first_step, MAX(step) AS last_step
                      FROM sequences
                     WHERE run_id IN ({holes}) AND scalar_value IS NOT NULL
                     GROUP BY run_id, name) g
              JOIN sequences f
                ON f.run_id = g.run_id AND f.name = g.name AND f.step = g.first_step
              JOIN sequences l
                ON l.run_id = g.run_id AND l.name = g.name AND l.step = g.last_step
              LEFT JOIN metric_defs d
                ON d.run_id = g.run_id AND d.name = g.name""",
        list(run_ids),
    ):
        rid, name = r.pop("run_id"), r.pop("name")
        out[rid][name] = r
    return out


# ---- comparison ----------------------------------------------------------------


def _same(a: Any, b: Any, path: str = "") -> None:
    """Exact equality, except floats: a mean computed incrementally may
    differ from SQLite's one-pass AVG in the last bits."""
    if isinstance(a, dict) and isinstance(b, dict):
        assert set(a) == set(b), f"{path}: keys {sorted(a)} != {sorted(b)}"
        for k in a:
            _same(a[k], b[k], f"{path}.{k}")
    elif isinstance(a, float) and isinstance(b, float):
        if math.isinf(a) or math.isinf(b):
            assert a == b, f"{path}: {a} != {b}"
        elif path.endswith(".mean") or "rule-mean" in path:
            assert a == pytest.approx(b, rel=1e-12, abs=1e-300), f"{path}: {a} != {b}"
        else:
            assert a == b, f"{path}: {a!r} != {b!r}"
    else:
        assert a == b and type(a) is type(b), f"{path}: {a!r} != {b!r}"


def _check(db: Database) -> None:
    run_ids = [r[0] for r in db.read("SELECT id FROM runs")]
    # Each rule's name encodes its kind, so mean-rule floats compare loosely.
    _same(_metric_stats(db, run_ids), _oracle_stats(db, run_ids), "stats")
    _same(resolve_summary_rules(db, run_ids), _oracle_rules(db, run_ids), "rules")
    _same(resolved_values(db, run_ids), _oracle_values(db, run_ids), "values")
    for rid in run_ids:  # the single-run callers (Run.final, metrics.x)
        _same(resolved_values(db, [rid]), _oracle_values(db, [rid]), "values1")


# ---- random histories ---------------------------------------------------------


NAMES = ["loss", "acc", "system.cpu", "rule-min", "rule-max", "rule-mean", "rule-last"]


def _value(rng: random.Random) -> float | None:
    x = rng.random()
    if x < 0.05:
        return None
    if x < 0.10:
        return math.nan
    if x < 0.12:
        return rng.choice([math.inf, -math.inf])
    if x < 0.30:
        return float(rng.randint(-3, 3))  # ties for min/max
    return rng.uniform(-1e3, 1e3)


def _batch(rng: random.Random, max_step: int) -> list[dict[str, Any]]:
    pts = []
    for _ in range(rng.randint(1, 60)):
        name = rng.choice(NAMES + ["img"])
        step = rng.randint(0, max_step)
        if name == "img":
            pts.append({"name": name, "step": step, "wall_time": WALL,
                        "object_type": "image", "artifact_hash": "h" * 8})
        else:
            pts.append({"name": name, "step": step, "wall_time": WALL,
                        "object_type": "scalar", "scalar_value": _value(rng)})
    return pts


def _history(db: Database, rng: random.Random, rid: str, batches: int) -> None:
    sent: list[list[dict[str, Any]]] = []
    for _ in range(batches):
        b = _batch(rng, rng.choice([10, 50, 400]))
        ingest_ops.insert_batch(db, rid, b)
        sent.append(b)
        if rng.random() < 0.2:  # a retried batch (dropped ack, WAL replay)
            ingest_ops.insert_batch(db, rid, rng.choice(sent))


@pytest.mark.parametrize("seed", range(12))
def test_matches_point_scans(tmp_path, seed):
    rng = random.Random(seed)
    db = Database.open(tmp_path / "cairn.db")
    runs = []
    for _ in range(4):
        rid = ingest_ops.create_run(db, project="p")["run_id"]
        runs.append(rid)
        for kind in ("min", "max", "mean", "last"):
            if rng.random() < 0.7:
                ingest_ops.set_metric_rule(db, rid, f"rule-{kind}", summary=kind)
        if rng.random() < 0.4:
            ingest_ops.set_summary(db, rid, {"acc": 0.5, "extra": {"x": 1}})
        _history(db, rng, rid, rng.randint(1, 8))
    _check(db)

    # Rewind: history after k is dropped, then the run keeps logging.
    rid = rng.choice(runs)
    ingest_ops.rewind_run(db, rid, rng.randint(0, 60))
    _check(db)
    _history(db, rng, rid, 3)
    _check(db)

    # Fork: a copy of history <= k, then its own points.
    child = ingest_ops.fork_run(
        db, parent_id=rng.choice(runs), step=rng.randint(0, 60), run_id="child",
    )["run_id"]
    _check(db)
    _history(db, rng, child, 3)
    _check(db)
    # A replayed fork (WAL) must not double-count the copied history.
    ingest_ops.fork_run(db, parent_id=runs[0], step=30, run_id="child")
    _check(db)

    # Delete.
    ingest_ops.delete_run(db, _DD(tmp_path), runs[-1])
    (orphans,) = db.read_one(
        "SELECT COUNT(*) FROM metric_stats WHERE run_id NOT IN (SELECT id FROM runs)"
    )
    assert orphans == 0
    _check(db)

    # A rebuild from the points agrees with what ingest maintained.
    def table() -> list[tuple[Any, ...]]:
        return db.read(
            "SELECT run_id, name, count, min, max, first_step, first_value, "
            "last_step, last_value FROM metric_stats ORDER BY run_id, name"
        )
    before = table()
    with db.transaction() as con:
        rebuild_metric_stats(con, [r[0] for r in db.read("SELECT id FROM runs")])
    assert table() == before
    _check(db)
    db.close()


class _DD:
    """The two DataDir paths delete_run touches."""

    def __init__(self, root):
        self.logs_dir = root / "logs"
        self.sources_dir = root / "sources"


def test_archive_restore_builds_stats(tmp_path):
    from cairn.server.storage.datadir import DataDir

    rng = random.Random(99)
    src = DataDir(tmp_path / "src")
    db = Database.open(src.db_path)
    rid = ingest_ops.create_run(db, project="p")["run_id"]
    ingest_ops.set_metric_rule(db, rid, "rule-mean", summary="mean")
    _history(db, rng, rid, 5)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        write_archive(db, BlobStore(src.artifacts_dir), src, [rid], zf)
    db.close()

    dst = DataDir(tmp_path / "dst")
    db = Database.open(dst.db_path)
    with zipfile.ZipFile(io.BytesIO(buf.getvalue())) as zf:
        restored = restore_archive(db, BlobStore(dst.artifacts_dir), dst, zf, keep_ids=False)
    new_id = restored[0]["new_id"]
    assert db.read_one("SELECT COUNT(*) FROM metric_stats WHERE run_id = ?", [new_id])[0] > 0
    _check(db)
    db.close()


def test_backfill_on_open(tmp_path):
    """A repo whose points predate the index gets it built on open."""
    rng = random.Random(7)
    path = tmp_path / "cairn.db"
    db = Database.open(path)
    rids = [ingest_ops.create_run(db, project="p")["run_id"] for _ in range(3)]
    for rid in rids:
        ingest_ops.set_metric_rule(db, rid, "rule-max", summary="max")
        _history(db, rng, rid, 4)
    db.write("DELETE FROM metric_stats")
    db.close()

    db = Database.open(path)
    (n,) = db.read_one("SELECT COUNT(DISTINCT run_id) FROM metric_stats")
    assert n == 3
    _check(db)
    db.close()


def test_out_of_order_and_resent_points(fresh_db):
    db = fresh_db
    rid = ingest_ops.create_run(db, project="p")["run_id"]

    def pt(step, v):
        return {"name": "loss", "step": step, "wall_time": WALL,
                "object_type": "scalar", "scalar_value": v}

    ingest_ops.insert_batch(db, rid, [pt(5, 1.0), pt(9, 3.0)])
    ingest_ops.insert_batch(db, rid, [pt(0, 4.0), pt(5, 100.0), pt(2, 2.0)])
    ingest_ops.insert_batch(db, rid, [pt(9, -7.0), pt(7, math.nan)])
    assert _metric_stats(db, [rid])[rid]["loss"] == {
        "count": 4, "first": 4.0, "last": 3.0, "min": 1.0, "max": 4.0,
        "mean": 2.5, "first_step": 0, "last_step": 9, "rule": None,
    }
