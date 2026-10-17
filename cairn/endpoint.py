"""Remote endpoints and discovery of explicitly started local viewers.

Tracking does not use local HTTP endpoints. This module never starts a process.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path

from . import config as _config

log = logging.getLogger(__name__)

class EndpointUnavailable(RuntimeError):
    """No server could be reached or started for the target."""


@dataclass(frozen=True)
class Endpoint:
    """A server to talk to: its base URL and the Bearer token for it."""

    url: str
    token: str | None = None
    #: The local repo this server serves, when it was found through one.
    repo: Path | None = None

    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"} if self.token else {}

    def client(self, timeout: float = 30.0):  # -> httpx.Client
        import httpx

        return httpx.Client(base_url=self.url, headers=self.headers(), timeout=timeout)


def resolve_endpoint(
    server: str | None = None,
    repo: str | Path | None = None,
    *,
    start: bool = False,
) -> Endpoint:
    """The endpoint for ``server``/``repo`` (see the module docstring).

    Args:
        server: A server URL (``http(s)://``, ``cairn://host:port``).
        repo: A local ``.cairn/`` directory or a server URL.
        start: Ignored; local HTTP servers are always started explicitly.

    Raises:
        EndpointUnavailable: The local repo's server did not start in time.
    """
    target = _config.resolve_target(repo=repo, server=server)
    if not target.is_local:
        url = target.location.rstrip("/")
        return Endpoint(url, _config.resolve_token(url))
    return local_endpoint(Path(target.location), start=start)


def live_server(root: Path) -> Endpoint | None:
    """Find an explicitly registered viewer for this repo; never start one."""
    import httpx
    from .backend.storage.datadir import read_live_servers
    root = Path(root).expanduser().resolve()
    for info in read_live_servers(root):
        host = info.get('host', '127.0.0.1')
        if host in ('0.0.0.0', '::'):
            host = '127.0.0.1'
        url = f"http://{host}:{info['port']}"
        token = _config.resolve_token(url)
        if not token and (root / 'token').is_file():
            token = (root / 'token').read_text().strip()
        endpoint = Endpoint(url, token, root)
        try:
            response = httpx.get(url + '/api/health', headers=endpoint.headers(), timeout=2)
            if response.status_code == 200:
                return endpoint
        except (httpx.HTTPError, OSError):
            continue
    return None


def local_endpoint(root: Path, *, start: bool = False) -> Endpoint:
    """Find an explicitly started viewer. Never spawn a tracking server."""
    endpoint = live_server(Path(root))
    if endpoint is None:
        raise EndpointUnavailable(f'no viewer for {root}; start `cairn ui --repo {root}`')
    return endpoint
