"""Endpoint resolution: which server a client talks to.

MERGE NOTE: minimal CLIENT-BRANCH STUB. The server half of 0.6 owns this
module (it also auto-starts the local server of a repo, spec §5); at merge
time take the server agent's version wholesale. The client code relies only
on ``Endpoint(url, token)``, ``EndpointUnavailable`` and
``resolve_endpoint(server=None, repo=None)``.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from . import config


@dataclass(frozen=True)
class Endpoint:
    url: str
    token: str | None = None


class EndpointUnavailable(RuntimeError):
    """No server can be resolved (or started) for the request."""


def resolve_endpoint(server: str | None = None, repo: str | Path | None = None) -> Endpoint:
    """The server for ``server`` (a URL), else ``repo`` (a URL or a local repo
    path), else ``CAIRN_SERVER``.

    Raises:
        EndpointUnavailable: Only a local repo is named (this stub cannot
            start its server).
    """
    url: str | None = None
    if server:
        url = config._as_server_url(server)
    elif repo is not None:
        target = config._parse_repo(str(repo))
        if target.is_local:
            raise EndpointUnavailable(
                f"no server serves the repo {target.location} (local server auto-start "
                "is not available in this build)"
            )
        url = target.location
    elif os.environ.get("CAIRN_SERVER"):
        url = config._as_server_url(os.environ["CAIRN_SERVER"])
    if url is None:
        raise EndpointUnavailable("no cairn server configured (CAIRN_SERVER)")
    url = url.rstrip("/")
    return Endpoint(url, config.resolve_token(url))
