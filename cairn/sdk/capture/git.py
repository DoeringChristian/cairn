"""Best-effort git metadata capture via subprocess."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any


def _git(cwd: Path, *args: str) -> str | None:
    try:
        out = subprocess.check_output(
            ["git", *args],
            cwd=str(cwd),
            stderr=subprocess.DEVNULL,
            timeout=5,
            text=True,
        )
        return out.strip()
    except (subprocess.SubprocessError, FileNotFoundError, OSError):
        return None


def capture_git(cwd: Path | None = None) -> dict[str, Any] | None:
    """Return git info or ``None`` if ``cwd`` isn't inside a git repo."""
    cwd = Path(cwd) if cwd is not None else Path.cwd()
    if _git(cwd, "rev-parse", "--git-dir") is None:
        return None
    sha = _git(cwd, "rev-parse", "HEAD")
    branch = _git(cwd, "rev-parse", "--abbrev-ref", "HEAD")
    status = _git(cwd, "status", "--porcelain")
    dirty = bool(status)
    diff = _git(cwd, "diff", "HEAD") if dirty else ""
    return {
        "sha": sha,
        "branch": branch,
        "dirty": dirty,
        "diff": diff or "",
    }
