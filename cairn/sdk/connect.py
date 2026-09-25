"""Resolve where a run's writes go: the repo-dir DB, a server holding that
repo, or a ``cairn://`` server.

``open_transport`` is the one resolution path — ``cairn.Run``, CLI commands
that write, and the Reader's edit handle all call it.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from .. import config
from ..server.storage.datadir import DataDir, RepoLockedError
from .local import LocalTransport, _RepoServedByOtherError
from .transport import Transport

log = logging.getLogger(__name__)


def open_transport(
    repo: str | Path | None = None,
    *,
    local_wal: bool = False,
    timeout: float = 10.0,
) -> tuple[Transport | LocalTransport, str]:
    """Open a transport for ``repo`` and return ``(transport, server_url)``.

    ``repo`` resolves like ``cairn.Run(repo=...)`` (explicit > env > config >
    ``./.cairn``):

    * a local ``.cairn/`` directory → ``LocalTransport`` (direct DB, or WAL
      when ``local_wal``); ``server_url`` is ``file://<repo>``;
    * a local directory that a live ``cairn server``/``cairn ui`` holds →
      HTTP ``Transport`` to that server, authenticated with the repo's
      ``auth/local.token``; raises ``RepoLockedError`` if the holder does not
      answer ``/api/health``;
    * a ``cairn://host:port`` URL → HTTP ``Transport`` (warns if unreachable).

    The caller owns the transport and must ``close()`` it.
    """
    target = config.resolve_target(repo=repo)
    if not target.is_local:
        # cairn:// URL → HTTP mode. Probe /api/health so we fail fast (with a
        # clear message) instead of silently buffering writes to an
        # unreachable address.
        _probe_server(target.location)
        return Transport(target.location, timeout=timeout), target.location
    try:
        local = LocalTransport(target.location, use_wal=local_wal)
    except _RepoServedByOtherError as exc:
        url = _url_from_holder(exc.holder)
        if url is None:
            raise
        _verify_reachable(url, Path(target.location))
        # Same-user local trust: the serving process leaves
        # auth/local.token in the data dir for exactly this upgrade path.
        local_tok = Path(target.location) / "auth" / "local.token"
        tok = local_tok.read_text().strip() if local_tok.exists() else None
        return Transport(url, timeout=timeout, token=tok), url
    return local, local.server_url


def _url_from_holder(holder: dict[str, Any]) -> str | None:
    """Reconstruct an HTTP base URL from a lock-file holder dict, if it has
    both ``host`` and ``port``. Returns None otherwise.
    """
    host = holder.get("host")
    port = holder.get("port")
    if isinstance(host, str) and isinstance(port, int):
        return f"http://{host}:{port}"
    return None


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


def _verify_reachable(url: str, repo: Path) -> None:
    """Probe ``<url>/api/health`` so the SDK fails fast if the holder is hung.

    Raises :class:`RepoLockedError` with an actionable message if the
    holder's declared endpoint doesn't respond with 200.
    """
    import httpx

    try:
        resp = httpx.get(f"{url}/api/health", timeout=2.0)
        if resp.status_code != 200:
            raise RuntimeError(f"status {resp.status_code}")
    except Exception as exc:  # noqa: BLE001
        lock_path = DataDir(repo).lock_path
        raise RepoLockedError(
            repo,
            {
                "mode": "unreachable",
                "pid": "?",
                "hint": (
                    f"The repo lock at {lock_path} claims a server/UI is "
                    f"running at {url}, but {url}/api/health didn't "
                    f"respond ({exc}). Restart the UI or delete the lock "
                    f"file if the owning process is truly gone."
                ),
            },
        ) from exc
