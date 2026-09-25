"""run.summary values survive export/import, read back through Reader, and filter queries."""

from __future__ import annotations

import hashlib
import io

import httpx
import pytest

import cairn


def _post_run(client, name, summary, payload):
    rid = client.post("/api/runs", json={"project": "demo", "name": name}).json()["run_id"]
    client.post(f"/api/runs/{rid}/summary", json={"summary": summary})
    client.post(
        "/api/artifacts",
        files={"file": ("x.bin", io.BytesIO(payload), "application/octet-stream")},
        data={"mime_type": "application/octet-stream"},
    )
    client.post(f"/api/runs/{rid}/artifacts", json={"name": "render", "hash": hashlib.sha256(payload).hexdigest()})
    return rid


def test_summary_round_trips_through_export_and_import(client):
    rid = _post_run(client, "a", {"acc": 0.91, "eval": {"loss": 0.2}}, b"a")
    exported = client.post("/api/export", json={"run_ids": [rid]})
    assert exported.status_code == 200
    imported = client.post(
        "/api/import", files={"file": ("runs.zip", io.BytesIO(exported.content), "application/zip")}
    )
    assert imported.status_code == 200, imported.text
    new_id = imported.json()["imported"][0]["new_id"]
    summary = client.get(f"/api/runs/{new_id}").json()["summary"]
    assert {s["key"] for s in summary} == {"acc", "eval.loss"}


def test_query_filters_on_summary(client):
    _post_run(client, "good", {"acc": 0.95}, b"good")
    _post_run(client, "bad", {"acc": 0.40}, b"bad")
    r = client.get(
        "/api/query",
        params={"tag": "render", "project": "demo", "summary.acc__gt": "0.9", "format": "json"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["digest"] == hashlib.sha256(b"good").hexdigest()


def test_reader_exposes_and_filters_summary(tmp_path):
    repo = tmp_path / ".cairn"
    for name, acc in (("good", 0.95), ("bad", 0.4)):
        run = cairn.Run(project="p", name=name, repo=str(repo), capture_source=False, capture_stdout=False,
                        capture_env=False, capture_system_metrics=False)
        run.summary({"acc": acc, "eval": {"loss": 1 - acc}})
        run.finish()
    reader = cairn.Reader(repo=str(repo))
    runs = reader.runs(project="p").list()
    by_name = {r.name: r for r in runs}
    assert by_name["good"].summary == {"acc": 0.95, "eval.loss": 1 - 0.95}
    picked = reader.runs(project="p").filter(summary__acc__gt=0.9).list()
    assert [r.name for r in picked] == ["good"]


@pytest.fixture(params=["direct", "server"])
def repo(request, tmp_path):
    if request.param == "server":
        return request.getfixturevalue("live_server").replace("http://", "cairn://")
    return str(tmp_path / ".cairn")


def test_reader_final_is_what_the_runs_table_shows(repo):
    with cairn.Run(project="p", repo=repo, capture_source=False, capture_stdout=False,
                   capture_env=False, capture_system_metrics=False) as run:
        for step, (loss, acc, lr) in enumerate([(3.0, 0.1, 1.0), (1.0, 0.5, 2.0), (2.0, 0.4, 0.5)]):
            run.track(loss, name="loss", step=step, summary="min")  # rule beats the last point
            run.track(acc, name="acc", step=step)                    # last point
            run.track(lr, name="lr", step=step, summary="max")
        run.summary({"lr": 7.0, "note": "done"})                    # explicit key beats the rule
    expected = {"loss": 1.0, "acc": 0.4, "lr": 7.0, "note": "done"}

    reader = cairn.Reader(repo=repo)
    try:
        assert reader.run(run.id).final == expected
        (listed,) = reader.runs("p").list()
        assert listed.final == expected
        if repo.startswith("cairn://"):
            base = repo.replace("cairn://", "http://")
            assert httpx.get(f"{base}/api/runs/{run.id}").json()["run"]["values"] == expected
        # Editing the summary refreshes it.
        with listed.edit() as ed:
            ed.set_summary(acc=0.99)
        assert listed.final["acc"] == 0.99
    finally:
        reader.close()
