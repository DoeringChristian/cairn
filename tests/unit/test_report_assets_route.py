"""Report image uploads: POST .../reports/{rid}/assets and GET /api/reports/{rid}/assets/{hash}."""

from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient

from cairn.server import auth as auth_core
from cairn.server.app import create_app
from cairn.server.routes import report_assets

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 32
GIF = b"GIF89a" + b"\x00" * 32
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 32


def _report(client) -> tuple[str, str]:
    pid = client.post("/api/runs", json={"project": "p"}).json()["project_id"]
    rid = client.post(f"/api/projects/{pid}/reports",
                      json={"name": "r", "payload": {"source": ""}}).json()["id"]
    return pid, rid


def _upload(client, pid, rid, data, *, declared="image/png", headers=None):
    return client.post(
        f"/api/projects/{pid}/reports/{rid}/assets",
        files={"file": ("x", io.BytesIO(data), declared)},
        headers=headers or {},
    )


@pytest.mark.parametrize(("data", "mime"), [
    (PNG, "image/png"), (JPEG, "image/jpeg"), (GIF, "image/gif"), (WEBP, "image/webp"),
])
def test_upload_and_fetch(client, data, mime):
    pid, rid = _report(client)
    # The declared type is ignored; the bytes decide.
    r = _upload(client, pid, rid, data, declared="application/octet-stream")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["mime_type"] == mime
    assert body["size_bytes"] == len(data)
    assert body["ref"] == f"cairn-asset:{body['hash']}"
    assert body["url"] == f"/api/reports/{rid}/assets/{body['hash']}"

    got = client.get(body["url"])
    assert got.status_code == 200
    assert got.content == data
    assert got.headers["content-type"] == mime
    assert "immutable" in got.headers["cache-control"]
    assert got.headers["x-content-type-options"] == "nosniff"


def test_non_image_rejected(client):
    pid, rid = _report(client)
    for data in (b"<svg onload=alert(1)>", b"<html></html>", b"", b"RIFF\x00\x00\x00\x00WAVE"):
        r = _upload(client, pid, rid, data, declared="image/png")
        assert r.status_code == 415, data


def test_too_large_rejected(client, monkeypatch):
    monkeypatch.setattr(report_assets, "MAX_ASSET_BYTES", 64)
    pid, rid = _report(client)
    assert _upload(client, pid, rid, PNG + b"\x00" * 64).status_code == 413
    assert _upload(client, pid, rid, PNG).status_code == 200


def test_asset_is_scoped_to_its_report(client):
    pid, rid = _report(client)
    other = client.post(f"/api/projects/{pid}/reports",
                        json={"name": "o", "payload": {"source": ""}}).json()["id"]
    digest = _upload(client, pid, rid, PNG).json()["hash"]
    assert client.get(f"/api/reports/{other}/assets/{digest}").status_code == 404
    assert client.get(f"/api/reports/{rid}/assets/{'0' * 64}").status_code == 404
    assert client.get(f"/api/reports/{rid}/assets/not-a-hash").status_code == 404


def test_unknown_report_404(client):
    pid, _rid = _report(client)
    assert _upload(client, pid, "nope", PNG).status_code == 404


def test_reupload_is_idempotent(client):
    pid, rid = _report(client)
    a = _upload(client, pid, rid, PNG).json()
    b = _upload(client, pid, rid, PNG).json()
    assert a["hash"] == b["hash"]


def test_delete_report_removes_asset_rows(app, client):
    pid, rid = _report(client)
    digest = _upload(client, pid, rid, PNG).json()["hash"]
    assert client.delete(f"/api/projects/{pid}/reports/{rid}").status_code == 200
    assert app.state.db.read("SELECT * FROM report_assets WHERE report_id = ?", [rid]) == []
    assert client.get(f"/api/reports/{rid}/assets/{digest}").status_code == 404


def test_upload_requires_write(tmp_path):
    app = create_app(data_dir=tmp_path / "cairn", auth_enabled=True)
    with TestClient(app) as c:
        tok = {}
        for role in ("write", "read"):
            _id, plain = auth_core.create_token(app.state.db, name=role, role=role)
            tok[role] = {"Authorization": f"Bearer {plain}"}
        pid = c.post("/api/runs", json={"project": "p"}, headers=tok["write"]).json()["project_id"]
        rid = c.post(f"/api/projects/{pid}/reports", json={"name": "r", "payload": {"source": ""}},
                     headers=tok["write"]).json()["id"]
        assert _upload(c, pid, rid, PNG, headers=tok["read"]).status_code == 403
        r = _upload(c, pid, rid, PNG, headers=tok["write"])
        assert r.status_code == 200
        assert c.get(r.json()["url"]).status_code == 401
        assert c.get(r.json()["url"], headers=tok["read"]).status_code == 200
