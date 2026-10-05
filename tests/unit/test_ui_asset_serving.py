"""The viewer's assets are cached as immutable and sent gzipped; shells are no-cache."""

from __future__ import annotations

import gzip

from fastapi.testclient import TestClient

from cairn.server.app import create_app
from cairn.server.ui_mount import IMMUTABLE, NO_CACHE

JS = ("export const x = " + "'abcdefghij' + " * 400 + "'';\n").encode()


def _client(tmp_path, monkeypatch) -> TestClient:
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><script src='/assets/main-abc.js'></script>")
    (dist / "assets" / "main-abc.js").write_bytes(JS)
    (dist / "assets" / "logo-abc.png").write_bytes(b"\x89PNG" + b"\0" * 4096)
    monkeypatch.setenv("CAIRN_UI_DIST", str(dist))
    return TestClient(create_app(data_dir=tmp_path / "cairn", mount_ui=True))


def test_assets_are_immutable_and_gzipped(tmp_path, monkeypatch) -> None:
    c = _client(tmp_path, monkeypatch)
    r = c.get("/assets/main-abc.js", headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200
    assert r.headers["cache-control"] == IMMUTABLE
    assert r.headers["content-encoding"] == "gzip"
    assert r.headers["content-type"].startswith("text/javascript")
    assert r.content == JS  # the client decodes it
    assert int(r.headers["content-length"]) < len(JS) // 5

    plain = c.get("/assets/main-abc.js", headers={"Accept-Encoding": "identity"})
    assert "content-encoding" not in plain.headers and plain.content == JS

    etag = r.headers["etag"]
    assert c.get("/assets/main-abc.js", headers={"If-None-Match": etag}).status_code == 304


def test_compressed_formats_are_not_regzipped_and_unknown_assets_404(tmp_path, monkeypatch) -> None:
    c = _client(tmp_path, monkeypatch)
    r = c.get("/assets/logo-abc.png", headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200 and "content-encoding" not in r.headers
    assert c.get("/assets/nope.js").status_code == 404
    assert c.get("/assets/..%2Findex.html").status_code == 404  # traversal stays inside assets/


def test_shells_are_no_cache(tmp_path, monkeypatch) -> None:
    c = _client(tmp_path, monkeypatch)
    for path in ("/", "/p/x/reports"):
        r = c.get(path)
        assert r.status_code == 200 and r.headers["cache-control"] == NO_CACHE
