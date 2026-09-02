"""Local SPA + same-origin proxy for a remote Cairn server.

The browser loads Cairn from loopback (a WebGPU secure context) and talks only
relative ``/api/*`` URLs. This app streams those requests to the selected
remote server, keeping CORS and remote credentials out of browser configuration.
"""

from __future__ import annotations

import re
from contextlib import asynccontextmanager
from typing import AsyncIterator
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

from .app import _mount_spa_or_placeholder

_HOP_BY_HOP = {
    b"connection",
    b"keep-alive",
    b"proxy-authenticate",
    b"proxy-authorization",
    b"te",
    b"trailer",
    b"transfer-encoding",
    b"upgrade",
    b"proxy-connection",
}
_REQUEST_DROP = _HOP_BY_HOP | {b"host", b"content-length"}
_RESPONSE_DROP = _HOP_BY_HOP


def _connection_fields(headers: list[tuple[bytes, bytes]]) -> set[bytes]:
    nominated: set[bytes] = set()
    for name, value in headers:
        if name.lower() in {b"connection", b"proxy-connection"}:
            nominated.update(part.strip().lower() for part in value.split(b",") if part.strip())
    return nominated


def _request_headers(request: Request, *, token: str | None) -> list[tuple[bytes, bytes]]:
    raw = list(request.headers.raw)
    drop = _REQUEST_DROP | _connection_fields(raw)
    headers = [
        (name, value)
        for name, value in raw
        if name.lower() not in drop
        # A configured server-side token owns authentication. Do not let a
        # browser override it or replace the proxy's upstream session cookie.
        and not (token is not None and name.lower() in {b"authorization", b"cookie"})
    ]
    if token is not None:
        headers.append((b"authorization", f"Bearer {token}".encode("ascii")))
    elif not any(name.lower() == b"cookie" for name, _ in headers):
        # Explicitly suppress the shared HTTPX cookie jar: browser-mode auth
        # must be carried only by this browser request's local cookie.
        headers.append((b"cookie", b""))
    return headers


def _local_cookie(value: bytes) -> bytes:
    """Rebind an upstream cookie to the loopback HTTP origin."""
    text = value.decode("latin-1")
    text = re.sub(r";\s*Domain=[^;]*", "", text, flags=re.IGNORECASE)
    # The local UI is intentionally http://localhost, which browsers treat as
    # a secure context. A remote Secure cookie would otherwise be discarded.
    text = re.sub(r";\s*Secure(?=;|$)", "", text, flags=re.IGNORECASE)
    return text.encode("latin-1")


def _response_headers(
    response: httpx.Response,
    *,
    upstream: str,
    local_origin: str,
) -> list[tuple[bytes, bytes]]:
    result: list[tuple[bytes, bytes]] = []
    raw = list(response.headers.raw)
    drop = _RESPONSE_DROP | _connection_fields(raw)
    for name, value in raw:
        lower = name.lower()
        if lower in drop:
            continue
        if lower == b"set-cookie":
            value = _local_cookie(value)
        elif lower == b"location":
            location = value.decode("latin-1")
            if location.startswith(upstream):
                value = (local_origin + location[len(upstream) :]).encode("latin-1")
        result.append((name, value))
    return result


async def _response_body(response: httpx.Response) -> AsyncIterator[bytes]:
    # Real network responses remain streaming. Mock/in-process transports may
    # return an already-materialized response even when send(stream=True) was
    # requested; retain byte fidelity in both cases. The finally closes the
    # upstream stream even when the browser disconnects or iteration raises.
    try:
        if response.is_stream_consumed:
            yield response.content
            return
        async for chunk in response.aiter_raw():
            yield chunk
    finally:
        await response.aclose()


