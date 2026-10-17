"""Opening a repo's database for serving: the checks a server runs at startup.

``open_repo_database`` is the one way a server process opens its repo:

1. **Local filesystem only.** SQLite's locking and ``fsync`` are unreliable on
   network filesystems (NFS, SMB, sshfs, Lustre, ...), where a database can
   be corrupted silently. A repo whose database lives on one is refused with
   a clear message (``CAIRN_ALLOW_NETWORK_DB=1`` overrides, at your own risk).
2. **Schema.** ``Database.open`` migrates an older database (additively),
   after an automatic online backup to ``<repo>/backups/``; a database of a
   newer cairn is refused.
3. **Integrity.** Explicit maintenance calls ``check_integrity``.
Opening does not import legacy logs or run full integrity scans.
"""

from __future__ import annotations

import logging
import os
import time
from pathlib import Path

from cairn.backend.storage.blobs import BlobStore
from cairn.backend.storage.datadir import DataDir
from cairn.backend.storage.db import Database, quick_check

log = logging.getLogger(__name__)

#: Filesystem types (``psutil.disk_partitions`` names, Linux and macOS) on
#: which the server refuses to keep its database.
NETWORK_FS = frozenset({
    "nfs", "nfs4", "smbfs", "cifs", "smb3", "smb2", "afpfs", "webdav", "davfs",
    "fuse.sshfs", "sshfs", "osxfuse", "macfuse", "9p", "lustre", "gpfs", "ceph",
    "fuse.ceph", "glusterfs", "fuse.glusterfs", "beegfs", "panfs", "ncpfs", "afs",
    "fuse.s3fs", "fuse.rclone", "fuse.gcsfuse", "fuse.juicefs", "fuse.dropbox",
})


class StartupError(RuntimeError):
    """The repo cannot be served (network filesystem, damaged database)."""


def filesystem_type(path: Path) -> str | None:
    """The filesystem type of the mount holding ``path`` (None if unknown)."""
    try:
        import psutil

        parts = psutil.disk_partitions(all=True)
    except Exception:  # noqa: BLE001 - unsupported platform: unknown
        return None
    target = os.path.realpath(path)
    best = None
    for p in parts:
        mount = p.mountpoint.rstrip("/") or "/"
        if target == mount or target.startswith(mount.rstrip("/") + "/") or mount == "/":
            if best is None or len(mount) > len(best.mountpoint.rstrip("/") or "/"):
                best = p
    return best.fstype.lower() if best is not None else None


def check_local_filesystem(root: Path) -> None:
    """Raises:
        StartupError: The repo is on a network filesystem.
    """
    fstype = filesystem_type(root)
    if fstype is None or fstype not in NETWORK_FS:
        return
    if os.environ.get("CAIRN_ALLOW_NETWORK_DB") == "1":
        log.warning("cairn: serving %s from a %s filesystem (CAIRN_ALLOW_NETWORK_DB=1)", root, fstype)
        return
    raise StartupError(
        f"the repo {root} is on a network filesystem ({fstype}). The server's database must "
        "be on a local disk: SQLite's locking and fsync are not reliable over the network and "
        "the database can be corrupted. Serve a repo on a local disk (runs on other machines "
        "upload to it over HTTP), or set CAIRN_ALLOW_NETWORK_DB=1 to override at your own risk."
    )


def open_repo_database(dd: DataDir, blobs: BlobStore | None = None, *, database_url: str | None = None) -> Database:
    """Open storage without scanning history. Integrity checks are explicit maintenance."""
    if database_url is not None:
        if database_url.startswith("sqlite:///"):
            check_local_filesystem(Path(database_url[10:]).resolve().parent)
        return Database.open(database_url)
    check_local_filesystem(dd.root)
    return Database.open(dd.db_path)


def check_integrity(db: Database) -> None:
    problems = quick_check(db)
    if problems:
        raise StartupError(f'database integrity check failed: {problems}')
