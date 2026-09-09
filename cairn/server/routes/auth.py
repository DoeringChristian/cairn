"""Auth routes: login (token or one-time otp), logout, session, SSH login.

Entire ``/api/auth/*`` prefix is EXEMPT from the ``require_role`` dependency
family (see ``app.py`` registration) — you can't require auth to log in.
Each handler resolves the caller itself where relevant.

There are no sessions: logging in means putting a *token* in the HttpOnly
``cairn_token`` cookie, and logging out means deleting that cookie. ``/login``
stores the token the user pasted; ``/otp`` and ``/ssh/verify`` mint a fresh
per-browser token first, because a plaintext is never stored and neither an OTP
nor a public key can recover one.
"""

from __future__ import annotations

import secrets
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from .. import auth
from ..storage.db import Database
from ._common import get_data_dir, get_db

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _set_auth_cookie(response: Response, db: Database, token_id: str, plaintext: str) -> None:
    """Log a browser in by handing it the token itself.

    ``HttpOnly`` keeps it away from page scripts; the cookie lives exactly as
    long as the token does, so there is no idle expiry and no renewal write.
    """
    response.set_cookie(
        key=auth.AUTH_COOKIE,
        value=plaintext,
        httponly=True,
        samesite="lax",
        # No `secure=True`: this app makes no TLS assumption (document
        # terminating TLS at a reverse proxy for internet-facing deployments).
        secure=False,
        max_age=auth.cookie_max_age(db, token_id),
        path="/",
    )


def _unique_token_name(db: Database, base: str) -> str:
    """``base``, or ``base-2``/``base-3``/… if that name is taken.

    ``tokens.name`` is UNIQUE, and both minting routes have already consumed a
    single-use credential by the time they insert — a collision must not turn
    into a 500 that also burns the OTP or nonce.
    """
    name = base
    suffix = 1
    while db.read_columns("SELECT id FROM tokens WHERE name = ?", [name]):
        suffix += 1
        name = f"{base}-{suffix}"
    return name


def _mint_browser_token(db: Database, principal: auth.Principal) -> tuple[str, str]:
    """Mint a per-browser token mirroring ``principal``'s role and expiry.

    The OTP and SSH login paths only know a token *id* or a public key, and a
    plaintext is never stored, so there is nothing to put in the cookie — a
    fresh token is the only option. Each one shows up in ``cairn token list``
    and is the revocation handle for that browser.

    The parent's ``expires_at`` is inherited (``None`` stays ``None``): a
    short-lived ``--expires`` token must not be laundered into an unlimited
    browser credential by visiting its login URL.
    """
    parent = auth.get_token(db, principal.token_id)
    name = _unique_token_name(db, f"{principal.name}-browser-{secrets.token_hex(8)}")
    return auth.create_token(
        db,
        name=name,
        role=principal.role,
        expires_at=parent["expires_at"] if parent else None,
    )


# ---------------------------------------------------------------------------
# Token login / OTP exchange / logout / session
# ---------------------------------------------------------------------------


class LoginRequest(BaseModel):
    # Bounded so an oversized body is refused before it is hashed. Tokens are
    # 43 characters (`secrets.token_urlsafe(32)`); the ceiling is generous.
    token: str = Field(max_length=512)


@router.post("/login")
def login(body: LoginRequest, request: Request, response: Response) -> dict[str, Any]:
    """Store a pasted token in the browser's cookie. No new credential is
    created — the cookie holds the very token the user supplied, so revoking
    that token logs this browser out too."""
    db = get_db(request)
    principal = auth.verify_token(db, body.token)
    if principal is None:
        raise HTTPException(status_code=401, detail="invalid token")
    _set_auth_cookie(response, db, principal.token_id, body.token)
    return {"name": principal.name, "role": principal.role}


class OtpRequest(BaseModel):
    otp: str


@router.post("/otp")
def exchange_otp(body: OtpRequest, request: Request, response: Response) -> dict[str, Any]:
    """Exchange a one-time login-URL OTP for a per-browser token cookie.
    Single-use — the otp is consumed (deleted) whether or not it turns out to
    be valid."""
    db = get_db(request)
    principal = auth.consume_otp(db, body.otp)
    if principal is None:
        raise HTTPException(status_code=401, detail="invalid or expired login link")
    token_id, plaintext = _mint_browser_token(db, principal)
    _set_auth_cookie(response, db, token_id, plaintext)
    return {"name": principal.name, "role": principal.role}


