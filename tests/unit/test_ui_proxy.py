"""Local UI proxy: remote selection, auth, cookies, and byte fidelity."""

from __future__ import annotations

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from cairn.server.proxy import create_proxy_app


def _json(data: dict, status: int = 200, headers=None) -> httpx.Response:
    return httpx.Response(status, json=data, headers=headers)


def test_proxy_keeps_configured_token_server_side_and_serves_spa():
    seen: list[httpx.Request] = []

    async def upstream(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/api/auth/session":
            authenticated = "cairn_session=upstream" in request.headers.get("cookie", "")
            return _json({"authenticated": authenticated, "auth_enabled": True})
        if request.url.path == "/api/auth/login":
            assert json.loads((await request.aread()).decode()) == {"token": "secret"}
            return _json(
                {"name": "local-process", "role": "write"},
                headers={"set-cookie": "cairn_session=upstream; Path=/; HttpOnly"},
            )
        assert request.headers["authorization"] == "Bearer secret"
        assert request.headers.get("x-probe") == "yes"
        return _json({"ok": True})

    app = create_proxy_app(
        "http://fermat:4300",
        token="secret",
        transport=httpx.MockTransport(upstream),
    )
    with TestClient(app) as client:
        assert client.get("/").status_code == 200
        response = client.get(
            "/api/protected?x=1",
            headers={"authorization": "Bearer browser-must-not-win", "x-probe": "yes"},
        )
        assert response.json() == {"ok": True}
        assert client.post("/api/auth/logout").json() == {
            "ok": True,
            "auth_source": "CAIRN_TOKEN",
        }
        assert client.get("/api/auth/session").json()["authenticated"] is True
        rejected = client.post(
            "/api/protected",
            headers={"origin": "https://evil.example", "sec-fetch-site": "cross-site"},
        )
        assert rejected.status_code == 403
        assert client.get("/api/protected", headers={"host": "evil.example"}).status_code == 403
    protected = next(request for request in seen if request.url.path == "/api/protected")
    assert protected.url == "http://fermat:4300/api/protected?x=1"
    assert all(request.url.path != "/api/auth/logout" for request in seen)


def test_proxy_rejects_upstream_url_credentials():
    with pytest.raises(ValueError, match="must not contain credentials"):
        create_proxy_app("http://user:password@fermat:4300")


def test_proxy_browser_login_rebinds_cookie_and_logout():
    async def upstream(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/auth/login":
            assert json.loads((await request.aread()).decode()) == {"token": "pasted"}
            return _json(
                {"name": "user", "role": "write"},
                headers={
                    "set-cookie": (
                        "cairn_session=browser-session; Domain=fermat; "
                        "Path=/; Secure; HttpOnly; SameSite=lax"
                    )
                },
            )
        if request.url.path == "/api/auth/session":
            authenticated = "cairn_session=browser-session" in request.headers.get("cookie", "")
            return _json({"authenticated": authenticated, "auth_enabled": True})
        if request.url.path == "/api/auth/logout":
            return _json(
                {"ok": True},
                headers={
                    "set-cookie": (
                        "cairn_session=; Domain=fermat; Path=/; Secure; "
                        "Max-Age=0; HttpOnly"
                    )
                },
            )
        return _json({"detail": "not found"}, 404)

    app = create_proxy_app(
        "http://fermat:4300",
        transport=httpx.MockTransport(upstream),
    )
    with TestClient(app) as client:
        login = client.post("/api/auth/login", json={"token": "pasted"})
        assert login.status_code == 200
        cookie = login.headers["set-cookie"].lower()
        assert "domain=" not in cookie
        assert "; secure" not in cookie
        assert client.get("/api/auth/session").json()["authenticated"] is True
        client.cookies.clear()
        assert client.get("/api/auth/session").json()["authenticated"] is False
        # Log in again so logout's deletion-cookie behavior is exercised too.
        assert client.post("/api/auth/login", json={"token": "pasted"}).status_code == 200
        assert client.post("/api/auth/logout").status_code == 200
        assert client.get("/api/auth/session").json()["authenticated"] is False


def test_proxy_closes_upstream_stream_after_completion():
    state = {"closed": False}

    class Stream(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b"streamed"

        async def aclose(self):
            state["closed"] = True

    async def upstream(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, stream=Stream())

    app = create_proxy_app(
        "http://fermat:4300",
        transport=httpx.MockTransport(upstream),
    )
    with TestClient(app) as client:
        assert client.get("/api/stream").content == b"streamed"
    assert state["closed"] is True


def test_proxy_preserves_range_response_and_duplicate_cookies():
    payload = b"0123456789"

    async def upstream(request: httpx.Request) -> httpx.Response:
        assert request.headers["range"] == "bytes=2-5"
        assert "x-internal" not in request.headers
        return httpx.Response(
            206,
            content=payload[2:6],
            headers=[
                ("content-range", "bytes 2-5/10"),
                ("accept-ranges", "bytes"),
                ("content-length", "4"),
                ("connection", "x-upstream-internal"),
                ("x-upstream-internal", "must-not-leak"),
                ("set-cookie", "a=1; Path=/"),
                ("set-cookie", "b=2; Path=/"),
            ],
        )

    app = create_proxy_app(
        "http://fermat:4300",
        transport=httpx.MockTransport(upstream),
    )
    with TestClient(app) as client:
        response = client.get(
            "/api/artifacts/hash",
            headers={
                "range": "bytes=2-5",
                "connection": "x-internal",
                "x-internal": "must-not-leak",
            },
        )
    assert response.status_code == 206
    assert response.content == b"2345"
    assert response.headers["content-range"] == "bytes 2-5/10"
    assert response.headers["accept-ranges"] == "bytes"
    assert "x-upstream-internal" not in response.headers
    assert response.headers.get_list("set-cookie") == ["a=1; Path=/", "b=2; Path=/"]
