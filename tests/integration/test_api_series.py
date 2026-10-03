"""The batched, column-wise sequence read (/series) and the sequence catalogue.

/series must return exactly the points /sequences/{name} returns, and the
catalogue (read from metric_stats + a partial index) exactly what a scan of
every point gives.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone

import pytest


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _pt(name: str, step: int, value: float | None = None, otype: str = "scalar", **extra) -> dict:
    return {"name": name, "step": step, "wall_time": iso_now(), "object_type": otype, "scalar_value": value, **extra}


def _run(client, points) -> str:
    rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
    r = client.post(f"/api/runs/{rid}/batch", json={"points": points})
    assert r.status_code < 300, r.text
    return rid


def _expand(series: dict) -> list[dict]:
    """What the UI does: columns + constants back to point objects."""
    out = []
    for i in range(series["count"]):
        p = dict(series["constant"])
        for k, col in series["columns"].items():
            p[k] = col[i]
        out.append(p)
    return out


MIXED = [
    *[_pt("loss", s, 1.0 / (s + 1)) for s in range(5)],
    _pt("loss", 7, None),  # a NaN arrives (and is stored) as NULL
    *[_pt("val.acc", s, 0.1 * s) for s in (0, 10, 20)],
    _pt("img", 0, None, "image", artifact_hash="a" * 64, metadata={"caption": "x"}),
    _pt("img", 3, None, "image", artifact_hash="b" * 64),
    # A scalar value under another object type (a client may send one).
    _pt("odd", 0, 2.5, "int"),
    _pt("odd", 1, None, "int"),
    _pt("mixed", 0, 1.0),
    _pt("mixed", 1, 2.0, "zzz"),
    _pt("onlynan", 0, None),
]


def test_series_matches_the_per_name_endpoint(client):
    rid = _run(client, MIXED)
    names = ["loss", "val.acc", "img", "odd", "mixed", "onlynan", "never-logged"]
    body = client.get(f"/api/runs/{rid}/series", params=[("name", n) for n in names]).json()
    assert [s["name"] for s in body["series"]] == names
    top = 0
    for s in body["series"]:
        ref = client.get(f"/api/runs/{rid}/sequences/{s['name']}").json()
        assert _expand(s) == ref["points"], s["name"]
        assert s["count"] == len(ref["points"])
        assert s["cursor"] == (ref["cursor"] if ref["points"] else 0)
        top = max(top, s["cursor"])
    assert body["cursor"] == top
    assert body["data_epoch"] == 0


def test_series_sends_a_constant_field_once(client):
    rid = _run(client, [_pt("loss", s, float(s)) for s in range(4)])
    s = client.get(f"/api/runs/{rid}/series", params={"name": "loss"}).json()["series"][0]
    assert s["columns"]["step"] == [0, 1, 2, 3]
    assert s["columns"]["scalar_value"] == [0.0, 1.0, 2.0, 3.0]
    assert s["constant"]["object_type"] == "scalar"
    assert s["constant"]["artifact_hash"] is None
    assert "artifact_hash" not in s["columns"]


def test_series_dedupes_names_and_404s_an_unknown_run(client):
    rid = _run(client, [_pt("loss", 0, 1.0)])
    body = client.get(f"/api/runs/{rid}/series", params=[("name", "loss"), ("name", "loss")]).json()
    assert [s["name"] for s in body["series"]] == ["loss"]
    assert client.get("/api/runs/nope/series", params={"name": "loss"}).status_code == 404
    assert client.get(f"/api/runs/{rid}/series").json()["series"] == []


def test_series_caps_the_batch(client):
    from cairn.server.routes.sequences import SERIES_BATCH_LIMIT

    rid = _run(client, [_pt("loss", 0, 1.0)])
    names = [("name", f"m{i}") for i in range(SERIES_BATCH_LIMIT + 1)]
    assert client.get(f"/api/runs/{rid}/series", params=names).status_code == 400


def _scan(app, rid: str) -> list[dict]:
    """The catalogue as a scan of every point (the old query)."""
    return app.state.db.read_columns(
        """
        SELECT name, MAX(object_type) AS object_type, MIN(step) AS min_step,
               MAX(step) AS max_step, COUNT(*) AS count
        FROM sequences WHERE run_id = ? GROUP BY name ORDER BY name
        """,
        [rid],
    )


def test_catalogue_equals_a_scan_of_every_point(client, app):
    rid = _run(client, MIXED)
    got = client.get(f"/api/runs/{rid}/sequences").json()["sequences"]
    assert got == _scan(app, rid)


@pytest.mark.parametrize("seed", range(5))
def test_catalogue_equals_a_scan_randomized(client, app, seed):
    import random

    rng = random.Random(seed)
    points = []
    for n in range(8):
        name = f"m{n}"
        for step in rng.sample(range(50), rng.randint(1, 12)):
            otype = rng.choice(["scalar", "scalar", "scalar", "image", "int"])
            value = rng.choice([None, rng.random()]) if otype != "image" else None
            points.append(_pt(name, step, value, otype))
    rid = _run(client, points)
    assert client.get(f"/api/runs/{rid}/sequences").json()["sequences"] == _scan(app, rid)


def test_json_is_gzipped_blobs_are_not(client):
    rid = _run(client, [_pt("loss", s, float(s)) for s in range(2000)])
    r = client.get(f"/api/runs/{rid}/series", params={"name": "loss"}, headers={"Accept-Encoding": "gzip"})
    assert r.headers.get("content-encoding") == "gzip"
    assert r.json()["series"][0]["count"] == 2000  # the client decodes it
    small = client.get(f"/api/runs/{rid}", headers={"Accept-Encoding": "identity"})
    assert "content-encoding" not in small.headers
    blob = b"\x89PNG" + b"\0" * 10_000
    client.post("/api/artifacts", files={"file": ("a.png", blob, "image/png")}, data={"mime_type": "image/png"})
    digest = hashlib.sha256(blob).hexdigest()
    got = client.get(f"/api/artifacts/{digest}", headers={"Accept-Encoding": "gzip"})
    assert got.status_code == 200
    assert "content-encoding" not in got.headers
    assert got.content == blob
