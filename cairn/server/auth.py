"""Authentication core: tokens, one-time login, SSH nonces.

Design (see ``.superpowers/sdd/spec-auth.md`` and
``docs/superpowers/specs/2026-09-09-token-only-auth-design.md``):

* Tokens are the foundation, and the *only* credential. Roles are coarse and
  hierarchical: ``read`` < ``write`` < ``admin``. Plaintext tokens are shown
  exactly once, at creation; only their sha256 hex digest is ever persisted.
* One credential, two carriers, one read: a request presents the token either
  as ``Authorization: Bearer <token>`` (SDK/CLI) or as the HttpOnly cookie
  ``cairn_token=<token>`` (browser). The header wins when both are sent. Both
  carriers resolve through :func:`verify_token`. There are no sessions.
* **Resolving a request never writes.** Authentication is a pure read: hash,
  look up, ``compare_digest``, check ``disabled``/``expires_at``. Nothing is
  touched on the request path — no sliding session expiry, no ``last_used_at``
  bookkeeping (the column stays in the schema but is never written). Every
  write is an fsync on the single shared connection, so a write here would tax
  every authenticated request.
* Only the credential-*minting* paths write: ``create_token``, ``create_otp``,
  ``create_nonce``, and the single-use consumption of an OTP/nonce.
* Every secret lookup follows the same pattern: hash the presented secret,
  look it up by exact hash match, then re-verify with
  ``secrets.compare_digest`` before trusting the row — defense in depth
  against any future change to the lookup query (e.g. a collation quirk)
  and against subtle timing side-channels.
* A report share link is a third, much narrower credential: the HttpOnly
  ``cairn_share`` cookie holds the link's secret and resolves to a
  :class:`ShareGrant`. It is default-deny — :func:`require_role` lets it
  through only on the GET routes in :data:`SHARE_ALLOWED` whose checker passes
  against the report's live scope (``report_scope.py``).
* OTPs and SSH login nonces are single-use: consumption happens by
  deleting the row *inside* the same locked transaction that reads it
  (``Database.transaction()`` serializes via the DB's internal RLock), so
  there is no read-then-delete TOCTOU window.
"""

from __future__ import annotations

import hashlib
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from fastapi import HTTPException, Request

from .report_scope import ShareScope
from .storage.datadir import DataDir
from .storage.db import Database

# ---------------------------------------------------------------------------
# Roles
# ---------------------------------------------------------------------------

ROLE_RANK: dict[str, int] = {"read": 0, "write": 1, "admin": 2}
ROLES = tuple(ROLE_RANK)

# The browser carries the token itself in this HttpOnly cookie.
AUTH_COOKIE = "cairn_token"
# A redeemed share link: the link's secret, in its own HttpOnly cookie.
SHARE_COOKIE = "cairn_share"
# The pseudo-role of a share principal. Deliberately not in ROLE_RANK: nothing
# may rank it, so only the share branch of ``require_role`` ever admits it.
SHARE_ROLE = "share"
# Fallback cookie lifetime for a token with no ``expires_at`` (~13 months;
# the practical ceiling browsers apply to a cookie's Max-Age).
DEFAULT_COOKIE_MAX_AGE = 400 * 86400
OTP_TTL_MINUTES = 15
NONCE_TTL_MINUTES = 5


@dataclass(frozen=True)
class ShareGrant:
    """What a redeemed share link grants: read access to one report."""

    share_id: str
    report_id: str
    project_id: str
    expires_at: str


@dataclass(frozen=True)
class Principal:
    """The authenticated identity behind a request: a token (from either
    carrier), or a share link (``share`` set, ``role`` is ``SHARE_ROLE``)."""

    token_id: str
    name: str
    role: str
    share: ShareGrant | None = None


# ---------------------------------------------------------------------------
# Time / hashing helpers
# ---------------------------------------------------------------------------


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _iso_in(seconds: int) -> str:
    return (_now() + timedelta(seconds=seconds)).isoformat()


