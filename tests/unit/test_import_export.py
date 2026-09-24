"""Export → import round trips through the HTTP API."""

from __future__ import annotations

import io
import json


def _roundtrip(client, run_ids: list[str]) -> dict[str, str]:
    exported = client.post("/api/export", json={"run_ids": run_ids})
    assert exported.status_code == 200, exported.text
    imported = client.post(
        "/api/import",
        files={"file": ("runs.zip", io.BytesIO(exported.content), "application/zip")},
    )
    assert imported.status_code == 200, imported.text
    return {r["original_id"]: r["new_id"] for r in imported.json()["imported"]}


def _upload(client, data: bytes) -> str:
    r = client.post(
        "/api/artifacts",
        files={"file": ("blob", data, "text/plain")},
        data={"mime_type": "text/plain", "metadata": "{}", "object_type": "text"},
    )
    assert r.status_code == 200, r.text
    return r.json()["hash"]


def test_run_artifacts_survive_import(client):
    rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
    digest = _upload(client, b"hello")
    client.post(f"/api/runs/{rid}/artifacts", json={"name": "notes", "hash": digest})
    client.post(f"/api/runs/{rid}/artifacts", json={"name": "ckpt", "hash": digest, "step": 3})
    db = client.app.state.db
    before = {
        (r["name"], r["step"]): r["created_at"]
        for r in db.read_columns("SELECT * FROM run_artifacts WHERE run_id = ?", [rid])
    }

    new_id = _roundtrip(client, [rid])[rid]

    after = {
        (r["name"], r["step"]): r["created_at"]
        for r in db.read_columns("SELECT * FROM run_artifacts WHERE run_id = ?", [new_id])
    }
    assert after == before
    names = {a["name"] for a in client.get(f"/api/runs/{new_id}/artifacts").json()["named"]}
    assert names == {"notes", "ckpt"}


def test_archive_gallery_mime_matches_the_sdk():
    from cairn.sdk.handlers.image import GALLERY_MIME
    from cairn.server import run_archive

    assert run_archive.GALLERY_MIME == GALLERY_MIME


def _seed_lineage(client) -> dict[str, str]:
    """A parent, a fork of it in a sweep, alerts, metric defs, and a point
    with metadata — every table and column the archive has to carry."""
    db = client.app.state.db
    parent = client.post("/api/runs", json={"project": "p", "name": "parent"}).json()["run_id"]
    child = client.post("/api/runs", json={
        "project": "p", "name": "child", "parent_run_id": parent, "fork_step": 5,
        "group": "g", "job_type": "train", "sweep_id": "sw1",
        "git": {"sha": "abc", "remote": "https://example.com/r.git"},
    }).json()["run_id"]
    client.post(f"/api/runs/{child}/batch", json={"points": [
        {"name": "img", "step": 1, "wall_time": "2025-01-01T00:00:00Z",
         "object_type": "scalar", "scalar_value": 1.0, "metadata": {"caption": "a cat"}},
    ]})
    db.write("UPDATE runs SET data_epoch = 2, stop_requested = '2025-01-02' WHERE id = ?", [child])
    db.write(
        "INSERT INTO sweeps (id, project_id, name, method, space, metric, goal, command, status, created_at) "
        "VALUES ('sw1', 'p', 'lr', 'grid', '{\"lr\": [1, 2]}', 'loss', 'minimize', 'python t.py', 'running', '2025-01-01')"
    )
    db.write(
        "INSERT INTO sweep_trials (id, sweep_id, run_id, params, status, value, created_at) VALUES "
        "('t1', 'sw1', ?, '{\"lr\": 1}', 'completed', 0.5, '2025-01-01'), "
        "('t2', 'sw1', 'ghost', '{\"lr\": 2}', 'failed', NULL, '2025-01-02'), "
        "('t3', 'sw1', NULL, '{\"lr\": 3}', 'pending', NULL, '2025-01-03')",
        [child],
    )
    db.write(
        "INSERT INTO alerts (id, run_id, project_id, level, title, text, created_at, delivered_at) "
        "VALUES ('al1', ?, 'p', 'warn', 'slow', 'loss plateau', '2025-01-01', NULL)",
        [child],
    )
    db.write(
        "INSERT INTO metric_defs (run_id, name, step_metric, summary) VALUES (?, 'val/*', 'epoch', 'max')",
        [child],
    )
    return {"parent": parent, "child": child}


