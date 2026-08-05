"""Unit tests for the server-side query resolver (no HTTP).

Seeds a ``Database`` directly and exercises :mod:`cairn.server.query_resolver`
across every run selector mode, name globbing, tag+step addressing, param /
metric predicates, ``at=`` pinning, and the no-match path.
"""

from __future__ import annotations

import hashlib
import json

import pytest

from cairn.server.query_resolver import (
    QueryError,
    QueryNotFound,
    QueryRunSelectorSpec,
    parse_query_params,
    resolve,
    resolve_run_ids,
)


# ---------------------------------------------------------------------------
# Seeding helpers
# ---------------------------------------------------------------------------

def _digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _put_artifact(db, payload: bytes, *, mime="image/png", object_type="image") -> str:
    h = _digest(payload)
    db.write(
        "INSERT OR IGNORE INTO artifacts (hash, mime_type, size_bytes, metadata, "
        "object_type, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [h, mime, len(payload), "{}", object_type, "2026-01-01T00:00:00+00:00"],
    )
    return h


def _add_run(
    db, run_id, *, project="demo", name=None, created_at, status="completed",
    tags=None, params=None,
):
    db.write(
        "INSERT OR IGNORE INTO projects (id, name, created_at) VALUES (?, ?, ?)",
        [project, project, "2026-01-01T00:00:00+00:00"],
    )
    db.write(
        'INSERT INTO runs (id, project_id, display_name, created_at, status, tags) '
        "VALUES (?, ?, ?, ?, ?, ?)",
        [run_id, project, name, created_at, status,
         json.dumps(tags) if tags is not None else None],
    )
    for k, v in (params or {}).items():
        db.write(
            "INSERT INTO params (run_id, key, value, value_type) VALUES (?, ?, ?, ?)",
            [run_id, k, json.dumps(v), type(v).__name__],
        )


def _attach_named_artifact(db, run_id, name, digest, step=-1):
    db.write(
        "INSERT OR IGNORE INTO run_artifacts (run_id, name, hash, step, created_at) "
        "VALUES (?, ?, ?, ?, ?)",
        [run_id, name, digest, step, "2026-01-01T00:00:00+00:00"],
    )


def _add_seq_point(db, run_id, name, step, *, scalar=None, digest=None, object_type="scalar"):
    db.write(
        "INSERT OR IGNORE INTO sequences (run_id, name, step, wall_time, context, "
        "context_hash, object_type, scalar_value, artifact_hash) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [run_id, name, step, "2026-01-01T00:00:00+00:00", None, "",
         object_type, scalar, digest],
    )


@pytest.fixture
def seeded(fresh_db, blob_store):
    """Two runs of name 'exp-a' + one 'exp-b', each with a 'render' artifact."""
    db = fresh_db
    # Oldest first so created_at ordering is unambiguous.
    a_old = _put_artifact(db, b"exp-a-old-render")
    a_new = _put_artifact(db, b"exp-a-new-render")
    b_art = _put_artifact(db, b"exp-b-render")

    _add_run(db, "aaaaaaaaaaaa", name="exp-a", created_at="2026-02-01T00:00:00+00:00",
             tags=["baseline"], params={"lr": 0.001})
    _attach_named_artifact(db, "aaaaaaaaaaaa", "render", a_old)

    _add_run(db, "bbbbbbbbbbbb", name="exp-a", created_at="2026-03-01T00:00:00+00:00",
             tags=["baseline", "best"], params={"lr": 0.01})
    _attach_named_artifact(db, "bbbbbbbbbbbb", "render", a_new)

    _add_run(db, "cccccccccccc", name="exp-b", created_at="2026-04-01T00:00:00+00:00",
             tags=["best"], params={"lr": 0.1})
    _attach_named_artifact(db, "cccccccccccc", "render", b_art)

    return db, {"a_old": a_old, "a_new": a_new, "b_art": b_art}


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

def test_parse_defaults():
    spec = parse_query_params({"tag": "render"})
    assert spec.tag == "render"
    assert spec.run.mode == "latest"
    assert spec.step == "latest"
    assert spec.fmt == "raw"


def test_parse_requires_tag():
    with pytest.raises(QueryError):
        parse_query_params({"run": "latest"})


def test_parse_run_modes():
    assert parse_query_params({"tag": "x", "run": "latest:3"}).run == \
        parse_query_params({"tag": "x", "run": "latest:3"}).run
    assert parse_query_params({"tag": "x", "run": "latest:3"}).run.mode == "latest-n"
    assert parse_query_params({"tag": "x", "run": "latest:3"}).run.n == 3
    assert parse_query_params({"tag": "x", "run": "id:abc"}).run.run_id == "abc"
    assert parse_query_params({"tag": "x", "run": "newest-per-name"}).run.mode == \
        "newest-per-name"


def test_parse_bad_run():
    with pytest.raises(QueryError):
        parse_query_params({"tag": "x", "run": "bogus"})


def test_parse_step_best_deferred():
    with pytest.raises(QueryError):
        parse_query_params({"tag": "x", "step": "best:loss:min"})


def test_parse_bad_format():
    with pytest.raises(QueryError):
        parse_query_params({"tag": "x", "format": "xml"})


def test_parse_predicate_and_at():
    spec = parse_query_params(
        [("tag", "render"), ("lr__gt", "1e-4"), ("metrics.loss__lt", "0.1"),
         ("at", "2026-03-15T00:00:00Z")]
    )
    ops = {p.field: (p.op, p.sub_field, p.value) for p in spec.predicates}
    assert ops["lr"] == ("gt", None, 1e-4)
    assert ops["metrics"] == ("lt", "loss", 0.1)
    assert spec.at.endswith("+00:00")


