"""Durability contracts shared by direct access and HTTP ingestion.

A successful acknowledgement covers every record, and published report
history survives later publications. These tests reproduce the review bugs.
"""
import json
import pytest
from cairn.backend import artifact_registry_ops, ingest_ops, report_publications
from tests.unit.test_ingest_protocol import _create, _points, _post, _url, RID


def test_rejected_record_rolls_back_batch_and_ack(client):
    assert _post(client, [_create()]).status_code == 200
    bad = {"seq": 3, "op": "summary", "payload": {"run_id": RID, "summary": [1, 2]}}
    response = _post(client, [_points(2, [0, 1]), bad])
    assert response.status_code == 422, response.text
    assert client.get(_url()).json() == {"applied_seq": 1}
    assert client.app.state.db.read_one("SELECT COUNT(*) FROM sequences WHERE run_id=?", [RID])[0] == 0
    assert client.app.state.db.read_one("SELECT COUNT(*) FROM ingest_receipts WHERE run_id=? AND seq>1", [RID])[0] == 0


def test_unknown_operation_is_not_acknowledged(client):
    response = _post(client, [_create(), {"seq": 2, "op": "typo", "payload": {"run_id": RID}}])
    assert response.status_code == 422
    assert client.get(_url()).json() == {"applied_seq": 0}
    assert client.get(f"/api/runs/{RID}").status_code == 404


def test_conflicting_retry_is_rejected_and_original_data_survives(client):
    original = [_create(), _points(2, [1])]
    assert _post(client, original).status_code == 200
    assert _post(client, original).status_code == 200
    response = _post(client, [_points(2, [100]), _points(3, [200])])
    assert response.status_code == 409
    assert client.get(_url()).json() == {"applied_seq": 2}
    assert [r[0] for r in client.app.state.db.read("SELECT scalar_value FROM sequences WHERE run_id=?", [RID])] == [1.0]


def test_gap_inside_batch_rolls_back_new_records(client):
    assert _post(client, [_create()]).status_code == 200
    response = _post(client, [_points(2, [1]), _points(4, [2])])
    assert response.status_code == 409
    assert client.get(_url()).json() == {"applied_seq": 1}
    assert client.app.state.db.read_one("SELECT COUNT(*) FROM sequences WHERE run_id=?", [RID])[0] == 0


def _report_version(db, blobs, text):
    content = text.encode()
    content_hash, _ = blobs.put(content)
    manifest = {"files": [{"path": "study/index.html", "hash": content_hash, "size": len(content), "mime": "text/html"}]}
    digest, _ = blobs.put(json.dumps(manifest).encode())
    return artifact_registry_ops.create_version(db, blobs, project_id="p", name="report-study", type="report", digest=digest)


def test_report_publication_compare_and_swap_and_historical_retention(fresh_db, blob_store):
    db = fresh_db
    ingest_ops.create_run(db, project="p")
    v1, v2, stale = [_report_version(db, blob_store, body) for body in ("first", "second", "stale")]
    first = report_publications.publish(db, "p", "study", "Study", "# Study", v1["id"])
    report_publications.publish(db, "p", "study", "Study", "# Study 2", v2["id"], expected_version=v1["id"])
    with pytest.raises(report_publications.PublicationConflict):
        report_publications.publish(db, "p", "study", "Stale", "# Stale", stale["id"], expected_version=v1["id"])
    assert report_publications.current_version(db, "p", "study") == v2["id"]
    assert {r[0] for r in db.read("SELECT version_id FROM report_publications WHERE report_id=?", [first["id"]])} == {v1["id"], v2["id"]}
    for version in (v1, v2):
        with pytest.raises(ValueError, match="report"):
            artifact_registry_ops.delete_version(db, version["id"], force=True)
    with pytest.raises(ValueError, match="report"):
        artifact_registry_ops.delete_family(db, v1["family_id"])
    artifact_registry_ops.delete_version(db, stale["id"], force=True)


def test_stop_poll_makes_one_attempt_without_retry_sleep(monkeypatch):
    import httpx
    from cairn.sdk.runlog.server import ServerReads
    calls = []
    def unavailable(request):
        calls.append(request)
        raise httpx.ConnectError('offline', request=request)
    def no_sleep(seconds):
        raise AssertionError('a stop poll must not back off after its only attempt')
    monkeypatch.setattr('cairn.sdk.transport.time.sleep', no_sleep)
    reads = ServerReads('http://example.invalid', None)
    transport = reads.peek()
    transport._client.close()
    transport._client = httpx.Client(base_url='http://example.invalid', transport=httpx.MockTransport(unavailable))
    try:
        with pytest.raises(httpx.ConnectError):
            transport.read_run('run')
        assert len(calls) == 1
    finally:
        reads.close()


def test_run_edit_compare_and_swap_and_snapshot_history(tmp_path):
    import cairn
    from cairn.backend.revisions import RevisionConflict
    from cairn.backend.snapshots import capture_run
    from cairn.backend.repository import Repository
    repo = tmp_path / 'repo'
    with cairn.init(project='demo', repo=repo, capture_source=False) as run:
        run.log({'loss': 1.0})
        run.summary['result'] = 1
    with cairn.Reader(repo) as reader:
        one = reader.run(run.id).edit()
        two = reader.run(run.id).edit()
        storage = Repository(repo)
        original = capture_run(storage._db, run.id)
        one.set_summary(result=2)
        with pytest.raises(RevisionConflict):
            two.set_summary(result=3)
        updated = capture_run(storage._db, run.id)
        assert original['snapshot_id'] != updated['snapshot_id']
        pinned = capture_run(storage._db, run.id, original['snapshot_id'])
        assert pinned['documents']['summary']['result'] == 1
        assert updated['documents']['summary']['result'] == 2
        one.close()
        two.close()
        storage.close()