@router.post("/logout")
def logout(response: Response) -> dict[str, Any]:
    """Clear this browser's cookie and nothing else. The token itself stays
    valid everywhere it is used; ``cairn token revoke`` ends all access."""
    response.delete_cookie(auth.AUTH_COOKIE, path="/")
    return {"ok": True}


@router.get("/session")
def session_info(request: Request) -> dict[str, Any]:
    """Who-am-I check used by the UI to decide whether to show the login
    page. Always 200 (never 401) — an unauthenticated caller is a normal
    state, not an error. Resolves either carrier."""
    if not getattr(request.app.state, "auth_enabled", False):
        return {"authenticated": True, "auth_enabled": False, "name": None, "role": "admin"}
    principal = auth.principal_from_request(request)
    if principal is not None:
        return {
            "authenticated": True,
            "auth_enabled": True,
            "name": principal.name,
            "role": principal.role,
        }
    return {"authenticated": False, "auth_enabled": True, "name": None, "role": None}


# ---------------------------------------------------------------------------
# SSH login: GET challenge -> client signs with ssh-keygen -Y sign -> POST verify
# ---------------------------------------------------------------------------


@router.get("/ssh/challenge")
def ssh_challenge(request: Request) -> dict[str, str]:
    db = get_db(request)
    # Server-generated namespace: binds the signature to this login context
    # so it can't be replayed against a different verifier/protocol.
    namespace = f"cairn-login-{secrets.token_hex(8)}"
    nonce = auth.create_nonce(db, namespace)
    return {"nonce": nonce, "namespace": namespace}


class SSHVerifyRequest(BaseModel):
    nonce: str
    namespace: str
    pubkey: str
    signature: str
    name: str | None = None


@router.post("/ssh/verify")
def ssh_verify(body: SSHVerifyRequest, request: Request, response: Response) -> dict[str, Any]:
    db = get_db(request)
    dd = get_data_dir(request)

    ssh_keygen = shutil.which("ssh-keygen")
    if ssh_keygen is None:
        raise HTTPException(status_code=501, detail="ssh-keygen not available on server")

    # Single-use + namespace-bound: consumed regardless of outcome below.
    if not auth.consume_nonce(db, body.nonce, body.namespace):
        raise HTTPException(status_code=401, detail="invalid, expired, or already-used challenge")

    parsed = auth.parse_authorized_key_line(body.pubkey)
    if parsed is None:
        raise HTTPException(status_code=400, detail="unrecognized public key format")
    keytype, keyblob, _client_comment = parsed

    entry = auth.find_authorized_key(dd, keytype, keyblob)
    if entry is None:
        raise HTTPException(status_code=401, detail="key not authorized")
    role = entry["role"]

    identity = "cairn-login"
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        message_path = tmp_path / "message"
        message_path.write_text(body.nonce)
        sig_path = tmp_path / "message.sig"
        sig_path.write_text(body.signature)
        allowed_signers_path = tmp_path / "allowed_signers"
        allowed_signers_path.write_text(f"{identity} {keytype} {keyblob}\n")

        proc = subprocess.run(
            [
                ssh_keygen, "-Y", "verify",
                "-f", str(allowed_signers_path),
                "-I", identity,
                "-n", body.namespace,
                "-s", str(sig_path),
            ],
            input=message_path.read_bytes(),
            capture_output=True,
            timeout=10,
        )
    if proc.returncode != 0:
        raise HTTPException(status_code=401, detail="signature verification failed")

    name = (body.name or f"ssh-{secrets.token_hex(4)}").strip() or f"ssh-{secrets.token_hex(4)}"
    name = _unique_token_name(db, name)

    token_id, plaintext = auth.create_token(db, name=name, role=role)
    # The CLI reads the plaintext from the body; a browser doing the same call
    # is logged straight in with the token it just minted.
    _set_auth_cookie(response, db, token_id, plaintext)
    return {"token": plaintext, "name": name, "role": role}
