"""Configuration: repo resolution and config file I/O.

A ``Run`` is bound to *one* destination — either a local repo path or
a remote server. Resolution order:

    1. explicit ``repo=`` kwarg
    2. module-level ``configure(repo=...)``
    3. ``CAIRN_REPO`` env var
    4. config file ``repo`` key

If none of these are set, defaults to ``./.cairn`` in CWD (local mode).

URL scheme:
    repo="/path/to/.cairn"       → local mode (direct DB or WAL)
    repo="cairn://host:port"     → HTTP server mode
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import platformdirs

if sys.version_info >= (3, 11):
    import tomllib
else:  # pragma: no cover - only exercised on 3.10
    import tomli as tomllib

import tomli_w

DEFAULT_SERVER = "http://localhost:4300"
"""Fallback URL used by ``resolve_server`` for CLI commands only."""

_configured: dict[str, Any] = {}
"""Module-level state populated by ``configure()``."""

CAIRN_SCHEME = "cairn://"


@dataclass(frozen=True)
class RunTarget:
    """Resolved destination for a Run."""

    kind: Literal["local", "server"]
    location: str

    @property
    def is_local(self) -> bool:
        return self.kind == "local"


def config_file_path() -> Path:
    """Return the OS-appropriate config file path."""
    return Path(platformdirs.user_config_dir("cairn")) / "config.toml"


def load_config_file(path: Path | None = None) -> dict[str, Any]:
    """Load the TOML config file; return ``{}`` if missing or malformed."""
    path = path or config_file_path()
    if not path.exists():
        return {}
    try:
        with path.open("rb") as fh:
            return tomllib.load(fh)
    except (OSError, tomllib.TOMLDecodeError):
        return {}


def write_config_file(data: dict[str, Any], path: Path | None = None) -> None:
    """Write ``data`` as TOML, creating parent dirs as needed."""
    path = path or config_file_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as fh:
        tomli_w.dump(data, fh)


def configure(**kwargs: Any) -> None:
    """Set module-level defaults consulted by subsequent ``resolve_*`` calls.

    Example::

        cairn.configure(repo="cairn://gpubox.local:4300")
        # or
        cairn.configure(repo="./.cairn")
    """
    _configured.update({k: v for k, v in kwargs.items() if v is not None})


def reset_configured() -> None:
    """Clear module-level configuration (primarily for tests)."""
    _configured.clear()


def _parse_repo(value: str) -> RunTarget:
    """Parse a repo string into a RunTarget.

    ``cairn://host:port`` → server mode (HTTP)
    anything else         → local mode (filesystem path)
    """
    if value.startswith(CAIRN_SCHEME):
        http_url = "http://" + value[len(CAIRN_SCHEME):]
        return RunTarget("server", http_url)
    return RunTarget("local", str(Path(value).expanduser()))


def resolve_server(explicit: str | None = None) -> str:
    """Resolve the server URL per the server-only priority chain.

    Kept for callers (CLI `ping`/`list`/...) that only speak HTTP.
    """
    if explicit is not None:
        return explicit
    if "repo" in _configured:
        t = _parse_repo(str(_configured["repo"]))
        if not t.is_local:
            return t.location
    env = os.environ.get("CAIRN_REPO")
    if env:
        t = _parse_repo(env)
        if not t.is_local:
            return t.location
    cfg = load_config_file()
    if "repo" in cfg:
        t = _parse_repo(str(cfg["repo"]))
        if not t.is_local:
            return t.location
    return DEFAULT_SERVER


def resolve_target(
    repo: str | Path | None = None,
) -> RunTarget:
    """Resolve where a ``Run`` should send its data.

    Returns a :class:`RunTarget` tagged ``local`` (with a filesystem path) or
    ``server`` (with a URL).

    Accepts ``cairn://host:port`` for HTTP server mode.
    """
    if repo is not None:
        return _parse_repo(str(repo))
    if "repo" in _configured:
        return _parse_repo(str(_configured["repo"]))
    env_repo = os.environ.get("CAIRN_REPO")
    if env_repo:
        return _parse_repo(env_repo)
    cfg = load_config_file()
    if "repo" in cfg:
        return _parse_repo(str(cfg["repo"]))
    # Default: ./.cairn in CWD
    return RunTarget("local", str(Path.cwd() / ".cairn"))
