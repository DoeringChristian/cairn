"""Python sugar for building live query URLs (``cairn.query_url``).

A *live query URL* is a stable server URL that always resolves to "the ``tag``
artifact of the latest (optionally filtered) run" — the thing a cairn-plot
report embeds so it shows the freshest data every time it opens
(``cp.Image(url=cairn.query_url("train/render"))``).

Two emission modes:

* ``live=True`` (default) — return the ``/api/query?...`` URL itself. It
  re-resolves server-side on every fetch (``Cache-Control: no-store``).
* ``live=False`` — resolve *once* now (via ``format=json``) and return the
  baked, immutable ``/api/artifacts/{digest}`` URL. Fully static/pinned.

Both require a **server** target: a live URL is only meaningful against a
running server, and baked resolution needs one to query. Against a local-only
(``.cairn/``) target, :func:`query_url` raises a clear error pointing at server
mode or baked reports.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlencode

from .. import config as _config

_LOCAL_ONLY_MSG = (
    "query_url needs a server target (there is no server to resolve against in "
    "local-only mode). Point at a running server — e.g. "
    "cairn.query_url(..., server='cairn://host:4300'), cairn.configure("
    "repo='cairn://host:4300'), or CAIRN_REPO — or bake a self-contained "
    "report instead."
)


def _server_base(server: str | None) -> str:
    """Resolve an HTTP base URL for the query, or raise on a local-only target."""
    if server:
        if server.startswith(("http://", "https://")):
            return server.rstrip("/")
        target = _config.resolve_target(repo=server)
    else:
        target = _config.resolve_target()
    if target.is_local:
        raise ValueError(_LOCAL_ONLY_MSG)
    return target.location.rstrip("/")


def _build_params(
    *, tag: str, run: str, name: str | None, project: str | None,
    step: str | int, filters: dict[str, Any],
) -> list[tuple[str, str]]:
    params: list[tuple[str, str]] = [("run", run), ("tag", tag)]
    if project is not None:
        params.append(("project", project))
    if name is not None:
        params.append(("name", name))
    if step != "latest":
        params.append(("step", str(step)))
    for key, value in filters.items():
        params.append((key, str(value)))
    return params


def build_query_url(
    base: str,
    *,
    tag: str,
    run: str = "latest",
    name: str | None = None,
    project: str | None = None,
    step: str | int = "latest",
    **filters: Any,
) -> str:
    """Assemble a ``{base}/api/query?...`` URL from a base and selector parts.

    Pure string builder (no I/O) — the shared core of :func:`query_url`,
    ``RunQuery.latest_url`` and ``DataRef.url``.
    """
    params = _build_params(
        tag=tag, run=run, name=name, project=project, step=step, filters=filters
    )
    return f"{base.rstrip('/')}/api/query?{urlencode(params)}"


def query_url(
    tag: str,
    *,
    run: str = "latest",
    name: str | None = None,
    project: str | None = None,
    live: bool = True,
    step: str | int = "latest",
    server: str | None = None,
    token: str | None = None,
    **filters: Any,
) -> str:
    """Build a live query URL for ``tag`` (see module docstring).

    Args:
        tag: The artifact / sequence name to resolve on the selected run.
        run: Run selector — ``latest`` (default), ``latest:N``,
            ``newest-per-name``, or ``id:<run_id>``.
        name: Display-name glob (``exp*``) / case-insensitive substring.
        project: Restrict to a project id.
        live: ``True`` → the re-resolving ``/api/query`` URL. ``False`` →
            resolve once and return the immutable digest URL.
        step: ``latest`` (highest step) or an explicit integer step.
        server: Explicit server (``cairn://host:port`` / ``http://...``).
            Defaults to the configured/env target.
        token: Bearer token for the one-shot ``live=False`` resolve.
        **filters: Django-style predicates, e.g. ``lr__gt=1e-4``,
            ``metrics__loss__lt=0.1`` (dotted ``metrics.loss__lt`` also works),
            ``tags__contains='best'``.

    Returns:
        The query URL (``live=True``) or the baked digest URL (``live=False``).
    """
    base = _server_base(server)
    url = build_query_url(
        base, tag=tag, run=run, name=name, project=project, step=step, **filters
    )
    if live:
        return url

    # Baked: resolve once via format=json and return the immutable digest URL.
    import httpx

    resolved_token = _config.resolve_token(token)
    headers = {"Authorization": f"Bearer {resolved_token}"} if resolved_token else {}
    params = _build_params(
        tag=tag, run=run, name=name, project=project, step=step, filters=filters
    )
    params.append(("format", "json"))
    resp = httpx.get(f"{base}/api/query", params=params, headers=headers, timeout=30.0)
    resp.raise_for_status()
    return f"{base}{resp.json()['url']}"
