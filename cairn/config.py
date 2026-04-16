"""Configuration: server URL resolution and config file I/O.

Resolution order for the server URL (first match wins):
    1. explicit ``server=`` kwarg
    2. module-level ``configure(server=...)``
    3. ``CAIRN_SERVER`` environment variable
    4. config file at ``platformdirs.user_config_dir('cairn')/config.toml``
    5. ``DEFAULT_SERVER``
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

import platformdirs

if sys.version_info >= (3, 11):
    import tomllib
else:  # pragma: no cover - only exercised on 3.10
    import tomli as tomllib

import tomli_w

DEFAULT_SERVER = "http://localhost:4300"
"""Fallback URL when nothing else is configured."""

_configured: dict[str, Any] = {}
"""Module-level state populated by ``configure()``."""


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
    """
    _configured.update({k: v for k, v in kwargs.items() if v is not None})


def reset_configured() -> None:
    """Clear module-level configuration (primarily for tests)."""
    _configured.clear()


def resolve_server(explicit: str | None = None) -> str:
    """Resolve the server URL per the documented priority chain."""
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
