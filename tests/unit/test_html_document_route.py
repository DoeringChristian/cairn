"""``GET /api/artifacts/{digest}/html``: logged HTML as its own sandboxed
document (the HTML card's frame) — headers, the resize shim, the head of a
big file, revalidation, and share-link admission."""

from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient

from cairn.server import auth as auth_core
from cairn.server.app import create_app
from cairn.server.routes.artifacts import HTML_DOC_SANDBOX, RESIZE_SHIM, inject_resize_shim
from cairn.server.run_sets import run_sets_yaml

PAGE = (
    b"<html><body><h1>hi \xc3\xa9</h1>"
    b'<iframe src="https://www.youtube.com/embed/x"></iframe>'
    b'<script src="https://cdn.jsdelivr.net/npm/x"></script></body></html>'
)


def _upload(client: TestClient, data: bytes, mime: str = "text/html") -> str:
    r = client.post("/api/artifacts", files={"file": ("f.html", io.BytesIO(data), mime)},
                    data={"mime_type": mime})
    assert r.status_code == 200, r.text
    return r.json()["hash"]


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(data_dir=tmp_path / "cairn")) as c:
        yield c


def test_headers_sandbox_without_frame_restriction(client):
    h = _upload(client, PAGE)
    r = client.get(f"/api/artifacts/{h}/html")
    assert r.status_code == 200
    assert r.headers["content-type"] == "text/html; charset=utf-8"
    csp = r.headers["content-security-policy"]
    assert csp == HTML_DOC_SANDBOX == "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox"
    # Opaque origin, no app takeover, and no restriction on what it may load.
    for forbidden in ("allow-same-origin", "allow-top-navigation", "frame-src", "default-src", "script-src", "img-src"):
        assert forbidden not in csp
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["cache-control"] == "no-cache"


def test_shim_injected_before_body_end(client):
    h = _upload(client, PAGE)
    body = client.get(f"/api/artifacts/{h}/html").text
    assert body.count(RESIZE_SHIM) == 1
    assert body.index(RESIZE_SHIM) < body.lower().index("</body>")
    assert "hi é" in body and "youtube.com/embed" in body
    assert '"cairn:resize"' in RESIZE_SHIM
    # The card header's screenshot asks the document to picture itself.
    assert '"cairn:snapshot"' in RESIZE_SHIM and "foreignObject" in RESIZE_SHIM


@pytest.mark.parametrize(("html", "where"), [
    ("<p>x</p></BODY></html>", "</BODY>"),
    ("<p>x</p></html>", "</html>"),
    ("<p>x</p>", None),
])
def test_inject_resize_shim_placement(html, where):
    out = inject_resize_shim(html)
    if where is None:
        assert out == html + RESIZE_SHIM
    else:
        assert out.index(RESIZE_SHIM) + len(RESIZE_SHIM) == out.index(where)


def test_unknown_digest_is_404(client):
    assert client.get("/api/artifacts/" + "0" * 64 + "/html").status_code == 404


def test_head_of_a_big_file(client):
    big = "<p>" + "é" * 100 + "</p>"
    h = _upload(client, big.encode())
    r = client.get(f"/api/artifacts/{h}/html?max_bytes=10")
    assert r.status_code == 200
    # 3 bytes of "<p>" + 3½ two-byte characters: the split one is dropped.
    assert r.text == "<p>ééé" + RESIZE_SHIM
    whole = client.get(f"/api/artifacts/{h}/html?max_bytes=100000")
    assert whole.text == inject_resize_shim(big)
    assert whole.headers["etag"] == client.get(f"/api/artifacts/{h}/html").headers["etag"]
    assert r.headers["etag"] != whole.headers["etag"]


def test_revalidation_is_a_304(client):
    h = _upload(client, PAGE)
    etag = client.get(f"/api/artifacts/{h}/html").headers["etag"]
    assert h in etag
    r = client.get(f"/api/artifacts/{h}/html", headers={"If-None-Match": etag})
    assert r.status_code == 304
    assert r.headers["content-security-policy"] == HTML_DOC_SANDBOX


def test_share_link_admits_only_in_scope_html(tmp_path):
    app = create_app(data_dir=tmp_path / "cairn", auth_enabled=True)
    with TestClient(app) as owner:
        _id, token = auth_core.create_token(app.state.db, name="w", role="write")
        owner.headers.update({"Authorization": f"Bearer {token}"})
        a = owner.post("/api/runs", json={"project": "p", "name": "a"}).json()
        pid, a = a["project_id"], a["run_id"]
        b = owner.post("/api/runs", json={"project": "p", "name": "b"}).json()["run_id"]
        mine, theirs = _upload(owner, PAGE), _upload(owner, PAGE + b"<!-- b -->")
        for run, h in ((a, mine), (b, theirs)):
            r = owner.post(f"/api/runs/{run}/batch", json={"points": [{
                "name": "page", "step": 1, "wall_time": "2026-01-01T00:00:00Z",
                "object_type": "html", "artifact_hash": h,
            }]})
            assert r.status_code == 200, r.text
        source = f"```cairn\n{run_sets_yaml([a])}\ncards:\n  - {{metric: page, type: html}}\n```"
        rid = owner.post(f"/api/projects/{pid}/reports", json={"name": "r", "payload": {"source": source}}).json()["id"]
        secret = owner.post(f"/api/projects/{pid}/reports/{rid}/shares", json={}).json()["secret"]

        viewer = TestClient(app)
        assert viewer.post("/api/share/redeem", json={"secret": secret}).status_code == 200
        r = viewer.get(f"/api/artifacts/{mine}/html")
        assert r.status_code == 200 and RESIZE_SHIM in r.text
        assert viewer.get(f"/api/artifacts/{theirs}/html").status_code == 403
        # No login, no share: refused.
        assert TestClient(app).get(f"/api/artifacts/{mine}/html").status_code == 401