def create_proxy_app(
    upstream_url: str,
    *,
    token: str | None = None,
    disable_webgpu: bool = False,
    transport: httpx.AsyncBaseTransport | None = None,
) -> FastAPI:
    """Serve the bundled UI locally and stream its API calls to ``upstream``.

    ``token`` remains server-side. When absent, browser login is proxied
    unchanged and the upstream session cookie is rebound to the local origin.
    ``transport`` is an injection seam for protocol tests.
    """
    upstream = upstream_url.rstrip("/")
    parsed_upstream = urlsplit(upstream)
    if parsed_upstream.scheme not in {"http", "https"} or not parsed_upstream.hostname:
        raise ValueError("remote Cairn URL must be an absolute http(s) URL")
    if parsed_upstream.username is not None or parsed_upstream.password is not None:
        raise ValueError("remote Cairn URL must not contain credentials; use CAIRN_TOKEN")

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        client = httpx.AsyncClient(
            base_url=upstream,
            timeout=None,
            follow_redirects=False,
            transport=transport,
        )
        app.state.proxy_client = client
        try:
            if token is not None:
                try:
                    session = await client.get("/api/auth/session")
                    session.raise_for_status()
                    state = session.json()
                    if state.get("auth_enabled", True):
                        login = await client.post("/api/auth/login", json={"token": token})
                        if login.status_code != 200:
                            raise RuntimeError(
                                f"remote Cairn rejected CAIRN_TOKEN (HTTP {login.status_code})"
                            )
                except (httpx.HTTPError, ValueError) as exc:
                    raise RuntimeError(f"cannot authenticate with remote Cairn at {upstream}: {exc}") from exc
            yield
        finally:
            await client.aclose()

    app = FastAPI(title="Cairn local UI proxy", lifespan=lifespan)

    def _same_origin(request: Request) -> bool:
        host = urlsplit(f"//{request.headers.get('host', '')}").hostname
        allowed_hosts = {"localhost", "127.0.0.1", "::1"}
        if transport is not None:  # injected test transports use TestClient's host
            allowed_hosts.add("testserver")
        if host not in allowed_hosts:
            return False
        if request.headers.get("sec-fetch-site", "").lower() == "cross-site":
            return False
        origin = request.headers.get("origin")
        if origin is None:
            return True
        parsed = urlsplit(origin)
        return parsed.scheme == request.url.scheme and parsed.netloc == request.url.netloc

    if token is not None:
        @app.post("/api/auth/logout")
        async def configured_token_logout(request: Request):
            if not _same_origin(request):
                return JSONResponse({"detail": "cross-origin proxy request rejected"}, status_code=403)
            # CAIRN_TOKEN is process-level authority. Do not delete the shared
            # upstream session and strand the UI in a half-authenticated state.
            return JSONResponse({"ok": True, "auth_source": "CAIRN_TOKEN"})

    @app.api_route(
        "/api/{path:path}",
        methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    )
    async def proxy_api(path: str, request: Request):
        if not _same_origin(request):
            return JSONResponse({"detail": "cross-origin proxy request rejected"}, status_code=403)
        client: httpx.AsyncClient = request.app.state.proxy_client
        query = request.url.query
        target = f"/api/{path}" + (f"?{query}" if query else "")
        upstream_request = client.build_request(
            request.method,
            target,
            headers=_request_headers(request, token=token),
            content=None if request.method in {"GET", "HEAD"} else request.stream(),
        )
        try:
            upstream_response = await client.send(upstream_request, stream=True)
            if token is None:
                # Browser-mode sessions belong to the browser cookie, not this
                # process-wide AsyncClient. Otherwise one browser login would
                # silently authenticate every local browser profile.
                client.cookies.clear()
        except httpx.HTTPError as exc:
            return JSONResponse(
                {"detail": f"remote Cairn is unavailable: {exc}"},
                status_code=502,
            )

        local_origin = f"{request.url.scheme}://{request.url.netloc}"
        response = StreamingResponse(
            _response_body(upstream_response),
            status_code=upstream_response.status_code,
        )
        # Preserve duplicate Set-Cookie and byte-exact range/content headers.
        response.raw_headers = _response_headers(
            upstream_response,
            upstream=upstream,
            local_origin=local_origin,
        )
        return response

    # Register the API catch-all before the SPA fallback.
    _mount_spa_or_placeholder(app, disable_webgpu=disable_webgpu)
    return app
