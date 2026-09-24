"""Best-effort git metadata capture via subprocess."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit


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


def _strip_credentials(url: str | None) -> str | None:
    """Drop ``user:token@`` from an http(s) remote so no secret is stored."""
    if not url or "://" not in url:
        return url
    parts = urlsplit(url)
    if "@" not in parts.netloc:
        return url
    return urlunsplit(parts._replace(netloc=parts.netloc.rsplit("@", 1)[1]))


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
    untracked = _git(cwd, "ls-files", "--others", "--exclude-standard") if dirty else ""
    return {
        "sha": sha,
        "branch": branch,
        "dirty": dirty,
        "remote": _strip_credentials(_git(cwd, "remote", "get-url", "origin")),
        "diff": diff or "",
        "untracked": [line for line in (untracked or "").splitlines() if line],
    }


def diff_text(git_info: dict[str, Any], max_bytes: int = 2 * 1024 * 1024) -> str:
    """The working-tree diff plus the untracked-file list, capped at ``max_bytes``."""
    text = git_info.get("diff") or ""
    untracked = git_info.get("untracked") or []
    if untracked:
        if text and not text.endswith("\n"):
            text += "\n"
        text += "# Untracked files:\n" + "".join(f"#   {p}\n" for p in untracked)
    data = text.encode("utf-8")
    if len(data) > max_bytes:
        text = data[:max_bytes].decode("utf-8", errors="ignore")
    return text