def test_roundtrip_carries_new_columns_and_tables_with_id_remap(client):
    db = client.app.state.db
    ids = _seed_lineage(client)
    id_map = _roundtrip(client, [ids["parent"], ids["child"]])
    new_parent, new_child = id_map[ids["parent"]], id_map[ids["child"]]
    assert new_parent != ids["parent"] and new_child != ids["child"]

    (run,) = db.read_columns("SELECT * FROM runs WHERE id = ?", [new_child])
    assert run["parent_run_id"] == new_parent  # remapped to the imported parent
    assert run["fork_step"] == 5
    assert (run["run_group"], run["job_type"]) == ("g", "train")
    assert run["git_remote"] == "https://example.com/r.git"
    assert (run["data_epoch"], run["stop_requested"]) == (2, "2025-01-02")

    # The sweep is imported under a new id and the run follows it.
    assert run["sweep_id"] not in (None, "sw1")
    (sweep,) = db.read_columns("SELECT * FROM sweeps WHERE id = ?", [run["sweep_id"]])
    assert (sweep["method"], sweep["metric"], sweep["command"]) == ("grid", "loss", "python t.py")
    trials = {
        t["params"]: t for t in db.read_columns(
            "SELECT * FROM sweep_trials WHERE sweep_id = ?", [run["sweep_id"]]
        )
    }
    assert trials['{"lr": 1}']["run_id"] == new_child
    assert trials['{"lr": 1}']["value"] == 0.5
    assert trials['{"lr": 2}']["run_id"] is None  # target never existed
    assert trials['{"lr": 3}']["run_id"] is None
    assert {t["id"] for t in trials.values()}.isdisjoint({"t1", "t2", "t3"})

    (alert,) = db.read_columns("SELECT * FROM alerts WHERE run_id = ?", [new_child])
    assert (alert["level"], alert["title"], alert["text"]) == ("warn", "slow", "loss plateau")
    assert alert["id"] != "al1" and alert["project_id"] == "p"
    assert db.read_columns(
        "SELECT name, step_metric, summary FROM metric_defs WHERE run_id = ?", [new_child]
    ) == [{"name": "val/*", "step_metric": "epoch", "summary": "max"}]
    (point,) = db.read_columns("SELECT metadata FROM sequences WHERE run_id = ?", [new_child])
    assert json.loads(point["metadata"]) == {"caption": "a cat"}


def test_reference_outside_the_archive_is_kept_if_present_else_nulled(client):
    db = client.app.state.db
    ids = _seed_lineage(client)
    # Export the child alone: its parent is not in the archive but IS in
    # this repo, so the reference stays.
    new_child = _roundtrip(client, [ids["child"]])[ids["child"]]
    (run,) = db.read_columns("SELECT parent_run_id FROM runs WHERE id = ?", [new_child])
    assert run["parent_run_id"] == ids["parent"]

    # A parent that exists nowhere is dropped.
    db.write("UPDATE runs SET parent_run_id = 'gone' WHERE id = ?", [ids["child"]])
    new_child = _roundtrip(client, [ids["child"]])[ids["child"]]
    (run,) = db.read_columns("SELECT parent_run_id FROM runs WHERE id = ?", [new_child])
    assert run["parent_run_id"] is None


def test_zip_reader_keeps_ids_and_new_columns(client, tmp_path):
    import cairn

    ids = _seed_lineage(client)
    exported = client.post("/api/export", json={"run_ids": [ids["parent"], ids["child"]]})
    path = tmp_path / "runs.zip"
    path.write_bytes(exported.content)

    reader = cairn.Reader(repo=path)
    try:
        child = reader.run(ids["child"])
        assert child.group == "g" and child.job_type == "train"
        assert child._raw["parent_run_id"] == ids["parent"]
        assert child._raw["sweep_id"] == "sw1"
    finally:
        reader.close()


def test_delete_run_clears_its_alerts_and_defs_and_unlinks_trials(client):
    db = client.app.state.db
    ids = _seed_lineage(client)
    assert client.delete(f"/api/runs/{ids['child']}").status_code == 200
    for table in ("alerts", "metric_defs"):
        assert db.read_columns(f"SELECT * FROM {table} WHERE run_id = ?", [ids["child"]]) == []
    (trial,) = db.read_columns("SELECT run_id FROM sweep_trials WHERE id = 't1'")
    assert trial["run_id"] is None
