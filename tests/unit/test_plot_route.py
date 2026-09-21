"""Tests for the standalone cairn-plot shell route `GET /plot` (Phase B).

Mirrors the `/embed/card` route wiring in `app._mount_spa_or_placeholder`:
both serve a separate HTML bundle read once at startup, registered before the
SPA catch-all. The route exists only when the UI `dist/plot.html` is present
(the committed build), so these tests skip cleanly on a source-only checkout.
Uses the shared ``client`` fixture (``tests/conftest.py``), which builds an
app with the UI mounted from the cairn-ui bundle.
"""

from __future__ import annotations

import pytest

from cairn import viewer

_DIST = viewer.dist_path()

pytestmark = pytest.mark.skipif(
    _DIST is None or not (_DIST / "plot.html").is_file(),
    reason="cairn-ui viewer not installed; skip the /plot shell route test",
)


def test_plot_route_serves_shell(ui_client):
    r = ui_client.get("/plot")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/html")
    # The plot entry's mount point — the standalone shell, NOT the SPA (which
    # mounts #root) and NOT the embed (#embed-root). Vite rewrites the module
    # `<script src>` to a hashed `assets/plot-*.js` chunk, so assert on that.
    assert "cairn-plot-root" in r.text
    assert "assets/plot-" in r.text


def test_plot_route_matches_committed_bytes(ui_client):
    # Served bytes are the committed dist/plot.html, read once at startup.
    assert ui_client.get("/plot").content == (_DIST / "plot.html").read_bytes()
