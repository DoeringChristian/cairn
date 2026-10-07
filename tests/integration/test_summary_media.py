"""Summary media: ``run.summary(key=<cairn media>)`` is ONE stepless value per
dotted key, replaced by a later write, removed with its key, shown by cards as
a series flagged ``summary`` and never a runs-table value."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

import cairn
from cairn.sdk.gallery import GALLERY_MIME
from cairn.sdk.reader import MediaRef
from cairn.sdk.transport import Transport
from cairn.server import gc, ingest_ops
from cairn.server.app import create_app
from cairn.server.storage.blobs import BlobStore
from cairn.server.storage.datadir import DataDir
from cairn.server.storage.db import Database
from tests.conftest import ingest_repo

QUIET = {"capture_source": False, "capture_stdout": False, "capture_env": False,
         "capture_system_metrics": False}
REPO_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(autouse=True)
def _reset_capture_state():
    from cairn.sdk.capture import stdout as scap

    scap._active_run_id = None
    yield
    scap._active_run_id = None


def _img(value: float) -> np.ndarray:
    return np.full((6, 6, 3), value, np.float32)


def _showcase(seed: float) -> dict:
    return {
        "loss_landscape": cairn.Image(_img(seed), caption=f"landscape {seed}"),
        "samples": [cairn.Image(_img(seed / 2)), cairn.Image(_img(seed / 3))],
        "note": "fixed",
    }


def _train(repo: Path) -> str:
    with cairn.Run(project="sm", name="train", repo=str(repo), **QUIET) as run:
        for step in range(3):
            run.track(float(step), "loss", step=step)
        run.summary(best=0.5, showcase=_showcase(0.9))
        return run.id


def _db(repo: Path) -> Database:
    return Database.open(DataDir(repo).db_path)


def _rows(db: Database, run_id: str) -> list[tuple]:
    return db.read(
        "SELECT name, step, artifact_hash, object_type, summary FROM sequences "
        "WHERE run_id = ? ORDER BY name, step",
        [run_id],
    )


# ---- local repo (WAL) -----------------------------------------------------


def test_local_round_trip_nested_and_gallery(tmp_path):
    repo = tmp_path / ".cairn"
    rid = _train(repo)
    ingest_repo(repo)
    run = cairn.Reader(repo=str(repo)).run(rid)

    summary = run.summary
    assert summary["best"] == 0.5 and summary["showcase"]["note"] == "fixed"
    ref = summary["showcase"]["loss_landscape"]
    assert isinstance(ref, MediaRef) and ref.object_type == "image"
    assert np.asarray(ref.load()).shape[:2] == (6, 6)
    gallery = summary["showcase"]["samples"]
    assert isinstance(gallery, list) and len(gallery) == 2
    assert all(isinstance(g, MediaRef) for g in gallery)
    # run.media(key) returns the same.
    assert run.media("showcase.loss_landscape").hash == ref.hash
    assert [g.hash for g in run.media("showcase.samples")] == [g.hash for g in gallery]

    infos = {s.name: s for s in run.sequences()}
    assert infos["showcase.loss_landscape"].summary is True
    assert (infos["showcase.loss_landscape"].min_step, infos["showcase.loss_landscape"].count) == (0, 1)
    assert infos["loss"].summary is False
    # The exact document keeps the markers.
    raw = run._backend.get_docs(rid)["summary"]
    assert raw["showcase"]["loss_landscape"]["$media"]["hash"] == ref.hash


def test_overwrite_replaces_and_delete_removes(tmp_path):
    repo = tmp_path / ".cairn"
    rid = _train(repo)
    ingest_repo(repo)
    db = _db(repo)
    try:
        before = {r[0]: r[2] for r in _rows(db, rid)}
        (epoch0,) = db.read_one("SELECT data_epoch FROM runs WHERE id = ?", [rid])

        reader = cairn.Reader(repo=str(repo))
        with reader.run(rid).edit() as e:
            e.set_summary(showcase={"loss_landscape": cairn.Image(_img(0.1))})
        rows = _rows(db, rid)
        land = [r for r in rows if r[0] == "showcase.loss_landscape"]
        assert len(land) == 1 and land[0][1] == 0 and land[0][4] == 1
        assert land[0][2] != before["showcase.loss_landscape"]
        # The other keys are untouched (a deep merge).
        assert {r[0]: r[2] for r in rows}["showcase.samples"] == before["showcase.samples"]
        (epoch1,) = db.read_one("SELECT data_epoch FROM runs WHERE id = ?", [rid])
        assert epoch1 > epoch0

        # The same value again changes nothing.
        with reader.run(rid).edit() as e:
            e.set_summary(showcase={"loss_landscape": cairn.Image(_img(0.1))})
        assert db.read_one("SELECT data_epoch FROM runs WHERE id = ?", [rid])[0] == epoch1

        with reader.run(rid).edit() as e:
            e.delete_keys("summary", ["showcase.samples"])
        names = [r[0] for r in _rows(db, rid)]
        assert "showcase.samples" not in names and "showcase.loss_landscape" in names
        with reader.run(rid).edit() as e:
            e.delete_keys("summary", ["showcase"])
        assert [r[0] for r in _rows(db, rid)] == ["loss", "loss", "loss"]
        assert reader.run(rid).summary == {"best": 0.5}
    finally:
        db.close()


_ATTACH = """
import sys, numpy as np, cairn
repo, rid, value = sys.argv[1], sys.argv[2], float(sys.argv[3])
run = cairn.attach(rid, label="showcase", repo=repo, system_metrics=False, capture_output=False)
run.summary(showcase={"loss_landscape": cairn.Image(np.full((6, 6, 3), value, np.float32)),
                      "samples": [cairn.Image(np.full((6, 6, 3), value, np.float32))]})
