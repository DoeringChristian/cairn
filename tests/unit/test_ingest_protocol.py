"""The upload protocol (0.6 spec §4): records applied exactly once, blobs by hash."""

from __future__ import annotations

import gzip
import hashlib
import json

import pytest

from cairn.server.routes import records as records_route

RID = "a" * 32


def _url(run_id: str = RID, log: str = "main") -> str:
    return f"/api/ingest/runs/{run_id}/logs/{log}"


def _post(client, records, *, run_id=RID, log="main", from_seq=None):
    return client.post(_url(run_id, log), json={
        "from_seq": records[0]["seq"] if from_seq is None else from_seq, "records": records,
    })


def _create(seq=1, run_id=RID):
    return {"seq": seq, "op": "create_run", "t": 0.0,
            "payload": {"project": "p", "run_id": run_id, "name": "r"}}


def _points(seq, steps, run_id=RID, name="loss"):
    return {"seq": seq, "op": "batch", "t": 0.0, "payload": {"run_id": run_id, "points": [
        {"name": name, "step": s, "wall_time": "2026-10-10T00:00:00+00:00",
         "object_type": "scalar", "scalar_value": float(s)} for s in steps
    ]}}


def _count_points(client, run_id=RID):
    (n,) = client.app.state.db.read_one("SELECT COUNT(*) FROM sequences WHERE run_id = ?", [run_id])
    return n


def test_unknown_log_is_at_zero(client):
    assert client.get(_url()).json() == {"applied_seq": 0}


def test_apply_and_progress(client):
    r = _post(client, [_create(1), _points(2, range(5))])
    assert r.status_code == 200 and r.json() == {"applied_seq": 2}
    assert client.get(_url()).json() == {"applied_seq": 2}
    assert _count_points(client) == 5
    (applied,) = client.app.state.db.read_one(
        "SELECT applied_seq FROM ingest_progress WHERE run_id = ? AND log = 'main'", [RID])
    assert applied == 2


def test_replay_is_ignored(client):
    batch = [_create(1), _points(2, range(5))]
    assert _post(client, batch).json() == {"applied_seq": 2}
    # The client did not see the answer and sends the same batch again.
    assert _post(client, batch).json() == {"applied_seq": 2}
    # An overlapping batch applies only the new records.
    assert _post(client, [_points(2, range(5)), _points(3, range(5, 8))]).json() == {"applied_seq": 3}
    assert _count_points(client) == 8


def test_gap_is_409_with_applied_seq(client):
    _post(client, [_create(1)])
    r = _post(client, [_points(3, [0])])
    assert r.status_code == 409
    assert r.json()["applied_seq"] == 1
    assert _count_points(client) == 0


def test_from_seq_must_match_first_record(client):
    r = _post(client, [_create(1)], from_seq=2)
    assert r.status_code == 422


@pytest.mark.parametrize("body", [
    {"records": "x"},
    {"from_seq": 1, "records": [{"seq": 1}]},
    {"from_seq": 1, "records": [{"seq": 2, "op": "x"}, {"seq": 1, "op": "x"}]},
    {"from_seq": 0, "records": []},
])
def test_malformed_batches_are_422(client, body):
    assert client.post(_url(), json=body).status_code == 422


def test_bad_names_are_422(client):
    assert client.get(_url("bad id!")).status_code == 422
    assert client.get(_url(log=".hidden")).status_code == 422


def test_record_without_payload_object(client):
    """Every field but seq/op/t is then the payload."""
    rec = {"seq": 1, "op": "create_run", "t": 0.0, "project": "p", "run_id": RID}
    assert _post(client, [rec]).json() == {"applied_seq": 1}
    assert client.get(f"/api/runs/{RID}").status_code == 200


def test_gzip_body(client):
    body = gzip.compress(json.dumps({"from_seq": 1, "records": [_create(1)]}).encode())
    r = client.post(_url(), content=body, headers={
        "Content-Encoding": "gzip", "Content-Type": "application/json"})
    assert r.status_code == 200 and r.json() == {"applied_seq": 1}


