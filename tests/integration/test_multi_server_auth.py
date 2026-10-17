"""One user, several auth-enabled servers on one host, all logged in at once.

Browsers scope cookies by host, not port (RFC 6265): two servers on
``localhost:A`` and ``localhost:B`` see each other's cookies. Each server
names its cookies by its own server id, so logins (and redeemed share links)
never collide. On the SDK/CLI side, config.toml keeps one token per server.
"""

from __future__ import annotations

import socket
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import httpx
import pytest
import uvicorn

from cairn import config
from cairn.sdk.reader import Reader
from cairn.sdk.transport import Transport
from cairn.server import auth as auth_core
from cairn.server.app import create_app


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextmanager
def _serve(repo: Path) -> Iterator[tuple[str, object]]:
    """An auth-enabled server on a free loopback port: ``(base URL, app)``."""
    app = create_app(data_dir=repo, auth_enabled=True, token=str(repo))
    port = _free_port()
    server = uvicorn.Server(
        uvicorn.Config(app=app, host="127.0.0.1", port=port, log_level="warning", lifespan="on")
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 10
    while time.time() < deadline and not server.started:
        time.sleep(0.02)
    assert server.started, "uvicorn failed to start"
    try:
        # `localhost`, like the browser: the cookie jar's host is the same for
        # both servers, only the port differs.
        yield f"http://localhost:{port}", app
    finally:
        server.should_exit = True
        thread.join(timeout=10)


@pytest.fixture
def two_servers(tmp_path):
    with _serve(tmp_path / "a" / ".cairn") as a, _serve(tmp_path / "b" / ".cairn") as b:
        servers = []
        for url, app in (a, b):
            token = app.state.token
            servers.append({"url": url, "app": app, "token": token})
        yield servers


@pytest.fixture
def isolated_config(monkeypatch, tmp_path):
    monkeypatch.delenv("CAIRN_TOKEN", raising=False)
    monkeypatch.delenv("CAIRN_SERVER", raising=False)
    monkeypatch.delenv("CAIRN_REPO", raising=False)
    path = tmp_path / "config.toml"
    monkeypatch.setattr(config, "config_file_path", lambda: path)
    config.reset_configured()
    yield path
    config.reset_configured()


def _authenticated(browser: httpx.Client, url: str) -> bool:
    return browser.get(f"{url}/api/auth/session").json()["authenticated"]


def test_servers_have_distinct_stable_ids(two_servers, tmp_path):
    a, b = two_servers
    ids = [s["app"].state.server_id for s in (a, b)]
    assert ids[0] != ids[1]
    for s, sid in zip((a, b), ids):
        assert httpx.get(f"{s['url']}/api/health").json()["server_id"] == sid
    # Stable across restarts (and so across port changes): it lives in the repo.
    assert auth_core.server_id(tmp_path / "a" / ".cairn") == ids[0]


def test_one_browser_stays_logged_into_both(two_servers):
    a, b = two_servers
    with httpx.Client() as browser:  # one cookie jar = one browser profile
        for s in (a, b):
            r = browser.post(f"{s['url']}/api/auth/login", json={"token": s["token"]})
            assert r.status_code == 200, r.text
        # The jar is host-scoped like a browser's: both servers receive both
        # cookies, so a shared cookie name would have collided.
        names = {c.name for c in browser.cookies.jar}
        assert names == {
            auth_core.auth_cookie_name(a["app"].state.server_id),
            auth_core.auth_cookie_name(b["app"].state.server_id),
        }
        assert _authenticated(browser, a["url"]) and _authenticated(browser, b["url"])
        assert browser.get(f"{a['url']}/api/runs").status_code == 200
        assert browser.get(f"{b['url']}/api/runs").status_code == 200

        # Logging out of one leaves the other logged in.
        assert browser.post(f"{a['url']}/api/auth/logout").status_code == 200
        assert not _authenticated(browser, a["url"])
        assert browser.get(f"{a['url']}/api/runs").status_code == 401
        assert _authenticated(browser, b["url"])
        assert browser.get(f"{b['url']}/api/runs").status_code == 200








def test_sdk_and_cli_use_each_servers_own_token(two_servers, isolated_config):
    a, b = two_servers
    for s in (a, b):
        # Saved under the cairn:// spelling, resolved under http://.
        config.save_token(s["url"].replace("http://", "cairn://") + "/", s["token"])
    assert config.saved_tokens() == {a["url"]: a["token"], b["url"]: b["token"]}

    for s in (a, b):
        t = Transport(s["url"], max_retries=1)
        try:
            assert t.token == s["token"]
            assert t.get("/api/runs").status_code == 200
        finally:
            t.close()
        reader = Reader(repo=s["url"].replace("http://", "cairn://"))
        assert list(reader.runs()) == []  # authenticated: a 401 would raise

    from click.testing import CliRunner

    from cairn import cli

    for s in (a, b):
        result = CliRunner().invoke(cli.main, ["runs"], env={"CAIRN_SERVER": s["url"]})
        assert result.exit_code == 0, result.output

    # Forgetting one login keeps the other.
    config.save_token(a["url"], None)
    with pytest.raises(Exception, match="authentication required"):
        list(Reader(repo=a["url"]).runs())
    with pytest.raises(httpx.HTTPStatusError):
        Transport(a["url"], max_retries=1).get("/api/runs")
    assert Transport(b["url"], max_retries=1).get("/api/runs").status_code == 200


def test_cli_login_list_logout_against_two_servers(two_servers, isolated_config):
    from click.testing import CliRunner

    from cairn import cli

    a, b = two_servers
    runner = CliRunner()
    for s in (a, b):
        result = runner.invoke(cli.main, ["login", s["url"], "--token", s["token"]])
        assert result.exit_code == 0, result.output
    assert set(config.saved_tokens()) == {a["url"], b["url"]}

    bad = runner.invoke(cli.main, ["login", b["url"], "--token", "wrong"])
    assert bad.exit_code != 0 and "rejected" in bad.output
    assert config.saved_tokens()[b["url"]] == b["token"]

    result = runner.invoke(cli.main, ["logout", a["url"]])
    assert result.exit_code == 0, result.output
    assert set(config.saved_tokens()) == {b["url"]}
    assert runner.invoke(cli.main, ["logout", a["url"]]).exit_code == 0
