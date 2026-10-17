"""Shared CLI destination options: a local repo or remote server."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any, TypeVar

import click

from . import config as _config

REPO_HELP = (
    "A local .cairn/ directory, or a server as cairn://HOST:PORT or an "
    "http(s):// URL. Default: CAIRN_REPO / CAIRN_SERVER / the config file, "
    "else ./.cairn."
)
SERVER_HELP = "A server URL (cairn://HOST:PORT or http(s)://...); same as --repo with a URL."

F = TypeVar("F", bound=Callable[..., Any])


def target_options(f: F) -> F:
    """``--repo`` and ``--server`` on a command (keyword args ``repo``, ``server``)."""
    f = click.option("--server", default=None, metavar="URL", help=SERVER_HELP)(f)
    f = click.option("--repo", default=None, metavar="PATH|URL", help=REPO_HELP)(f)
    return f


def explicit(repo: str | None, server: str | None) -> str | None:
    """The explicitly named target as one ``repo=`` spelling (a path or a
    URL), or None to let the environment and config decide."""
    if repo is not None and server is not None:
        raise click.UsageError("pass --repo or --server, not both")
    if server is not None:
        return _config._as_server_url(server)
    return repo


def resolve(repo: str | None, server: str | None) -> _config.RunTarget:
    return _config.resolve_target(repo=explicit(repo, server))


def is_repo(path: str | Path) -> bool:
    """Whether a Cairn repo exists at ``path``: its database, or (a repo only
    runs have written so far, nothing ingested yet) its layout marker."""
    root = Path(path).expanduser()
    return (root / "cairn.db").is_file() or (root / "version").is_file()


def require_repo(path: str | Path) -> Path:
    """An existing local repo, or a one-line error saying how to name one."""
    root = Path(path).expanduser().resolve()
    if not is_repo(root):
        raise click.ClickException(
            f"no Cairn repo at {root}; create one with `cairn init`, or name "
            "yours with --repo/--server, CAIRN_REPO/CAIRN_SERVER or the config file"
        )
    return root


def reader_location(repo: str | None, server: str | None) -> tuple[str, str]:
    """``(location, label)`` for a ``cairn.Reader``: a server URL, an existing
    repo dir, or a ``.zip`` run archive; ``label`` names it in errors."""
    target = resolve(repo, server)
    if not target.is_local:
        return target.location, target.location.rstrip("/")
    loc = Path(target.location).expanduser()
    if loc.suffix == ".zip" and loc.is_file():
        return str(loc), str(loc)
    root = require_repo(loc)
    return str(root), str(root)
