"""Auth routes: login (token or one-time otp), logout, session.

Entire ``/api/auth/*`` prefix is EXEMPT from the ``require_role`` dependency
family (see ``app.py`` registration) — you can't require auth to log in.
Each handler does its own (optional) session lookup where relevant.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from .. import auth
from ._common import get_db

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _set_session_cookie(response: Response, session_id: str) -> None:
    response.set_cookie(
        key=auth.SESSION_COOKIE,
        value=session_id,
        httponly=True,
        samesite="lax",
        # No `secure=True`: this app makes no TLS assumption (document
        # terminating TLS at a reverse proxy for internet-facing deployments).
        secure=False,
        max_age=auth.SESSION_TTL_SECONDS,
        path="/",
    )


# ---------------------------------------------------------------------------
# Token login / OTP exchange / logout / session
# ---------------------------------------------------------------------------


class LoginRequest(BaseModel):
    token: str


@router.post("/login")
def login(body: LoginRequest, request: Request, response: Response) -> dict[str, Any]:
    db = get_db(request)
    principal = auth.verify_bearer_token(db, body.token)
    if principal is None:
        raise HTTPException(status_code=401, detail="invalid token")
    session_id = auth.create_session(db, principal.token_id)
    _set_session_cookie(response, session_id)
    return {"name": principal.name, "role": principal.role}


class OtpRequest(BaseModel):
    otp: str


@router.post("/otp")
def exchange_otp(body: OtpRequest, request: Request, response: Response) -> dict[str, Any]:
    """Exchange a one-time login-URL OTP for a session cookie. Single-use —
    the otp is consumed (deleted) whether or not it turns out to be valid."""
    db = get_db(request)
    principal = auth.consume_otp(db, body.otp)
    if principal is None:
        raise HTTPException(status_code=401, detail="invalid or expired login link")
    session_id = auth.create_session(db, principal.token_id)
    _set_session_cookie(response, session_id)
    return {"name": principal.name, "role": principal.role}


@router.post("/logout")
def logout(request: Request, response: Response) -> dict[str, Any]:
    db = get_db(request)
    session_id = request.cookies.get(auth.SESSION_COOKIE)
    if session_id:
        auth.delete_session(db, session_id)
    response.delete_cookie(auth.SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/session")
def session_info(request: Request) -> dict[str, Any]:
    """Who-am-I check used by the UI to decide whether to show the login
    page. Always 200 (never 401) — absence of a session is a normal state,
    not an error."""
    if not getattr(request.app.state, "auth_enabled", False):
        return {"authenticated": True, "auth_enabled": False, "name": None, "role": "admin"}
    db = get_db(request)
    session_id = request.cookies.get(auth.SESSION_COOKIE)
    if session_id:
        principal = auth.verify_session(db, session_id)
        if principal is not None:
            return {
                "authenticated": True,
                "auth_enabled": True,
                "name": principal.name,
                "role": principal.role,
            }
    return {"authenticated": False, "auth_enabled": True, "name": None, "role": None}
