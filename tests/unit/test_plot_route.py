"""Tests for the standalone cairn-plot shell route `GET /plot` (Phase B).

Mirrors the `/embed/card` route wiring in `app._mount_spa_or_placeholder`:
both serve a separate HTML bundle read once at startup, registered before the
SPA catch-all. The route exists only when the UI `dist/plot.html` is present
(the committed build), so these tests skip cleanly on a source-only checkout.
Uses the shared ``client`` fixture (``tests/conftest.py``), which builds an
app with the UI mounted from ``cairn/ui/dist``.
"""

from __future__ import annotations

from pathlib import Path

import pytest

import cairn.server.app as app_module

_UI_DIST = Path(app_module.__file__).resolve().parent.parent / "ui" / "dist"
_PLOT_HTML = _UI_DIST / "plot.html"

pytestmark = pytest.mark.skipif(
    not _PLOT_HTML.exists(),
    reason="ui/dist/plot.html not built; skip the /plot shell route test",
)


def test_plot_route_serves_shell(client):
    r = client.get("/plot")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/html")
    # The plot entry's mount point — the standalone shell, NOT the SPA (which
    # mounts #root) and NOT the embed (#embed-root). Vite rewrites the module
    # `<script src>` to a hashed `assets/plot-*.js` chunk, so assert on that.
    assert "cairn-plot-root" in r.text
    assert "assets/plot-" in r.text


def test_plot_route_matches_committed_bytes(client):
    # Served bytes are the committed dist/plot.html, read once at startup.
    assert client.get("/plot").content == _PLOT_HTML.read_bytes()
