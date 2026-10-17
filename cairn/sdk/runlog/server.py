"""Lazy lifecycle and artifact reads from the run's selected backend.

Local reads open the repo directly; remote reads use HTTP. No process is spawned.
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
        return self.server or f"local repo {self.repo}"

    def api(self) -> Any:
        """An HTTP ``Transport`` to the endpoint.

        Raises:
            ServerUnavailable: The endpoint cannot be resolved or reached.
        """
        if self._api is not None:
            return self._api
        from ..connect import open_writer
        try:
            self._api, _ = open_writer(self.server or self.repo, timeout=self._timeout)
        except Exception as exc:
            raise ServerUnavailable(f'cannot open {self.describe()}: {exc}') from exc
        return self._api

    def peek(self) -> Any | None:
        """A ``Transport`` to the endpoint if it is known to be up WITHOUT
        starting anything (an explicit server, or a repo's registered live
        server, ``<repo>/server.json``); else None."""
        if self._api is not None:
            return self._api
        if self._peek is not None:
            return self._peek
        if not self.server:
            return self.api()
        from ..transport import Transport
        self._peek = Transport(self.server, timeout=3.0, max_retries=1)
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
        return self._call(f'reading run {run_id}', lambda t: t.read_run(run_id))

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
