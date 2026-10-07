"""Resolve where writes go: a local repo directory or a ``cairn://`` server.

``open_transport`` is a ``cairn.Run``'s resolution: a local repo gets the
run's own log (``LocalTransport``), whether or not a server serves the repo.
``open_writer`` is everyone else's (Reader and CLI edits, sweeps, registry
edits, ``cairn.log_artifact``): a local repo gets ``RepoTransport``, which
writes through the repo's ingest-lease holder.
"""

from __future__ import annotations

import logging
from pathlib import Path

from .. import config
from .local import LocalTransport, RepoTransport
from .transport import Transport

log = logging.getLogger(__name__)


def open_transport(
    repo: str | Path | None = None,
    *,
    timeout: float = 10.0,
) -> tuple[Transport | LocalTransport, str]:
    """Open a run's transport for ``repo``; return ``(transport, server_url)``.

    ``repo`` resolves like ``cairn.Run(repo=...)`` (explicit > env > config >
    ``./.cairn``):

    * a local ``.cairn/`` directory → ``LocalTransport`` (the run's log);
      ``server_url`` is ``file://<repo>``;
    * a ``cairn://host:port`` URL → HTTP ``Transport`` (warns if unreachable).

    The caller owns the transport and must ``close()`` it.
    """
    target = config.resolve_target(repo=repo)
    if not target.is_local:
        _probe_server(target.location)
        return Transport(target.location, timeout=timeout), target.location
    local = LocalTransport(target.location, timeout=timeout)
    return local, local.server_url


def open_writer(
    repo: str | Path | None = None,
    *,
    timeout: float = 10.0,
) -> tuple[Transport | RepoTransport, str]:
    """Open a transport for writes that are not a run's own logging.

    ``repo`` resolves as for ``open_transport``. A local repo gets a
    ``RepoTransport`` (each call goes to the live server holding the repo's
    ingest lease, or runs here under the lease); a URL gets ``Transport``.
    """
    target = config.resolve_target(repo=repo)
    if not target.is_local:
        _probe_server(target.location)
        return Transport(target.location, timeout=timeout), target.location
    t = RepoTransport(target.location, timeout=timeout)
    return t, t.server_url


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
