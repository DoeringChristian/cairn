"""Configuration: server URL / local repo resolution and config file I/O.

A ``Run`` is bound to *one* destination — either a server URL or a local
``.cairn/`` repo path. Resolution order:

    1. explicit ``repo=`` kwarg       (local mode)
    2. explicit ``server=`` kwarg     (server mode)
    3. module-level ``configure(repo=...)`` or ``configure(server=...)``
    4. ``CAIRN_REPO`` env var
    5. ``CAIRN_SERVER`` env var
    6. config file ``repo`` or ``server`` key
    7. ``./.cairn/`` if present (auto-discover local mode in CWD)
    8. ``DEFAULT_SERVER`` (http://localhost:4300)

If any *local repo* source resolves, that wins over any server source lower
in the chain. This keeps the priority intuitive: if the user explicitly
typed ``repo=``, we honour it even if ``CAIRN_SERVER`` is also set.
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
"""Fallback URL when nothing else is configured."""

LOCAL_REPO_DIRNAME = ".cairn"
"""Directory name Cairn looks for when auto-discovering a local repo in CWD."""

_configured: dict[str, Any] = {}
"""Module-level state populated by ``configure()``."""


@dataclass(frozen=True)
class RunTarget:
    """Resolved destination for a Run. Exactly one of ``repo`` / ``server`` is set."""

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

        cairn.configure(server="http://gpubox.local:4300")
        # or
        cairn.configure(repo="./.cairn")
    """
    _configured.update({k: v for k, v in kwargs.items() if v is not None})


def reset_configured() -> None:
    """Clear module-level configuration (primarily for tests)."""
    _configured.clear()


def resolve_server(explicit: str | None = None) -> str:
    """Resolve the server URL per the server-only priority chain.

    Kept for callers (CLI `ping`/`list`/…) that only speak HTTP.
    """
    if explicit is not None:
        return explicit
    if "server" in _configured:
        return str(_configured["server"])
    env = os.environ.get("CAIRN_SERVER")
    if env:
        return env
    cfg = load_config_file()
    if "server" in cfg:
        return str(cfg["server"])
    return DEFAULT_SERVER


def resolve_target(
    repo: str | Path | None = None,
    server: str | None = None,
) -> RunTarget:
    """Resolve where a ``Run`` should send its data.

    Returns a :class:`RunTarget` tagged ``local`` (with a filesystem path) or
    ``server`` (with a URL). See module docstring for priority rules.
    """
    if repo is not None:
        return RunTarget("local", str(Path(repo).expanduser()))
    if server is not None:
        return RunTarget("server", server)
    if "repo" in _configured:
        return RunTarget("local", str(Path(str(_configured["repo"])).expanduser()))
    if "server" in _configured:
        return RunTarget("server", str(_configured["server"]))
    env_repo = os.environ.get("CAIRN_REPO")
    if env_repo:
        return RunTarget("local", str(Path(env_repo).expanduser()))
    env_server = os.environ.get("CAIRN_SERVER")
    if env_server:
        return RunTarget("server", env_server)
    cfg = load_config_file()
    if "repo" in cfg:
        return RunTarget("local", str(Path(str(cfg["repo"])).expanduser()))
    if "server" in cfg:
        return RunTarget("server", str(cfg["server"]))
    # Auto-discover local repo in CWD.
    cwd_repo = Path.cwd() / LOCAL_REPO_DIRNAME
    if cwd_repo.is_dir():
        return RunTarget("local", str(cwd_repo))
    return RunTarget("server", DEFAULT_SERVER)