run.finish()
"""


def test_showcase_rerun_from_a_second_process_replaces_media_only(tmp_path):
    repo = tmp_path / ".cairn"
    rid = _train(repo)
    ingest_repo(repo)
    db = _db(repo)
    try:
        loss_before = db.read("SELECT step, scalar_value FROM sequences WHERE run_id = ? AND name = 'loss'", [rid])
        hashes = []
        for value in (0.25, 0.75):  # the buggy showcase, then the fixed one
            env = {**os.environ, "BROWSER": "true", "PYTHONPATH": str(REPO_ROOT)}
            subprocess.run([sys.executable, "-c", _ATTACH, str(repo), rid, str(value)],
                           check=True, timeout=120, env=env)
            ingest_repo(repo)
            land = [r for r in _rows(db, rid) if r[0] == "showcase.loss_landscape"]
            assert len(land) == 1
            hashes.append(land[0][2])
        assert hashes[0] != hashes[1]
        run = cairn.Reader(repo=str(repo)).run(rid)
        assert run.status == "completed"
        assert len(run.summary["showcase"]["samples"]) == 1
        assert db.read("SELECT step, scalar_value FROM sequences WHERE run_id = ? AND name = 'loss'", [rid]) == loss_before
    finally:
        db.close()


def test_a_name_is_tracked_or_summary_media_not_both(tmp_path):
    repo = tmp_path / ".cairn"
    with cairn.Run(project="sm", repo=str(repo), **QUIET) as run:
        run.track(1.0, "loss", step=0)
        with pytest.raises(ValueError, match="'loss' is a tracked series"):
            run.summary(loss=cairn.Image(_img(0.5)))
        run.summary(fig=cairn.Image(_img(0.5)))
        with pytest.raises(ValueError, match="'fig' is a summary media value"):
            run.track(cairn.Image(_img(0.5)), "fig", step=1)
        with pytest.raises(ValueError, match="'fig' is a summary media value"):
            run.track([cairn.Image(_img(0.5))], "fig", step=1)
        rid = run.id
    ingest_repo(repo)
    # Another process: the stored series are checked.
    attached = cairn.attach(rid, label="eval", repo=str(repo), system_metrics=False, capture_output=False)
    try:
        with pytest.raises(ValueError, match="'loss' is a tracked series"):
            attached.summary({"loss": [cairn.Image(_img(0.1))]})
        with pytest.raises(ValueError, match="'fig' is a summary media value"):
            attached.track(2.0, "fig", step=2)
    finally:
        attached.finish()
    with cairn.Reader(repo=str(repo)).run(rid).edit() as e, pytest.raises(ValueError, match="tracked series"):
        e.set_summary(loss=cairn.Image(_img(0.1)))


def test_ingestion_backstop_for_both_directions(fresh_db):
    rid = ingest_ops.create_run(fresh_db, project="p")["run_id"]
    marker = {"$media": {"hash": "a" * 64, "object_type": "image", "mime_type": "image/png"}}
    ingest_ops.insert_batch(fresh_db, rid, [
        {"name": "loss", "step": 0, "wall_time": "2026-01-01T00:00:00+00:00", "object_type": "scalar",
         "scalar_value": 1.0},
    ])
    with pytest.raises(ValueError, match="'loss' is a tracked series"):
        ingest_ops.set_summary(fresh_db, rid, {"loss": marker})
    ingest_ops.set_summary(fresh_db, rid, {"fig": marker})
    ingest_ops.insert_batch(fresh_db, rid, [
        {"name": "fig", "step": 3, "wall_time": "2026-01-01T00:00:01+00:00", "object_type": "scalar",
         "scalar_value": 2.0},
    ])
    assert fresh_db.read("SELECT step, summary FROM sequences WHERE run_id = ? AND name = 'fig'", [rid]) == [(0, 1)]
    alerts = fresh_db.read("SELECT level, title FROM alerts WHERE run_id = ?", [rid])
    assert alerts == [("warn", "Points of 'fig' dropped")]


def test_non_json_non_media_names_the_summary(tmp_path):
    repo = tmp_path / ".cairn"
    with cairn.Run(project="sm", repo=str(repo), **QUIET) as run:
        with pytest.raises(TypeError, match=r"^summary values must be JSON .* or cairn media"):
            run.summary(x=object())
        with pytest.raises(TypeError, match=r"^config values must be JSON"):
            run.config(x=object())
        with pytest.raises(TypeError, match="gallery"):
            run.summary(x=[cairn.Image(_img(0.1)), 3])


# ---- catalogue / series / overview / runs table ----------------------------


def test_catalogue_series_and_overview_shape(tmp_path):
    repo = tmp_path / ".cairn"
    rid = _train(repo)
    ingest_repo(repo)
    with TestClient(create_app(data_dir=repo, mount_ui=False)) as client:
        cat = {s["name"]: s for s in client.get(f"/api/runs/{rid}/sequences").json()["sequences"]}
        assert cat["showcase.loss_landscape"] == {
            "name": "showcase.loss_landscape", "object_type": "image", "min_step": 0,
            "max_step": 0, "count": 1, "summary": True,
        }
        assert cat["showcase.samples"]["summary"] is True
        assert "summary" not in cat["loss"]

        body = client.get(f"/api/runs/{rid}/series",
                          params={"name": ["showcase.loss_landscape", "showcase.samples"]}).json()
        land, samples = body["series"]
        assert land["count"] == 1 and land["constant"]["step"] == 0
        assert json.loads(land["constant"]["metadata"]) == {"caption": "landscape 0.9"}
        assert samples["constant"]["artifact_mime"] == GALLERY_MIME
        points = client.get(f"/api/runs/{rid}/sequences/showcase.loss_landscape").json()["points"]
        assert len(points) == 1 and points[0]["object_type"] == "image"

        # The run page (Overview) gets the media markers in its summary tree;
        # the flat index (runs table values and columns) has no row for them.
        detail = client.get(f"/api/runs/{rid}").json()
        doc = detail["summary_doc"]
        assert doc["best"] == 0.5 and doc["showcase"]["note"] == "fixed"
        assert doc["showcase"]["loss_landscape"]["$media"]["object_type"] == "image"
        assert doc["showcase"]["samples"]["$media"]["mime_type"] == GALLERY_MIME
        assert {s["key"] for s in detail["summary"]} == {"best", "showcase.note"}
        assert {"showcase.loss_landscape", "showcase.samples"}.isdisjoint(detail["run"]["values"])
        listed = client.get("/api/runs", params={"project": "sm", "include": "config"}).json()
        rows = listed["runs"] if isinstance(listed, dict) else listed
        assert rows[0]["summary_doc"] == {"best": 0.5, "showcase": {"note": "fixed"}}
        # Exact readers keep the media.
        docs = client.get(f"/api/runs/{rid}/documents").json()
        assert "$media" in docs["summary"]["showcase"]["loss_landscape"]


# ---- HTTP -------------------------------------------------------------------


@pytest.fixture
def transport(live_server, tmp_path, monkeypatch):
    monkeypatch.setenv("CAIRN_WAL_DIR", str(tmp_path / "wal"))
    t = Transport(live_server, max_retries=1, backoff_base=0.001, backoff_cap=0.001)
    yield t
    t.close()


def test_http_round_trip_overwrite_and_attach(transport, live_server):
    run = cairn.Run(project="sm-http", transport=transport, **QUIET)
    try:
        run.track(1.0, "loss", step=0)
        run.summary(showcase=_showcase(0.9))
        with pytest.raises(ValueError, match="tracked series"):
            run.summary(loss=cairn.Image(_img(0.1)))
    finally:
        run.finish()
    target = live_server.replace("http://", "cairn://")
    first = cairn.Reader(repo=target).run(run.id).media("showcase.loss_landscape").hash

    attached = cairn.attach(run.id, label="showcase", repo=target, system_metrics=False, capture_output=False)
    attached.summary(showcase={"loss_landscape": cairn.Image(_img(0.2))})
    attached.finish()

    back = cairn.Reader(repo=target).run(run.id)
    assert back.status == "completed"
    ref = back.summary["showcase"]["loss_landscape"]
    assert isinstance(ref, MediaRef) and ref.hash != first
    assert len(back.summary["showcase"]["samples"]) == 2
    assert [p.step for p in back.sequence("showcase.loss_landscape").points] == [0]
    with back.edit() as e:
        e.delete_keys("summary", ["showcase.loss_landscape"])
    assert "showcase.loss_landscape" not in {s.name for s in cairn.Reader(repo=target).run(run.id).sequences()}


# ---- gc -----------------------------------------------------------------------


def test_gc_keeps_current_summary_media_and_frees_replaced(tmp_path):
    repo = tmp_path / ".cairn"
    with cairn.Run(project="sm", repo=str(repo), **QUIET) as run:
        run.summary(fig=cairn.Image(_img(0.3)), gal=[cairn.Image(_img(0.4)), cairn.Image(_img(0.6))])
        rid = run.id
    ingest_repo(repo)
    with cairn.Reader(repo=str(repo)).run(rid).edit() as e:
        e.set_summary(fig=cairn.Image(_img(0.7)))
    dd = DataDir(repo)
    db = Database.open(dd.db_path)
    blobs = BlobStore(dd.artifacts_dir)
    try:
        docs = ingest_ops.run_docs(db, rid)["summary"]
        current = docs["fig"]["$media"]["hash"]
        manifest = docs["gal"]["$media"]["hash"]
        items = [i["hash"] for i in json.loads(blobs.get(manifest))["items"]]
        old = time.time() - gc.GRACE_SECONDS - 3600
        for d in blobs.iter_digests():
            os.utime(blobs.path_for(d), (old, old))
        result = gc.collect(db, dd, blobs)
        assert result["deleted"] == 1  # the replaced image
        for h in (current, manifest, *items):
            assert blobs.exists(h)
    finally:
        db.close()


# ---- duplicate steps ----------------------------------------------------------


def test_duplicate_step_warns_once_per_series(fresh_db, caplog):
    rid = ingest_ops.create_run(fresh_db, project="p")["run_id"]

    def point(step, value, t):
        return {"name": "loss", "step": step, "wall_time": f"2026-01-01T00:00:0{t}+00:00",
                "object_type": "scalar", "scalar_value": value}

    batch = [point(0, 1.0, 0), point(1, 1.0, 1)]
    ingest_ops.insert_batch(fresh_db, rid, batch)
    ingest_ops.insert_batch(fresh_db, rid, batch)  # a re-sent batch: not a duplicate
    assert fresh_db.read("SELECT * FROM alerts WHERE run_id = ?", [rid]) == []

    with caplog.at_level("WARNING", logger="cairn.server.ingest_ops"):
        ingest_ops.insert_batch(fresh_db, rid, [point(1, 5.0, 5)])
        ingest_ops.insert_batch(fresh_db, rid, [point(0, 6.0, 6)])
    alerts = fresh_db.read("SELECT level, title, text FROM alerts WHERE run_id = ?", [rid])
    assert len(alerts) == 1
    level, title, text = alerts[0]
    assert level == "warn" and "'loss'" in title and "step 1" in text
    assert sum("step 1" in r.message for r in caplog.records) == 1
    # The first point written is kept.
    assert fresh_db.read("SELECT scalar_value FROM sequences WHERE run_id = ? AND step = 1", [rid]) == [(1.0,)]


def test_duplicate_step_from_a_local_run_becomes_an_alert(tmp_path):
    repo = tmp_path / ".cairn"
    with cairn.Run(project="sm", repo=str(repo), **QUIET) as run:
        run.track(1.0, "acc", step=5)
        run.track(2.0, "acc", step=5)
        rid = run.id
    ingest_repo(repo)
    db = _db(repo)
    try:
        assert db.read("SELECT title FROM alerts WHERE run_id = ?", [rid]) == [("Duplicate step in 'acc'",)]
    finally:
        db.close()