# ---------------------------------------------------------------------------
# Run selection
# ---------------------------------------------------------------------------

def test_latest(seeded):
    db, arts = seeded
    spec = parse_query_params({"tag": "render", "project": "demo"})
    art = resolve(db, spec)
    assert art.run_id == "cccccccccccc"  # newest overall
    assert art.digest == arts["b_art"]


def test_latest_n(seeded):
    db, arts = seeded
    # 2nd-newest run is 'bbbb' (exp-a new).
    art = resolve(db, parse_query_params({"tag": "render", "run": "latest:2"}))
    assert art.run_id == "bbbbbbbbbbbb"
    assert art.digest == arts["a_new"]


def test_run_id_pin(seeded):
    db, arts = seeded
    art = resolve(db, parse_query_params({"tag": "render", "run": "id:aaaaaaaaaaaa"}))
    assert art.run_id == "aaaaaaaaaaaa"
    assert art.digest == arts["a_old"]


def test_newest_per_name(seeded):
    db, arts = seeded
    # Restrict to exp-a via glob; newest-per-name collapses the two exp-a runs
    # to the newest one (bbbb).
    art = resolve(db, parse_query_params(
        {"tag": "render", "name": "exp-a", "run": "newest-per-name"}
    ))
    assert art.run_id == "bbbbbbbbbbbb"
    assert art.digest == arts["a_new"]


def test_name_glob(seeded):
    db, arts = seeded
    art = resolve(db, parse_query_params({"tag": "render", "name": "exp-b*"}))
    assert art.run_id == "cccccccccccc"


def test_name_substring(seeded):
    db, _ = seeded
    # Case-insensitive substring when no '*'.
    art = resolve(db, parse_query_params({"tag": "render", "name": "EXP-A"}))
    assert art.run_id == "bbbbbbbbbbbb"  # newest exp-a


def test_predicate_param(seeded):
    db, arts = seeded
    # lr__gt=0.05 keeps only run cccc (lr=0.1).
    art = resolve(db, parse_query_params({"tag": "render", "lr__gt": "0.05"}))
    assert art.run_id == "cccccccccccc"


def test_predicate_tags_contains(seeded):
    db, arts = seeded
    # baseline tag → runs aaaa & bbbb; latest of those is bbbb.
    art = resolve(db, parse_query_params(
        [("tag", "render"), ("tags__contains", "baseline")]
    ))
    assert art.run_id == "bbbbbbbbbbbb"


def test_at_pinning(seeded):
    db, arts = seeded
    # Freeze the clock before run cccc (2026-04) — latest becomes bbbb (2026-03).
    art = resolve(db, parse_query_params(
        {"tag": "render", "at": "2026-03-15T00:00:00Z"}
    ))
    assert art.run_id == "bbbbbbbbbbbb"


def test_no_match_raises(seeded):
    db, _ = seeded
    with pytest.raises(QueryNotFound):
        resolve(db, parse_query_params({"tag": "render", "name": "does-not-exist"}))


def test_unknown_tag_raises(seeded):
    db, _ = seeded
    with pytest.raises(QueryNotFound):
        resolve(db, parse_query_params({"tag": "no-such-artifact"}))


# ---------------------------------------------------------------------------
# Step addressing (highest-step / explicit) over a sequence artifact
# ---------------------------------------------------------------------------

def test_step_latest_and_explicit(fresh_db):
    db = fresh_db
    d0 = _put_artifact(db, b"ckpt-step-0")
    d5 = _put_artifact(db, b"ckpt-step-5")
    _add_run(db, "dddddddddddd", name="run-d", created_at="2026-05-01T00:00:00+00:00")
    _add_seq_point(db, "dddddddddddd", "ckpt", 0, digest=d0, object_type="image")
    _add_seq_point(db, "dddddddddddd", "ckpt", 5, digest=d5, object_type="image")

    latest = resolve(db, parse_query_params({"tag": "ckpt"}))
    assert latest.digest == d5 and latest.step == 5

    pinned = resolve(db, parse_query_params({"tag": "ckpt", "step": "0"}))
    assert pinned.digest == d0 and pinned.step == 0

    with pytest.raises(QueryNotFound):
        resolve(db, parse_query_params({"tag": "ckpt", "step": "99"}))


# ---------------------------------------------------------------------------
# QueryRunSelector multi-run port
# ---------------------------------------------------------------------------

def test_resolve_run_ids_latest_n(seeded):
    db, _ = seeded
    ids = resolve_run_ids(db, QueryRunSelectorSpec(mode="latest-n", n=2))
    assert ids == ["cccccccccccc", "bbbbbbbbbbbb"]


def test_resolve_run_ids_newest_per_name(seeded):
    db, _ = seeded
    ids = resolve_run_ids(db, QueryRunSelectorSpec(mode="newest-per-name"))
    # One per distinct display name, newest-first: exp-b (cccc), exp-a (bbbb).
    assert ids == ["cccccccccccc", "bbbbbbbbbbbb"]


def test_resolve_run_ids_tag_filter(seeded):
    db, _ = seeded
    ids = resolve_run_ids(db, QueryRunSelectorSpec(mode="latest-n", tags=["best"]))
    assert set(ids) == {"cccccccccccc", "bbbbbbbbbbbb"}