def test_body_over_the_limit_is_413(client, monkeypatch):
    monkeypatch.setattr(records_route, "MAX_BODY", 100)
    r = _post(client, [_create(1), _points(2, range(50))])
    assert r.status_code == 413


def test_worker_log_waits_for_its_run(client):
    join = {"seq": 1, "op": "join", "t": 0.0, "payload": {"run_id": RID, "label": "w1"}}
    r = _post(client, [join, _points(2, [0], name="w/loss")], log="w1")
    assert r.status_code == 503 and "Retry-After" in r.headers
    assert r.json()["applied_seq"] == 0
    _post(client, [_create(1)])
    assert _post(client, [join, _points(2, [0], name="w/loss")], log="w1").json() == {"applied_seq": 2}


def test_worker_log_cannot_finish_the_run(client):
    _post(client, [_create(1)])
    join = {"seq": 1, "op": "join", "t": 0.0, "payload": {"run_id": RID, "label": "w1"}}
    fin = {"seq": 2, "op": "finish", "t": 0.0, "payload": {"run_id": RID, "status": "failed"}}
    assert _post(client, [join, fin], log="w1").status_code == 200
    (status,) = client.app.state.db.read_one("SELECT status FROM runs WHERE id = ?", [RID])
    assert status == "running"


def test_fork_waits_for_its_parent(client):
    child = "b" * 32
    fork = {"seq": 1, "op": "fork_run", "t": 0.0,
            "payload": {"parent_id": RID, "new_id": child, "step": 0, "project": "p"}}
    r = _post(client, [fork], run_id=child)
    assert r.status_code == 503
    _post(client, [_create(1), _points(2, [0, 1])])
    assert _post(client, [fork], run_id=child).json() == {"applied_seq": 1}


# ---- blobs ---------------------------------------------------------------------


def test_blob_head_put(client):
    data = b"hello blob"
    digest = hashlib.sha256(data).hexdigest()
    assert client.head(f"/api/blobs/{digest}").status_code == 404
    assert client.put(f"/api/blobs/{digest}", content=data).status_code == 201
    assert client.head(f"/api/blobs/{digest}").status_code == 200
    assert client.put(f"/api/blobs/{digest}", content=data).status_code == 200
    assert client.app.state.blobs.get(digest) == data


def test_blob_hash_mismatch_is_400(client):
    digest = hashlib.sha256(b"right").hexdigest()
    assert client.put(f"/api/blobs/{digest}", content=b"wrong").status_code == 400
    assert client.head(f"/api/blobs/{digest}").status_code == 404


def test_blob_name_must_be_sha256(client):
    assert client.head("/api/blobs/xyz").status_code == 422


def test_missing_blobs_are_409_and_nothing_applied(client):
    data = b"\x89PNG fake"
    digest = hashlib.sha256(data).hexdigest()
    meta = {"seq": 2, "op": "artifact_meta", "t": 0.0, "payload": {
        "hash": digest, "mime_type": "image/png", "size_bytes": len(data), "object_type": "image"}}
    point = {"seq": 3, "op": "batch", "t": 0.0, "payload": {"run_id": RID, "points": [{
        "name": "img", "step": 0, "wall_time": "2026-10-10T00:00:00+00:00",
        "object_type": "image", "artifact_hash": digest}]}}
    r = _post(client, [_create(1), meta, point])
    assert r.status_code == 409
    assert r.json() == {"detail": r.json()["detail"], "applied_seq": 0, "missing_blobs": [digest]}
    assert client.get(_url()).json() == {"applied_seq": 0}
    client.put(f"/api/blobs/{digest}", content=data)
    assert _post(client, [_create(1), meta, point]).json() == {"applied_seq": 3}
    (h,) = client.app.state.db.read_one("SELECT artifact_hash FROM sequences WHERE run_id = ?", [RID])
    assert h == digest


def test_busy_server_says_retry_later(client, monkeypatch):
    client.app.state.ingest_in_flight = records_route.MAX_IN_FLIGHT
    r = _post(client, [_create(1)])
    assert r.status_code == 503 and r.headers["Retry-After"]
    client.app.state.ingest_in_flight = 0
