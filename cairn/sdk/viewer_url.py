"""Where a run's page renders: the base URL of the viewer for a target.

Shared by ``cairn open``, ``cairn report share`` and ``Run.url`` so they agree.
A ``cairn server --ui`` serves the API on its ingest port and the viewer on a
paired UI port; a local repo has a viewer only while a ``cairn ui`` (or
``cairn server --ui``) runs over it.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

#: The port `cairn ui` binds first (it moves up when that one is taken).
UI_DEFAULT_PORT = 4301


def viewer_base(t: Any, server: str) -> str | None:
    """The base URL where `server`'s viewer renders, or None if it serves none.

    A `cairn server --ui` ingest port answers `/` with the paired UI port; a
    server without the viewer answers with a no-viewer marker. Any failure to
    tell keeps `server`: a probe that cannot decide must not suppress the
    browser.
    """
    from urllib.parse import urlsplit, urlunsplit

    try:
        body = t.get("/").json()
    except Exception:  # noqa: BLE001
        return server
    if not isinstance(body, dict) or body.get("status") not in {"no_ui", "ingest"}:
        return server
    ui_port = body.get("ui_port")
    if not isinstance(ui_port, int):
        return None
    parts = urlsplit(server)
    host = parts.hostname or "localhost"
    netloc = f"[{host}]:{ui_port}" if ":" in host else f"{host}:{ui_port}"
    return urlunsplit((parts.scheme, netloc, parts.path, "", ""))


def local_viewer(root: Path) -> str | None:
    """The base URL of a running viewer over the local repo at `root`: a
    `cairn ui` listed in its `servers.json`, or the `cairn server --ui`
    holding its lock. None when none is running (or none answers)."""
    import httpx

    from ..server.storage.datadir import DataDir, read_live_servers

    candidates = [
        f"http://{e['host']}:{e['port']}" for e in read_live_servers(root)
        if e.get("host") and isinstance(e.get("port"), int)
    ]
    holder = DataDir(root).read_lock() or {}
    if holder.get("mode") in ("server", "ui") and holder.get("host") and isinstance(holder.get("port"), int):
        from .local import _holder_is_live

        if _holder_is_live(holder):
            candidates.append(f"http://{holder['host']}:{holder['port']}")
    for url in dict.fromkeys(candidates):
        try:
            with httpx.Client(base_url=url, timeout=2.0) as c:
                if c.get("/api/health").status_code != 200:
                    continue
                base = viewer_base(c, url)
        except httpx.HTTPError:
            continue
        if base is not None:
            return base.replace("127.0.0.1", "localhost", 1)
    return None


def run_page_url(transport: Any, server: str, path: str) -> str:
    """The URL of the page at ``path`` (``/p/<project>/r/<id>``), as
    ``cairn open`` prints it.

    A local repo (``server`` is ``file://<root>``): the viewer running over it,
    else the URL it will have once ``cairn ui`` starts on its default port. A
    server: its viewer (the paired UI port of a ``cairn server --ui`` ingest
    port), else the server itself.
    """
    if server.startswith("file://"):
        root = getattr(getattr(transport, "data_dir", None), "root", None)
        base = local_viewer(Path(root)) if root is not None else None
        base = base or f"http://localhost:{UI_DEFAULT_PORT}"
    else:
        # A short probe of its own: the run's transport retries a server that
        # is down, and asking for a URL must not stall the training loop.
        import httpx

        with httpx.Client(base_url=server, timeout=2.0) as probe:
            base = viewer_base(probe, server) or server
    return f"{base.rstrip('/')}{path}"
