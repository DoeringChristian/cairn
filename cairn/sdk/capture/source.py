"""Source tree capture: find root, build tar.zst archive + manifest."""

from __future__ import annotations

import fnmatch
import hashlib
import io
import logging
import tarfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import zstandard as zstd

log = logging.getLogger(__name__)

PROJECT_MARKERS: tuple[str, ...] = (
    ".git",
    "pyproject.toml",
    "pixi.toml",
    "pixi.lock",
    "setup.py",
    "setup.cfg",
    "Pipfile",
    "environment.yml",
    "uv.lock",
    "poetry.lock",
    "requirements.txt",
    ".hg",
)

DEFAULT_INCLUDE: tuple[str, ...] = (
    "*.py",
    "*.yaml",
    "*.yml",
    "*.toml",
    "*.json",
    "*.cfg",
    "*.ini",
    "requirements.txt",
    "pyproject.toml",
    "setup.py",
    "setup.cfg",
    "Pipfile",
    "Pipfile.lock",
    "poetry.lock",
    "uv.lock",
    "environment.yml",
)

DEFAULT_EXCLUDE: tuple[str, ...] = (
    ".git",
    ".hg",
    "__pycache__",
    "*.pyc",
    ".venv",
    "venv",
    "env",
    "node_modules",
    ".cairn",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    "dist",
    "build",
    "*.egg-info",
)


def find_project_root(start: Path) -> tuple[Path, str | None]:
    """Walk upward from ``start`` looking for a project marker.

    Returns ``(root, marker)`` or ``(start, None)`` with a logged warning if
    no marker is found.
    """
    start = Path(start).resolve()
    current: Path = start if start.is_dir() else start.parent
    while True:
        for marker in PROJECT_MARKERS:
            if (current / marker).exists():
                return current, marker
        if current.parent == current:
            break
        current = current.parent
    log.warning(
        "No project marker found walking up from %s; using it as root. "
        "Pass source_root= explicitly or add a pyproject.toml/.git.",
        start,
    )
    return start, None


def _load_gitignore(root: Path) -> list[str]:
    """Read the top-level ``.gitignore`` into a flat pattern list.

    Simplified: we do NOT support nested gitignores, negation, or the full
    gitignore spec. Good enough to skip common junk; users with complex
    setups can pass ``source_exclude=``.
    """
    path = root / ".gitignore"
    if not path.exists():
        return []
    patterns: list[str] = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or line.startswith("!"):
            continue
        # Strip leading slash (absolute-from-root means same thing for us).
        patterns.append(line.lstrip("/"))
    return patterns


def _match_any(path: str, patterns: list[str] | tuple[str, ...]) -> bool:
    for pat in patterns:
        if fnmatch.fnmatch(path, pat):
            return True
        # Match as directory prefix too (``dist`` should match ``dist/foo.py``).
        if "/" not in pat and any(
            fnmatch.fnmatch(part, pat) for part in path.split("/")
        ):
            return True
    return False


def _is_binary(data: bytes) -> bool:
    return b"\x00" in data[:8192]


def build_source_archive(
    root: Path,
    *,
    include: list[str] | tuple[str, ...] = DEFAULT_INCLUDE,
    exclude: list[str] | tuple[str, ...] = DEFAULT_EXCLUDE,
    max_file_size_mb: float = 1.0,
    respect_gitignore: bool = True,
    marker: str | None = None,
) -> tuple[bytes, dict[str, Any]]:
    """Return ``(compressed_tar_bytes, manifest_dict)``."""
    root = Path(root).resolve()
    max_bytes = int(max_file_size_mb * 1024 * 1024)
    gitignore = _load_gitignore(root) if respect_gitignore else []

    tar_buf = io.BytesIO()
    files_entries: list[dict[str, Any]] = []
    skipped_entries: list[dict[str, Any]] = []

    with tarfile.open(fileobj=tar_buf, mode="w") as tf:
        for path in sorted(root.rglob("*")):
            if not path.is_file():
                continue
            rel = path.relative_to(root).as_posix()

            # Exclude check — gitignore + default + user.
            if _match_any(rel, list(exclude)) or _match_any(rel, gitignore):
                skipped_entries.append({"path": rel, "reason": "excluded"})
                continue

            # Include check
            basename = path.name
            if not (
                _match_any(rel, list(include))
                or _match_any(basename, list(include))
            ):
                # Not on the include list; quietly skip (not an "interesting" skip).
                continue

            size = path.stat().st_size
            if size > max_bytes:
                skipped_entries.append(
                    {"path": rel, "reason": f"size>{max_file_size_mb}MB"}
                )
                continue

            try:
                data = path.read_bytes()
            except OSError as exc:
                skipped_entries.append({"path": rel, "reason": f"read-error: {exc}"})
                continue

            if _is_binary(data):
                skipped_entries.append({"path": rel, "reason": "binary"})
                continue

            # Add to tar.
            info = tarfile.TarInfo(name=rel)
            info.size = len(data)
            info.mtime = int(path.stat().st_mtime)
            tf.addfile(info, io.BytesIO(data))
            files_entries.append(
                {
                    "path": rel,
                    "size": len(data),
                    "sha256": hashlib.sha256(data).hexdigest(),
                }
            )

    compressed = zstd.ZstdCompressor().compress(tar_buf.getvalue())
    manifest = {
        "root": str(root),
        "marker": marker,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "files": files_entries,
        "skipped": skipped_entries,
    }
    return compressed, manifest
