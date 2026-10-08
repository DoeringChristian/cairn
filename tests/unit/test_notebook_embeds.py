"""Notebook embeds of viewer pages (B7): `cairn.Run` / a Reader run display
their run page, `cairn.ui.workspace` / `cairn.ui.report`
(`vendor/cairn-ui/cairn_ui/cards/pages.py`), and the `/embed/{run,workspace,
report}` entries, read-gated like `/embed/card`."""

from __future__ import annotations

import json
import sys
from urllib.parse import parse_qs, urlsplit

import cairn_ui.cards.elements as elements_mod
import pytest
from cairn_ui.cards.elements import PageElement
from cairn_ui.cards.pages import run_page
from fastapi.testclient import TestClient

import cairn
import cairn.ui as cui
from cairn.server import auth as auth_core
from cairn.server.app import create_app
from cairn.server.ui_mount import FRAME_CSP

QUIET = {"capture_source": False, "capture_stdout": False, "capture_env": False,
         "capture_system_metrics": False}


@pytest.fixture
def no_viewer(monkeypatch):
    """Nothing reachable: no configured server, every probe fails."""
    monkeypatch.setattr(elements_mod._config, "resolve_target",
                        lambda repo=None: elements_mod._config.RunTarget("local", "/tmp/nope/.cairn"))
    monkeypatch.setattr(elements_mod.ServedElement, "_probe", staticmethod(lambda url: False))


def _src(html: str) -> str:
    start = html.index('src="') + 5
    return html[start:html.index('"', start)].replace("&amp;", "&")


# ---- the display objects -------------------------------------------------------


def test_run_page_path_tab_and_height():
    assert run_page("abc").path == "/embed/run/abc"
    assert run_page("abc", tab="overview").path == "/embed/run/abc?tab=overview"
    el = run_page("abc", tab="logs", height=500, server="http://h:1")
    html = el._repr_html_()
    assert _src(html) == "http://h:1/embed/run/abc?tab=logs"
    assert "height:500px" in html
    with pytest.raises(ValueError, match="unknown run page tab"):
        run_page("abc", tab="charts")


def test_workspace_filter_encoding():
    assert cui.workspace("my proj").path == "/embed/workspace/my%20proj"
    expr = 'run.group == "exp-44"'
    el = cui.workspace("p", filter=expr, height=600, server="http://h:1")
    src = _src(el._repr_html_())
    assert src.startswith("http://h:1/embed/workspace/p?")
    assert parse_qs(urlsplit(src).query)["filter"] == [expr]
    assert "height:600px" in el._repr_html_()
    tree = {"kind": "group", "op": "and", "children": [{"kind": "chip", "field": "group", "op": "exact", "arg": "exp-44"}]}
    src = _src(cui.workspace("p", filter=tree, server="http://h:1")._repr_html_())
    assert json.loads(parse_qs(urlsplit(src).query)["filter"][0]) == tree


def test_report_path_and_default_height():
    el = cui.report("p", "r 1", server="http://h:1")
    html = el._repr_html_()
    assert _src(html) == "http://h:1/embed/report/p/r%201"
    assert "height:720px" in html
    assert 'sandbox="allow-scripts allow-same-origin' in html
    assert repr(el) == "PageElement('/embed/report/p/r%201')"


def test_no_viewer_says_how_to_start_one(no_viewer):
    for el in (cui.workspace("p"), cui.report("p", "r"), run_page("abc", repo_path="/data/.cairn")):
        html = el._repr_html_()
        assert "<iframe" not in html and "no reachable cairn server" in html
        assert "cairn ui" in html
    assert "cairn ui --repo /data/.cairn" in run_page("abc", repo_path="/data/.cairn")._repr_html_()
    bundle, _ = cui.workspace("p")._repr_mimebundle_()
    assert "no reachable cairn server" in bundle["text/html"]
    assert cui.workspace("p")._mime_()[0] == "text/html"


