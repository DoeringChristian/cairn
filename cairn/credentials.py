"""Validation shared by the server credential and client token discovery."""
from pathlib import Path
import os
import stat


def validate_token(token: str) -> str:
    if not token or len(token) > 4096 or any(c.isspace() for c in token):
        raise ValueError('token must be nonempty, at most 4096 characters, without whitespace')
    return token


def read_token_file(path: Path) -> str:
    """Read a copied credential without echoing its contents in an error."""
    fd = os.open(Path(path).expanduser(), os.O_RDONLY | getattr(os, 'O_NONBLOCK', 0))
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > 4096:
            raise ValueError('token file must be a regular file of at most 4096 bytes')
        try:
            token = stream.read(4097).decode('utf-8').strip()
        except UnicodeDecodeError:
            raise ValueError('token file must contain a UTF-8 token') from None
    return validate_token(token)
