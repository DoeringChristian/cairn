"""Auth: tokens, sessions, OTP, WS gating, role enforcement."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from cairn.server import auth as auth_core
from cairn.server.app import create_app
from cairn.server.storage.datadir import DataDir
from cairn.server.storage.db import Database


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def auth_env(tmp_path):
    """An auth-enabled app + a TestClient + one token per role."""
    app = create_app(data_dir=tmp_path / "cairn", auth_enabled=True)
    with TestClient(app) as c:
        db = app.state.db
        tokens = {}
        for role in ("admin", "write", "read"):
            _id, plain = auth_core.create_token(db, name=f"{role}-token", role=role)
            tokens[role] = plain
        yield app, c, tokens


@pytest.fixture
def noauth_env(tmp_path):
    app = create_app(data_dir=tmp_path / "cairn")  # auth_enabled defaults False
    with TestClient(app) as c:
        yield app, c


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Token hashing / CRUD
# ---------------------------------------------------------------------------


def test_token_plaintext_never_persisted(auth_env):
    app, _c, tokens = auth_env
    db = app.state.db
    rows = db.read_columns("SELECT token_hash FROM tokens")
    hashes = {r["token_hash"] for r in rows}
    for plain in tokens.values():
        assert plain not in hashes
        assert auth_core.hash_secret(plain) in hashes


def test_verify_bearer_token_round_trip(auth_env):
    app, _c, tokens = auth_env
    db = app.state.db
    principal = auth_core.verify_bearer_token(db, tokens["read"])
    assert principal is not None
    assert principal.role == "read"

    assert auth_core.verify_bearer_token(db, "not-a-real-token") is None
    assert auth_core.verify_bearer_token(db, "") is None


def test_disabled_token_rejected(auth_env):
    app, _c, tokens = auth_env
    db = app.state.db
    assert auth_core.revoke_token(db, "read-token") is True
    assert auth_core.verify_bearer_token(db, tokens["read"]) is None
    # revoking an unknown name/id is a clean no-op signal, not an exception
    assert auth_core.revoke_token(db, "does-not-exist") is False


def test_expired_token_rejected(tmp_path):
    dd = DataDir(tmp_path / "cairn")
    db = Database.open(dd.db_path)
    try:
        past = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
        _id, plain = auth_core.create_token(db, name="stale", role="read", expires_at=past)
        assert auth_core.verify_bearer_token(db, plain) is None
    finally:
        db.close()


def test_revoke_drops_live_sessions(auth_env):
    app, _c, tokens = auth_env
    db = app.state.db
    principal = auth_core.verify_bearer_token(db, tokens["write"])
    session_id = auth_core.create_session(db, principal.token_id)
    assert auth_core.verify_session(db, session_id) is not None
    auth_core.revoke_token(db, "write-token")
    assert auth_core.verify_session(db, session_id) is None


# ---------------------------------------------------------------------------
# Route-level 401 / 403 matrix
# ---------------------------------------------------------------------------


def test_health_exempt_without_credentials(auth_env):
    _app, c, _tokens = auth_env
    resp = c.get("/api/health")
    assert resp.status_code == 200


def test_read_route_401_without_credentials(auth_env):
    _app, c, _tokens = auth_env
    resp = c.get("/api/projects")
    assert resp.status_code == 401


def test_read_route_401_with_garbage_bearer(auth_env):
    _app, c, _tokens = auth_env
    resp = c.get("/api/projects", headers=_bearer("garbage"))
    assert resp.status_code == 401


def test_read_route_200_with_read_token(auth_env):
    _app, c, tokens = auth_env
    resp = c.get("/api/projects", headers=_bearer(tokens["read"]))
    assert resp.status_code == 200


def test_write_route_403_for_read_token(auth_env):
    _app, c, tokens = auth_env
    resp = c.post("/api/projects", json={"name": "demo"}, headers=_bearer(tokens["read"]))
    assert resp.status_code == 403


def test_write_route_200_for_write_token(auth_env):
    _app, c, tokens = auth_env
    resp = c.post("/api/projects", json={"name": "demo"}, headers=_bearer(tokens["write"]))
    assert resp.status_code == 200


def test_write_route_200_for_admin_token(auth_env):
    """Role hierarchy: admin satisfies a write-role requirement."""
    _app, c, tokens = auth_env
    resp = c.post("/api/projects", json={"name": "demo2"}, headers=_bearer(tokens["admin"]))
    assert resp.status_code == 200


def test_ingest_route_requires_write(auth_env):
    _app, c, tokens = auth_env
    resp = c.post("/api/runs", json={"project": "p"}, headers=_bearer(tokens["read"]))
    assert resp.status_code == 403
    resp = c.post("/api/runs", json={"project": "p"}, headers=_bearer(tokens["write"]))
    assert resp.status_code == 200


def test_resolve_artifact_ref_stays_read_despite_post(auth_env):
    """POST /resolve-artifact-ref is a read/resolve op — no write override."""
    _app, c, tokens = auth_env
    c.post("/api/projects", json={"name": "p"}, headers=_bearer(tokens["write"]))
    resp = c.post(
        "/api/projects/p/resolve-artifact-ref",
        json={"ref": "family:latest"},
        headers=_bearer(tokens["read"]),
    )
    # Not found (no such family) is fine — the point is it's not a 401/403.
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# SPA catch-all must not leak /api
# ---------------------------------------------------------------------------


def test_unknown_api_path_404s_not_spa(auth_env):
    _app, c, _tokens = auth_env
    resp = c.get("/api/this-route-does-not-exist")
    assert resp.status_code == 404
    assert "text/html" not in resp.headers.get("content-type", "")


# ---------------------------------------------------------------------------
# Session lifecycle (cookie login/logout)
# ---------------------------------------------------------------------------


def test_login_sets_httponly_cookie_and_grants_access(auth_env):
    _app, c, tokens = auth_env
    resp = c.post("/api/auth/login", json={"token": tokens["write"]})
    assert resp.status_code == 200
    assert resp.json()["role"] == "write"
    set_cookie = resp.headers.get("set-cookie", "")
    assert "httponly" in set_cookie.lower()
    assert "samesite=lax" in set_cookie.lower()

    # TestClient persists cookies across requests automatically.
    resp2 = c.get("/api/auth/session")
    assert resp2.json()["authenticated"] is True
    assert resp2.json()["role"] == "write"

    resp3 = c.post("/api/projects", json={"name": "via-cookie"})
    assert resp3.status_code == 200


def test_login_invalid_token_401(auth_env):
    _app, c, _tokens = auth_env
    resp = c.post("/api/auth/login", json={"token": "nope"})
    assert resp.status_code == 401


def test_logout_clears_session(auth_env):
    _app, c, tokens = auth_env
    c.post("/api/auth/login", json={"token": tokens["read"]})
    assert c.get("/api/auth/session").json()["authenticated"] is True
    resp = c.post("/api/auth/logout")
    assert resp.status_code == 200
    assert c.get("/api/auth/session").json()["authenticated"] is False
    assert c.get("/api/projects").status_code == 401


def test_session_endpoint_reports_disabled_when_auth_off(noauth_env):
    _app, c = noauth_env
    resp = c.get("/api/auth/session")
    body = resp.json()
    assert body["authenticated"] is True
    assert body["auth_enabled"] is False


# ---------------------------------------------------------------------------
# OTP: single-use, short-lived
# ---------------------------------------------------------------------------


def test_otp_exchange_and_single_use(auth_env):
    app, c, tokens = auth_env
    db = app.state.db
    principal = auth_core.verify_bearer_token(db, tokens["admin"])
    otp = auth_core.create_otp(db, principal.token_id)

    resp = c.post("/api/auth/otp", json={"otp": otp})
    assert resp.status_code == 200
    assert resp.json()["role"] == "admin"

    # Second use of the same OTP must fail — single-use.
    c.cookies.clear()
    resp2 = c.post("/api/auth/otp", json={"otp": otp})
    assert resp2.status_code == 401


def test_otp_expired_rejected(tmp_path):
    dd = DataDir(tmp_path / "cairn")
    db = Database.open(dd.db_path)
    try:
        token_id, _plain = auth_core.create_token(db, name="t", role="read")
        otp = auth_core.create_otp(db, token_id)
        # Force-expire it directly.
        db.write(
            "UPDATE auth_otp SET expires_at = ? WHERE otp_hash = ?",
            [(datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat(), auth_core.hash_secret(otp)],
        )
        assert auth_core.consume_otp(db, otp) is None
    finally:
        db.close()


def test_bootstrap_if_needed_is_idempotent(tmp_path):
    dd = DataDir(tmp_path / "cairn")
    db = Database.open(dd.db_path)
    try:
        first = auth_core.bootstrap_if_needed(db)
        assert first is not None
        second = auth_core.bootstrap_if_needed(db)
        assert second is None
    finally:
        db.close()


# ---------------------------------------------------------------------------
# WebSocket: auth before accept()
# ---------------------------------------------------------------------------


def test_plugin_ws_closes_4401_without_cookie(auth_env):
    _app, c, _tokens = auth_env
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with c.websocket_connect("/ws/plugin/run123/some_metric"):
            pass
    assert exc_info.value.code == 4401


def test_plugin_ws_accepts_with_valid_session(auth_env):
    _app, c, tokens = auth_env
    c.post("/api/auth/login", json={"token": tokens["read"]})
    # A valid session should get past the auth gate and accept(); the
    # connection then waits for a "render" message we never send, so just
    # prove we didn't get slammed with 4401 immediately.
    with c.websocket_connect("/ws/plugin/run123/some_metric") as ws:
        ws.close()


def test_plugin_ws_open_when_auth_disabled(noauth_env):
    _app, c = noauth_env
    with c.websocket_connect("/ws/plugin/run123/some_metric") as ws:
        ws.close()


# ---------------------------------------------------------------------------
# --no-auth parity
# ---------------------------------------------------------------------------


def test_noauth_mode_has_no_gate(noauth_env):
    _app, c = noauth_env
    resp = c.post("/api/projects", json={"name": "p"})
    assert resp.status_code == 200
    resp2 = c.get("/api/projects")
    assert resp2.status_code == 200


def test_cors_same_origin_when_auth_enabled(tmp_path):
    app = create_app(data_dir=tmp_path / "cairn", auth_enabled=True)
    cors = next(
        m for m in app.user_middleware if m.cls.__name__ == "CORSMiddleware"
    )
    assert cors.kwargs["allow_origins"] == []


def test_cors_wildcard_when_auth_disabled(tmp_path):
    app = create_app(data_dir=tmp_path / "cairn")
    cors = next(
        m for m in app.user_middleware if m.cls.__name__ == "CORSMiddleware"
    )
    assert cors.kwargs["allow_origins"] == ["*"]

