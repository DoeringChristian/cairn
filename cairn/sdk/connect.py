"""Resolve where writes go: always a server, over HTTP.

Every target — a ``cairn://`` server or a local ``.cairn/`` repo — is
reached through its server (``cairn.endpoint.resolve_endpoint``: a local
repo's server is started in the background when none serves it). No client
opens a repo's database.

``open_transport`` is a ``cairn.Run``'s resolution, ``open_writer``
everyone else's (Reader and CLI edits, sweeps, registry edits,
``cairn.log_artifact``); both return an HTTP ``Transport``.
"""

from __future__ import annotations

import logging
from pathlib import Path

from .. import config
from ..endpoint import resolve_endpoint
from .transport import Transport

log = logging.getLogger(__name__)


def open_transport(
    repo: str | Path | None = None,
    *,
    timeout: float = 10.0,
) -> tuple[Transport, str]:
    """Open a run's transport for ``repo``; return ``(transport, server_url)``.

    ``repo`` resolves like ``cairn.Run(repo=...)`` (explicit > env > config >
    ``./.cairn``). The caller owns the transport and must ``close()`` it.
    """
    return open_writer(repo, timeout=timeout)


def open_writer(
    repo: str | Path | None = None,
    *,
    timeout: float = 10.0,
) -> tuple[Transport, str]:
    """Open an HTTP transport to the server of ``repo`` (resolved as for
    ``open_transport``); warns when an explicitly named server does not
    answer."""
    target = config.resolve_target(repo=repo)
    if not target.is_local:
        _probe_server(target.location)
    endpoint = resolve_endpoint(repo=target.location)
    transport = Transport(endpoint.url, timeout=timeout, token=endpoint.token)
    #: The local repo the server serves (None for a server named by URL).
    transport.repo_root = endpoint.repo
    return transport, endpoint.url


def _probe_server(url: str) -> None:
    """Probe ``<url>/api/health`` and warn if unreachable.

    Used when the user explicitly passes ``repo="cairn://host:port"`` — without
    this, the user only learns about a wrong host/port from cryptic httpx
    retry errors deep in the run. Emits a clear warning at startup so the
    cause is obvious.
    """
    import httpx

    try:
        resp = httpx.get(f"{url}/api/health", timeout=2.0)
        if resp.status_code != 200:
            raise RuntimeError(f"status {resp.status_code}")
    except Exception as exc:  # noqa: BLE001
        cairn_url = url.replace("http://", "cairn://", 1) if url.startswith("http://") else url
        log.warning(
            "Cairn server at %s did not respond to /api/health (%s). "
            "Run creation and writes will likely fail — check that the "
            "server is running on this host:port.",
            cairn_url, exc,
        )