# ---- a run displays its run page --------------------------------------------------


def test_live_and_reader_runs_display_their_run_page(live_server):
    with cairn.Run("p", name="train", repo=live_server, **QUIET) as run:
        html = run._repr_html_()
        assert _src(html) == f"{live_server}/embed/run/{run.id}"
        assert "height:720px" in html
        el = run.display(tab="overview", height=480)
        assert isinstance(el, PageElement)
        assert _src(el._repr_html_()) == f"{live_server}/embed/run/{run.id}?tab=overview"
        assert "height:480px" in el._repr_html_()
        bundle = run._repr_mimebundle_()
        assert bundle["text/html"] == html and "<iframe" not in bundle["text/plain"]
        assert isinstance(run._display_(), PageElement)
        # The terminal repr is untouched.
        assert "iframe" not in repr(run)

    reader = cairn.Reader(repo=live_server)
    try:
        r = reader.run(run.id)
        assert _src(r._repr_html_()) == f"{live_server}/embed/run/{run.id}"
        assert _src(r.display(tab="logs")._repr_html_()) == f"{live_server}/embed/run/{run.id}?tab=logs"
        assert repr(r) == "Run('train', status='completed', project='p')"
    finally:
        reader.close()


def test_local_run_without_a_viewer_renders_the_notice(tmp_path, request):
    with cairn.Run("p", name="train", repo=tmp_path / ".cairn", **QUIET) as run:
        request.getfixturevalue("no_viewer")  # after the run resolved its own repo
        html = run._repr_html_()
    assert "<iframe" not in html and "cairn ui --repo" in html and str(tmp_path / ".cairn") in html


def test_without_the_ui_extra_a_run_keeps_its_plain_repr(tmp_path, monkeypatch):
    monkeypatch.setitem(sys.modules, "cairn_ui.cards.pages", None)  # import fails
    with cairn.Run("p", name="train", repo=tmp_path / ".cairn", **QUIET) as run:
        assert run._repr_html_() is None
        assert run._repr_mimebundle_() is None
        assert run._display_() == repr(run)
        with pytest.raises(ImportError, match=r"cairn-track\[ui\]"):
            run.display()


def test_disabled_run_displays_nothing():
    run = cairn.Run("p", mode="disabled")
    assert run._repr_html_() is None and run._repr_mimebundle_() is None and run.display() is None
    run.finish()


# ---- the embed entries are gated like /embed/card -----------------------------------


@pytest.fixture
def gated(tmp_path, monkeypatch):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>app</title>")
    (dist / "embed.html").write_text("<!doctype html><title>card</title>")
    monkeypatch.setenv("CAIRN_UI_DIST", str(dist))
    app = create_app(data_dir=tmp_path / "cairn", mount_ui=True, auth_enabled=True)
    with TestClient(app) as c:
        _id, token = auth_core.create_token(app.state.db, name="reader", role="read")
        yield c, token


def test_embed_pages_are_gated_like_the_card_embed(gated):
    client, token = gated
    # The shells hold no data: served to anyone, as /embed/card (the app shell for the pages).
    assert "card" in client.get("/embed/card").text
    for path in ("/embed/run/abc", "/embed/run/abc/overview", "/embed/workspace/p", "/embed/report/p/r1"):
        r = client.get(path)
        assert r.status_code == 200 and "<title>app</title>" in r.text, path
        assert r.headers["content-security-policy"] == FRAME_CSP
    # Everything they read needs a session (read role), as the card embed's spec does.
    reads = ("/api/runs/abc", "/api/runs/abc/relations", "/api/projects/p/views", "/api/projects/p/reports/r1",
             "/api/embed/specs/deadbeefdeadbeef")
    for path in reads:
        assert client.get(path).status_code == 401, path
    cookie = {auth_core.auth_cookie_name(client.app.state.server_id): token}
    for path in reads:
        assert client.get(path, cookies=cookie).status_code != 401, path
