"""Reads a run needs from its server (the write path never does).

A ``cairn.Run`` writes only its run directory. A few things need the
server's answer: resuming or forking a run whose directory is not on this
machine, resolving an artifact ref, sweep trials, the run's version, stop
requests. ``ServerReads`` makes those calls over HTTP, resolving the
endpoint lazily (``cairn.endpoint.resolve_endpoint``, which may start a
repo's local server), and raises ``ServerUnavailable`` when it cannot.
``peek`` never starts anything: it is for background polling.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)


class ServerUnavailable(RuntimeError):
    """The run's server is needed for this and cannot be reached."""


class ServerReads:
    """Lazy HTTP reads against a run's endpoint: an explicit ``server`` URL,
    else the local ``repo``'s server."""

    def __init__(self, server: str | None, repo: str | None, *, timeout: float = 10.0) -> None:
        self.server = server
        self.repo = repo
        self._timeout = timeout
        self._api: Any = None
        self._peek: Any = None

    def describe(self) -> str:
        return self.server or f"the server of the repo {self.repo}"

    def api(self) -> Any:
        """An HTTP ``Transport`` to the endpoint.

        Raises:
            ServerUnavailable: The endpoint cannot be resolved or reached.
        """
        if self._api is not None:
            return self._api
        from ...endpoint import resolve_endpoint
        from ..transport import Transport

        try:
            ep = resolve_endpoint(server=self.server, repo=None if self.server else self.repo)
        except Exception as exc:  # noqa: BLE001
            raise ServerUnavailable(f"cannot reach {self.describe()}: {exc}") from None
        self._api = Transport(ep.url, timeout=self._timeout, token=ep.token)
        return self._api

    def peek(self) -> Any | None:
        """A ``Transport`` to the endpoint if it is known to be up WITHOUT
        starting anything (an explicit server, or a repo's registered live
        server, ``<repo>/server.json``); else None."""
        if self._api is not None:
            return self._api
        if self._peek is not None:
            return self._peek
        from ... import config
        from ..transport import Transport

        url: str | None = None
        token: str | None = None
        if self.server:
            url = self.server
        elif self.repo:
            info = _live_repo_server(Path(self.repo))
            if info is not None:
                url, token = info
        if url is None:
            return None
        self._peek = Transport(url, timeout=3.0, token=token or config.resolve_token(url))
        return self._peek

    def close(self) -> None:
        for t in (self._api, self._peek):
            if t is not None:
                try:
                    t.close()
                except Exception:  # noqa: BLE001
                    pass
        self._api = self._peek = None

    def _call(self, what: str, fn: Any) -> Any:
        import httpx

        try:
            return fn(self.api())
        except httpx.HTTPError as exc:
            raise ServerUnavailable(f"{what} needs {self.describe()}: {exc}") from None

    # ---- reads -------------------------------------------------------------------

    def run(self, run_id: str) -> dict[str, Any] | None:
        """``GET /api/runs/{id}`` (None: the server does not know the run)."""
        import httpx

        def get(t: Any) -> Any:
            try:
                return t.get(f"/api/runs/{run_id}").json()
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 404:
                    return None
                raise
        return self._call(f"reading run {run_id}", get)

    def sequences(self, run_id: str) -> list[dict[str, Any]]:
        return self._call(f"reading run {run_id}", lambda t: t.sequence_steps(run_id))


def run_state(body: dict[str, Any]) -> dict[str, Any]:
    """A ``GET /api/runs/{id}`` body -> what a reopening Run needs."""
    run = body.get("run") or {}
    tags = run.get("tags")
    if isinstance(tags, str):
        try:
            tags = json.loads(tags)
        except ValueError:
            tags = []
    return {
        "project_id": run.get("project_id"),
        "tags": list(tags or []),
        "version": run.get("version"),
        "status": run.get("status"),
        "stop_requested": run.get("stop_requested"),
        "config": body.get("config_doc") or {},
        "summary": body.get("summary_doc") or {},
    }


def _live_repo_server(repo: Path) -> tuple[str, str | None] | None:
    """``(url, token)`` of the live local server registered for ``repo`` in
    ``<repo>/server.json`` (spec §5: pid, port, token), else None."""
    try:
        info = json.loads((repo / "server.json").read_text())
    except (OSError, ValueError):
        return None
    if not isinstance(info, dict):
        return None
    pid = info.get("pid")
    if isinstance(pid, int):
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return None
        except PermissionError:
            pass
    url = info.get("url")
    if not url and isinstance(info.get("port"), int):
        url = f"http://{info.get('host') or '127.0.0.1'}:{info['port']}"
    return (str(url), info.get("token")) if url else None
