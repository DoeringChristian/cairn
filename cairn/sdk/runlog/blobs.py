"""Content-addressed blobs of a run directory: ``blobs/<sha256>``.

A blob is written to a temporary file, fsynced, renamed into place and the
directory fsynced, so a blob that exists under its hash is complete. Its
record is appended only after that (0.6 spec §2).
"""

from __future__ import annotations

import hashlib
import os
import secrets
from pathlib import Path

from .log import fsync_dir, fsync_file

_HEX = frozenset("0123456789abcdef")


def is_digest(value: str) -> bool:
    return len(value) == 64 and set(value) <= _HEX


def blob_path(blobs_dir: Path, digest: str) -> Path:
    if not is_digest(digest):
        raise ValueError(f"not a sha256 digest: {digest!r}")
    return Path(blobs_dir) / digest


def write_blob(blobs_dir: Path, data: bytes) -> str:
    """Store ``data`` under its sha256 (a no-op when present); returns the hash."""
    digest = hashlib.sha256(data).hexdigest()
    dest = Path(blobs_dir) / digest
    if dest.exists() and dest.stat().st_size == len(data):
        return digest
    blobs_dir = Path(blobs_dir)
    blobs_dir.mkdir(parents=True, exist_ok=True)
    tmp = blobs_dir / f".tmp-{digest[:16]}-{secrets.token_hex(4)}"
    try:
        with open(tmp, "wb") as fh:
            fh.write(data)
            fh.flush()
            fsync_file(fh.fileno())
        os.replace(tmp, dest)
    finally:
        tmp.unlink(missing_ok=True)
    fsync_dir(blobs_dir)
    return digest


def verify_blob(path: Path, digest: str) -> bool:
    """True when the file at ``path`` hashes to ``digest``."""
    h = hashlib.sha256()
    try:
        with open(path, "rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                h.update(chunk)
    except FileNotFoundError:
        return False
    return h.hexdigest() == digest
