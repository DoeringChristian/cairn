"""Choose exactly one backend: direct local storage or remote HTTP."""

from __future__ import annotations

import logging
from pathlib import Path

from .. import config
from .transport import Transport
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from cairn.backend.repository import Repository

log = logging.getLogger(__name__)


def open_transport(
    repo: str | Path | None = None,
    *,
    timeout: float = 10.0,
) -> tuple[Transport | Repository, str]:
    """Open a run's transport for ``repo``; return ``(transport, server_url)``.

    ``repo`` resolves like ``cairn.Run(repo=...)`` (explicit > env > config >
    ``./.cairn``). The caller owns the transport and must ``close()`` it.
    """
    return open_writer(repo, timeout=timeout)


def open_writer(
    repo: str | Path | None = None,
    *,
    timeout: float = 10.0,
) -> tuple[Transport | Repository, str]:
    """Open direct local storage or HTTP to the selected remote endpoint."""
    from cairn.backend.storage.context import StorageConfig
    if isinstance(repo, StorageConfig):
        from cairn.backend.repository import Repository
        transport = Repository(repo, timeout=timeout)
        return transport, transport.server_url
    target = config.resolve_target(repo=repo)
    if target.is_local:
        from cairn.backend.repository import Repository
        transport = Repository(target.location, timeout=timeout)
        return transport, transport.server_url
    transport = Transport(target.location, timeout=timeout)
    return transport, target.location