def hash_secret(raw: str) -> str:
    """sha256 hex digest — the only form of a token/otp/nonce ever stored."""
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def generate_secret(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def secrets_equal(a: str, b: str) -> bool:
    """Constant-time compare, used to re-verify every hash/DB lookup."""
    return secrets.compare_digest(a, b)


# ---------------------------------------------------------------------------
# Tokens
# ---------------------------------------------------------------------------


def create_token(
    db: Database,
    *,
    name: str,
    role: str,
    expires_at: str | None = None,
    parent_id: str | None = None,
) -> tuple[str, str]:
    """Create a token row. Returns ``(token_id, plaintext)``.

    The plaintext is returned exactly once — callers must show it to the
    operator/user immediately and never log or persist it elsewhere.

    ``parent_id`` records that this token was *derived* from another one (a
    per-browser token minted from an OTP), so revoking the parent revokes it.
    """
    if role not in ROLE_RANK:
        raise ValueError(f"invalid role {role!r}; must be one of {ROLES}")
    token_id = secrets.token_hex(16)
    plaintext = generate_secret(32)
    db.write(
        """INSERT INTO tokens (id, name, token_hash, role, created_at,
                                last_used_at, expires_at, disabled, parent_id)
           VALUES (?, ?, ?, ?, ?, NULL, ?, 0, ?)""",
        [token_id, name, hash_secret(plaintext), role, _now_iso(), expires_at, parent_id],
    )
    return token_id, plaintext


_TOKEN_COLUMNS = "id, name, role, created_at, last_used_at, expires_at, disabled, parent_id"


def list_tokens(db: Database) -> list[dict[str, Any]]:
    return db.read_columns(f"SELECT {_TOKEN_COLUMNS} FROM tokens ORDER BY created_at")


def get_token(db: Database, ident: str) -> dict[str, Any] | None:
    """Look up a token by id OR name (both are unique)."""
    rows = db.read_columns(
        f"SELECT {_TOKEN_COLUMNS} FROM tokens WHERE id = ? OR name = ?",
        [ident, ident],
    )
    return rows[0] if rows else None


def revoke_token(db: Database, ident: str) -> bool:
    """Disable a token by id or name, together with every token derived from
    it. Returns False if no such token exists.

    Revocation is the only way to end all access, so it has to reach the
    per-browser tokens an OTP login minted from this one — otherwise a revoked
    credential would live on in every browser that used its login URL. The
    cascade runs one way: revoking a browser token leaves its parent, and the
    other browsers, alone.
    """
    row = get_token(db, ident)
    if row is None:
        return False
    with db.transaction() as con:
        cur = con.execute(
            "UPDATE tokens SET disabled = 1 WHERE id = ? OR parent_id = ?",
            [row["id"], row["id"]],
        )
        changed = cur.rowcount
    return changed > 0


def verify_token(db: Database, plaintext: str) -> Principal | None:
    """Resolve a presented token to its principal, or ``None``.

    Pure read — both carriers (``Authorization: Bearer`` and the
    ``cairn_token`` cookie) land here and nothing is written. ``last_used_at``
    is deliberately NOT touched: it would turn every authenticated request
    into an fsync on the shared connection.
    """
    if not plaintext:
        return None
    h = hash_secret(plaintext)
    row = db.read_one(
        "SELECT id, name, token_hash, role, expires_at, disabled FROM tokens "
        "WHERE token_hash = ?",
        [h],
    )
    if row is None:
        return None
    token_id, name, token_hash, role, expires_at, disabled = row
    if not secrets_equal(token_hash, h):
        return None
    if disabled:
        return None
    if expires_at and expires_at <= _now_iso():
        return None
    return Principal(token_id=token_id, name=name, role=role)


def verify_share(db: Database, secret: str) -> ShareGrant | None:
    """Resolve a share link's secret to its grant, or ``None`` when unknown,
    revoked or expired. Pure read, like :func:`verify_token`."""
    if not secret:
        return None
    h = hash_secret(secret)
    row = db.read_one(
        """SELECT s.id, s.report_id, s.secret_hash, s.expires_at, s.revoked_at, r.project_id
             FROM report_shares s JOIN reports r ON r.id = s.report_id
            WHERE s.secret_hash = ?""",
        [h],
    )
    if row is None:
        return None
    share_id, report_id, secret_hash, expires_at, revoked_at, project_id = row
    if not secrets_equal(secret_hash, h):
        return None
    if revoked_at or expires_at <= _now_iso():
        return None
    return ShareGrant(
        share_id=share_id, report_id=report_id, project_id=project_id, expires_at=expires_at,
    )


def share_principal(grant: ShareGrant) -> Principal:
    return Principal(token_id="", name=f"share:{grant.share_id}", role=SHARE_ROLE, share=grant)


def seconds_until(expires_at: str) -> int:
    """Seconds from now to ``expires_at`` (an ISO timestamp), at least 1."""
    expires = datetime.fromisoformat(expires_at)
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    return max(1, int((expires - _now()).total_seconds()))


#: Historical name, kept for the CLI access banner and the login route.
verify_bearer_token = verify_token


def cookie_max_age(db: Database, token_id: str) -> int:
    """Cookie ``Max-Age`` for a token: its remaining lifetime, or the default
    when it never expires. Always >= 1, so a token that is still valid never
    hands the browser an already-expired cookie."""
    row = db.read_one("SELECT expires_at FROM tokens WHERE id = ?", [token_id])
    expires_at = row[0] if row else None
    if not expires_at:
        return DEFAULT_COOKIE_MAX_AGE
    try:
        expires = datetime.fromisoformat(expires_at)
    except ValueError:
        return DEFAULT_COOKIE_MAX_AGE
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    return max(1, int((expires - _now()).total_seconds()))


# ---------------------------------------------------------------------------
# Expiry housekeeping
# ---------------------------------------------------------------------------


def sweep_expired(db: Database) -> None:
    """Opportunistic, bounded best-effort GC of expired otp/nonce rows.
    Called from the (relatively rare) credential-minting paths so the tables
    don't accumulate dead rows forever; a full periodic sweep is out of
    scope. Never raises — housekeeping must not break the caller.

    Deliberately NOT called from the request path: it writes.
    """
    try:
        now = _now_iso()
        with db.transaction() as con:
            con.execute("DELETE FROM auth_otp WHERE expires_at <= ?", [now])
            con.execute("DELETE FROM auth_nonces WHERE expires_at <= ?", [now])
    except Exception:  # noqa: BLE001 - best-effort housekeeping
        pass


# ---------------------------------------------------------------------------
# One-time login (bootstrap URL: /login?otp=...)
# ---------------------------------------------------------------------------


def create_otp(db: Database, token_id: str) -> str:
    sweep_expired(db)
    otp = generate_secret(24)
    db.write(
        "INSERT INTO auth_otp (otp_hash, token_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
        [hash_secret(otp), token_id, _now_iso(), _iso_in(OTP_TTL_MINUTES * 60)],
    )
    return otp


def consume_otp(db: Database, otp: str) -> Principal | None:
    """Single-use: the row is deleted atomically as part of the lookup, so
    a second call with the same OTP always fails, even under a race."""
    if not otp:
        return None
    h = hash_secret(otp)
    with db.transaction() as con:
        row = con.execute(
            "SELECT otp_hash, token_id, expires_at FROM auth_otp WHERE otp_hash = ?", [h]
        ).fetchone()
        if row is None:
            return None
        con.execute("DELETE FROM auth_otp WHERE otp_hash = ?", [h])
        otp_hash, token_id, expires_at = row
        if not secrets_equal(otp_hash, h):
            return None
        now = _now_iso()
        if expires_at <= now:
            return None
        trow = con.execute(
            "SELECT name, role, disabled, expires_at FROM tokens WHERE id = ?", [token_id]
        ).fetchone()
    if trow is None or trow[2]:
        return None
    name, role, _disabled, token_expires_at = trow
    # Backing token expiry — a short-lived token must not yield a session
    # via the OTP path any more than via the login path.
    if token_expires_at and token_expires_at <= now:
        return None
    return Principal(token_id=token_id, name=name, role=role)


# ---------------------------------------------------------------------------
# SSH login nonces (namespace-bound, single-use, 5 min)
# ---------------------------------------------------------------------------


def create_nonce(db: Database, namespace: str) -> str:
    sweep_expired(db)
    nonce = generate_secret(24)
    db.write(
        "INSERT INTO auth_nonces (nonce_hash, namespace, created_at, expires_at) VALUES (?, ?, ?, ?)",
        [hash_secret(nonce), namespace, _now_iso(), _iso_in(NONCE_TTL_MINUTES * 60)],
    )
    return nonce


def consume_nonce(db: Database, nonce: str, namespace: str) -> bool:
    """Single-use + namespace-bound (prevents cross-context signature replay)."""
    if not nonce or not namespace:
        return False
    h = hash_secret(nonce)
    with db.transaction() as con:
        row = con.execute(
            "SELECT nonce_hash, namespace, expires_at FROM auth_nonces WHERE nonce_hash = ?", [h]
        ).fetchone()
        if row is None:
            return False
        con.execute("DELETE FROM auth_nonces WHERE nonce_hash = ?", [h])
        nonce_hash, stored_ns, expires_at = row
    if not secrets_equal(nonce_hash, h):
        return False
    if not secrets_equal(stored_ns, namespace):
        return False
    if expires_at <= _now_iso():
        return False
    return True


# ---------------------------------------------------------------------------
# authorized_keys (SSH login)
# ---------------------------------------------------------------------------

_KEYTYPE_RE = re.compile(r"^(ssh-(ed25519|rsa|dss)|ecdsa-sha2-[\w-]+|sk-ssh-ed25519@openssh\.com)$")
_ROLE_COMMENT_RE = re.compile(r"\brole=(admin|write|read)\b")


def parse_authorized_key_line(line: str) -> tuple[str, str, str] | None:
    """Parse one ``authorized_keys``-style line (or a bare pubkey a client
    submits): ``[options] keytype base64key [comment...]``.

    Returns ``(keytype, base64key, comment)`` or ``None`` if unparseable.
    Note: leading SSH ``options=`` prefixes (``command=...,no-pty``, etc.)
    are not supported — only the ``keytype base64key [comment]`` form.
    """
    fields = line.strip().split()
    for i, field in enumerate(fields):
        if _KEYTYPE_RE.match(field) and i + 1 < len(fields):
            keytype = field
            keyblob = fields[i + 1]
            comment = " ".join(fields[i + 2 :])
            return keytype, keyblob, comment
    return None


def find_authorized_key(dd: DataDir, keytype: str, keyblob: str) -> dict[str, str] | None:
    """Look up ``(keytype, keyblob)`` in ``DATA_DIR/auth/authorized_keys``.

    Operator-managed file, standard ``authorized_keys`` line format. Role is
    read from a ``role=<admin|write|read>`` token in the comment field;
    absent that, the default role is ``write``.
    """
    path = dd.root / "auth" / "authorized_keys"
    if not path.exists():
        return None
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        parsed = parse_authorized_key_line(line)
        if parsed is None:
            continue
        line_keytype, line_keyblob, comment = parsed
        if line_keytype != keytype:
            continue
        if not secrets_equal(line_keyblob, keyblob):
            continue
        m = _ROLE_COMMENT_RE.search(comment)
        role = m.group(1) if m else "write"
        return {"role": role, "comment": comment}
    return None


# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------


def principal_from_request(request: Request) -> Principal | None:
    """Resolve the caller's identity: ``Authorization: Bearer`` (SDK/CLI),
    then the ``cairn_token`` cookie (browser), then the ``cairn_share``
    cookie (a redeemed share link). A bearer header is authoritative when
    sent. Never writes."""
    db: Database = request.app.state.db
    authz = request.headers.get("authorization")
    if authz and authz.lower().startswith("bearer "):
        return verify_token(db, authz[7:].strip())
    cookie_token = request.cookies.get(AUTH_COOKIE)
    if cookie_token:
        principal = verify_token(db, cookie_token)
        if principal is not None:
            return principal
    share_secret = request.cookies.get(SHARE_COOKIE)
    if share_secret:
        grant = verify_share(db, share_secret)
        if grant is not None:
            return share_principal(grant)
    return None


# ---------------------------------------------------------------------------
# Share links: a default-deny route allowlist
# ---------------------------------------------------------------------------

#: A checker decides whether one request of a share principal may proceed,
#: given the report's live scope (``report_scope.ShareScope``).
ShareChecker = Callable[[Request, ShareScope], bool]


def _run_in_scope(request: Request, scope: ShareScope) -> bool:
    return request.path_params.get("run_id") in scope.run_ids


def _source_in_scope(request: Request, scope: ShareScope) -> bool:
    return request.path_params.get("run_id") in scope.source_run_ids


def _artifact_in_scope(request: Request, scope: ShareScope) -> bool:
    digest = request.path_params.get("digest")
    return digest in scope.artifacts(request.app.state.db, request.app.state.blobs)


def _the_report(request: Request, scope: ShareScope) -> bool:
    return (
        request.path_params.get("report_id") == scope.report_id
        and request.path_params.get("project_id", scope.project_id) == scope.project_id
    )


#: The ONLY routes a share principal may call (GET/HEAD only), keyed by the
#: route's path template. Anything not listed is 403 — a guard test walks every
#: route of the app to hold this line.
SHARE_ALLOWED: dict[str, ShareChecker] = {
    "/api/share/context": lambda request, scope: True,
    "/api/projects/{project_id}/reports/{report_id}": _the_report,
    "/api/reports/{report_id}/assets/{digest}": _the_report,
    "/api/runs/{run_id}": _run_in_scope,
    "/api/runs/{run_id}/sequences": _run_in_scope,
    "/api/runs/{run_id}/sequences/{name:path}": _run_in_scope,
    "/api/runs/{run_id}/updates": _run_in_scope,
    "/api/runs/{run_id}/artifacts": _run_in_scope,
    "/api/artifacts/{digest}": _artifact_in_scope,
    "/api/runs/{run_id}/source/tree": _source_in_scope,
    "/api/runs/{run_id}/source/file": _source_in_scope,
}


def share_scope(request: Request, grant: ShareGrant) -> ShareScope:
    """The live scope of ``grant``'s report (cached per share)."""
    return request.app.state.share_scopes.get(
        request.app.state.db, grant.share_id, grant.report_id,
    )


def share_allows(request: Request, grant: ShareGrant) -> bool:
    if request.method not in ("GET", "HEAD"):
        return False
    route = request.scope.get("route")
    checker = SHARE_ALLOWED.get(getattr(route, "path", None) or "")
    if checker is None:
        return False
    return bool(checker(request, share_scope(request, grant)))


def request_share(request: Request) -> ShareGrant | None:
    """The share grant the request was admitted under, if any."""
    return getattr(request.state, "share", None)


def require_role(min_role: str) -> Callable[[Request], Principal | None]:
    """FastAPI dependency factory: 401 if unauthenticated, 403 if the
    authenticated principal's role is below ``min_role``. A no-op (always
    passes, returns None) when ``request.app.state.auth_enabled`` is falsy —
    this is how ``create_app()``'s auth-off default (existing test fixtures)
    stays unaffected.

    A share principal passes only a read-role check, only on a GET/HEAD
    route in :data:`SHARE_ALLOWED` whose checker admits the request."""
    if min_role not in ROLE_RANK:
        raise ValueError(f"invalid role {min_role!r}; must be one of {ROLES}")
    min_rank = ROLE_RANK[min_role]

    def _dep(request: Request) -> Principal | None:
        if not getattr(request.app.state, "auth_enabled", False):
            return None
        principal = principal_from_request(request)
        if principal is None:
            raise HTTPException(status_code=401, detail="authentication required")
        if principal.share is not None:
            if min_rank > ROLE_RANK["read"] or not share_allows(request, principal.share):
                raise HTTPException(status_code=403, detail="not available through a share link")
            request.state.share = principal.share
            return principal
        if ROLE_RANK[principal.role] < min_rank:
            raise HTTPException(
                status_code=403,
                detail=f"role '{principal.role}' insufficient; requires '{min_role}'",
            )
        return principal

    return _dep


def bootstrap_if_needed(db: Database) -> tuple[str, str, str] | None:
    """On first auth-enabled start with zero tokens, mint an admin token +
    a matching one-time login OTP. Returns ``(token_id, token_plaintext,
    otp)``, or ``None`` if tokens already exist (no-op)."""
    row = db.read_one("SELECT COUNT(*) FROM tokens")
    count = row[0] if row else 0
    if count:
        return None
    token_id, plaintext = create_token(db, name="bootstrap-admin", role="admin")
    otp = create_otp(db, token_id)
    return token_id, plaintext, otp


def ensure_local_token(db: "Database", data_dir_root) -> str:
    """Ensure the SAME-USER local-trust token exists (refactor spec §7).

    A serving process (``cairn ui``/``cairn server``/the ephemeral server)
    writes the plaintext to ``<data_dir>/auth/local.token`` (dir 0700, file
    0600) so same-account clients on this machine — the SDK's
    upgrade-to-HTTP path — can authenticate without any manual token
    provisioning. Filesystem permissions ARE the trust boundary, exactly as
    they were for the direct-DB mode. Reuses the existing file if its token
    row is still valid; mints a fresh one otherwise.
    """
    import os
    from pathlib import Path

    auth_dir = Path(data_dir_root) / "auth"
    auth_dir.mkdir(mode=0o700, exist_ok=True)
    tok_path = auth_dir / "local.token"
    if tok_path.exists():
        plaintext = tok_path.read_text().strip()
        row = db.read_one(
            "SELECT id FROM tokens WHERE token_hash = ? AND disabled = 0",
            [hash_secret(plaintext)],
        )
        if row:
            return plaintext
    _, plaintext = create_token(db, name="local-process", role="write")
    fd = os.open(tok_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(plaintext)
    return plaintext
