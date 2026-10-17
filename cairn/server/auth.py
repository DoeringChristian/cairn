"""One server credential, shared by SDK bearer headers and browser cookies."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import secrets
import stat
import tempfile

from fastapi import HTTPException, Request
from cairn.credentials import validate_token

AUTH_COOKIE_PREFIX = "cairn_token_"
DEFAULT_COOKIE_MAX_AGE = 400 * 86400


def ensure_token_file(path: Path) -> str:
    """Atomically publish a complete private credential; concurrent starters agree."""
    path = Path(path).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not path.exists():
        fd, temporary = tempfile.mkstemp(prefix=".token-", dir=path.parent)
        try:
            with os.fdopen(fd, "w") as stream:
                stream.write(secrets.token_urlsafe(32) + "\n")
                stream.flush()
                os.fsync(stream.fileno())
            try:
                os.link(temporary, path)
                directory = os.open(path.parent, os.O_RDONLY)
                try:
                    os.fsync(directory)
                finally:
                    os.close(directory)
            except FileExistsError:
                pass
        finally:
            os.unlink(temporary)
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    with os.fdopen(fd, "r") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > 4096:
            raise ValueError("token file must be a regular file of at most 4096 bytes")
        os.fchmod(stream.fileno(), 0o600)
        return validate_token(stream.read().strip())


def resolve_server_token(root: Path, token: str | None = None,
                         token_file: Path | None = None) -> tuple[str, Path | None]:
    if token is not None:
        return validate_token(token), None
    if "CAIRN_TOKEN" in os.environ:
        return validate_token(os.environ["CAIRN_TOKEN"]), None
    path = Path(token_file or os.environ.get("CAIRN_TOKEN_FILE") or root / "token").expanduser().absolute()
    return ensure_token_file(path), path


def server_id(root: Path) -> str:
    return hashlib.sha256(str(Path(root).resolve()).encode()).hexdigest()[:16]


def auth_cookie_name(sid: str) -> str:
    return AUTH_COOKIE_PREFIX + sid


def tokens_equal(supplied: str, expected: str) -> bool:
    return secrets.compare_digest(hashlib.sha256(supplied.encode()).digest(),
                                  hashlib.sha256(expected.encode()).digest())


def authenticated(request: Request) -> bool:
    expected = request.app.state.token
    header = request.headers.get("authorization")
    if header is not None:
        scheme, _, supplied = header.partition(" ")
        if scheme.lower() != "bearer":
            return False
    else:
        supplied = request.cookies.get(auth_cookie_name(request.app.state.server_id), "")
    return bool(expected and tokens_equal(supplied, expected))


def require_auth(request: Request) -> None:
    if request.app.state.auth_enabled and not authenticated(request):
        raise HTTPException(401, "authentication required", headers={"WWW-Authenticate": "Bearer"})
