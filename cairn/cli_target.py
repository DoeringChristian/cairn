"""Where a CLI command reads and writes: a local repo or a server.

Every command that touches data takes ``--repo`` and ``--server`` and
resolves them with ``cairn.config.resolve_target`` (the order ``cairn.Run``
and ``cairn.Reader`` use): an explicit ``--repo``/``--server``, then
``CAIRN_REPO``/``CAIRN_SERVER``, then the config file, then ``./.cairn``.

``open_api`` hands a command an HTTP client for the target's server
(``cairn.endpoint.resolve_endpoint``): a server URL with its token, or, for
a local repo, the server serving it on this machine (started in the
background when none is), with the repo's same-user token. No command opens
a repo's database itself.
"""

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


class Api:
    """An HTTP client for the command's target (see the module docstring).

    ``get``/``post``/``delete``/``request`` return the response and raise for
    an error status (the CLI's one-line HTTP error handler reports it).
    ``local_root`` is the local repo when the target is one.
    """

    def __init__(self, target: _config.RunTarget) -> None:
        from .endpoint import EndpointUnavailable, local_endpoint, resolve_endpoint

        self.target = target
        self.local_root: Path | None = None
        if target.is_local:
            self.local_root = require_repo(target.location)
            try:
                endpoint = local_endpoint(self.local_root)
            except EndpointUnavailable as exc:
                raise click.ClickException(str(exc)) from None
        else:
            endpoint = resolve_endpoint(repo=target.location)
        self.endpoint = endpoint
        self.base = endpoint.url
        self.token = endpoint.token
        self._client = self._http_client(self.base, endpoint.token)

    @staticmethod
    def _http_client(base: str, token: str | None) -> Any:
        import httpx

        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return httpx.Client(base_url=base, headers=headers, timeout=httpx.Timeout(30.0, read=600.0))

    @property
    def label(self) -> str:
        """The target as shown in messages: the repo path or the server URL."""
        return str(self.local_root) if self.local_root is not None else self.base

    def request(self, method: str, path: str, **kwargs: Any) -> Any:
        resp = self._client.request(method, path, **kwargs)
        resp.raise_for_status()
        return resp

    def get(self, path: str, params: Any = None) -> Any:
        return self.request("GET", path, params=params)

    def post(self, path: str, **kwargs: Any) -> Any:
        return self.request("POST", path, **kwargs)

    def delete(self, path: str, **kwargs: Any) -> Any:
        return self.request("DELETE", path, **kwargs)

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> Api:
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()


def open_api(repo: str | None, server: str | None) -> Api:
    return Api(resolve(repo, server))
