"""FastAPI application factory.

The app can be used in one of two modes:

* **Self-owned**: ``create_app(data_dir=...)`` creates a ``Database`` /
  ``BlobStore`` / ``DataDir`` internally in its lifespan. Fine for standalone
  use (``cairn ui`` or a single-server setup).
* **Shared**: ``create_app(db=..., blobs=..., data_dir=...)`` accepts
  pre-constructed instances and does NOT close the DB on shutdown. This lets
  ``cairn server`` run two FastAPI apps (ingest + UI) in the same process
  against ONE Database (one shared SQLite connection per file).
"""

from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.datastructures import Headers
from starlette.middleware.gzip import GZipResponder
from fastapi.responses import JSONResponse

from .. import __version__
from . import alerts as alerts_core
from . import auth as auth_core
from .embed_specs import EmbedSpecStore
from .report_scope import ScopeCache
from .routes import (
    admin,
    alerts,
    artifact_registry,
    artifacts,
    auth as auth_routes,
    compare,
    embed,
    health,
    import_export,
    ingest,
    logs,
    metric_rules as metric_rules_routes,
    project_docs,
    projects,
    query,
    records,
    report_assets,
    report_comments,
    report_templates,
    reports,
    runs,
    sequences,
    series_buckets,
    shares,
    source,
    sweeps,
    viewers,
)
from .ui_mount import mount_viewer
from .storage.blobs import BlobStore
from .storage.datadir import DataDir, default_data_dir
from .storage.db import Database
from .record_apply import mark_crashed
from .startup import open_repo_database

_log = logging.getLogger(__name__)

#: Seconds between two maintenance cycles (stale runs, alert delivery).
MAINTENANCE_INTERVAL = 5.0


class _JsonGZipResponder(GZipResponder):
    """Starlette's gzip responder, applied to JSON bodies only: blobs (images,
    video, archives) are already compressed, and a byte range must stay a
    byte range of the stored file."""

    async def send_with_compression(self, message) -> None:
        if message["type"] == "http.response.start":
            ctype = Headers(raw=message["headers"]).get("content-type", "")
            await super().send_with_compression(message)
            if not ctype.startswith("application/json"):
                self.content_type_is_excluded = True
            return
        await super().send_with_compression(message)


class _JsonGZip:
    """ASGI middleware: gzip JSON responses of 4 KB or more for clients that
    accept it, at level 1 (~3 ms per MB, a sequence shrinks about 4x): what
    matters over a network link, nearly free on loopback."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http" or "gzip" not in Headers(scope=scope).get("accept-encoding", ""):
            await self.app(scope, receive, send)
            return
        await _JsonGZipResponder(self.app, minimum_size=4096, compresslevel=1)(scope, receive, send)


class _Activity:
    """ASGI middleware: the time of the last API request and the number in
    flight (``app.state.activity``), for a daemon server's idle exit. Health
    probes do not count: they only ask whether the server is there."""

    def __init__(self, app, state) -> None:
        self.app = app
        self.state = state

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http" or scope.get("path") == "/api/health":
            await self.app(scope, receive, send)
            return
        activity = self.state.activity
        activity["in_flight"] += 1
        activity["last"] = time.monotonic()
        try:
            await self.app(scope, receive, send)
        finally:
            activity["in_flight"] -= 1
            activity["last"] = time.monotonic()


class _NoReferrer:
    """ASGI middleware: ``Referrer-Policy: no-referrer`` on every HTTP response."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def _send(message) -> None:
            if message["type"] == "http.response.start":
                message.setdefault("headers", [])
                message["headers"] = [
                    (k, v) for k, v in message["headers"] if k.lower() != b"referrer-policy"
                ] + [(b"referrer-policy", b"no-referrer")]
            await send(message)

        await self.app(scope, receive, _send)


def create_app(
    data_dir: Path | None = None,
    *,
    db: Database | None = None,
    blobs: BlobStore | None = None,
    data_dir_obj: DataDir | None = None,
    mount_ui: bool = False,
    auth_enabled: bool = False,
    background_tasks: bool = True,
    alert_webhook: str | None = None,
) -> FastAPI:
    """Build a FastAPI app.

    Args:
        data_dir: Path to a ``.cairn/`` directory. Used only when ``db``/
            ``blobs``/``data_dir_obj`` are not supplied; this path creates
            them inside the app's lifespan.
        db: Optional pre-constructed ``Database``. When supplied, the app
            does NOT close it on shutdown — ownership stays with the caller.
        blobs: Optional pre-constructed ``BlobStore`` (paired with ``db``).
        data_dir_obj: Optional pre-constructed ``DataDir`` (paired with
            ``db``). Used by the ingest/UI route helpers.
        mount_ui: Mount the browser viewer at ``/``. Defaults to False: the
            viewer is a separate, optionally-installed distribution
            (``pip install 'cairn-track[ui]'``), so a server is API-only
            unless a caller asks for it. ``cairn ui`` and ``cairn server --ui``
            opt in. When True but no viewer is installed, ``/`` serves the
            ``no_ui`` placeholder rather than failing.
        auth_enabled: When True, every ``/api/*`` route except
            ``/api/health`` and ``/api/auth/*`` requires a Bearer token or
            session cookie (see ``cairn/server/auth.py``). Defaults to
            False so existing test fixtures (``tests/conftest.py``) and
            library callers of ``create_app()`` are unaffected; the CLI
            (``cairn server`` / ``cairn ui``) opts in unless ``--no-auth``.
        background_tasks: Run the lifespan's background loops (crashed and
            stale-run reaping, alert delivery, a daemon's idle exit).
            Exactly one app per repo may run them: ``cairn server --ui``
            builds a second app on the same DB and passes False for it.
        alert_webhook: URL the background task posts alerts to (ntfy, Slack,
            Discord, or any JSON webhook; see ``cairn/server/alerts.py``).
            None keeps alerts in the UI only.
    """
    owns_db = db is None
    if (db is None) != (blobs is None) or (db is None) != (data_dir_obj is None):
        raise ValueError(
            "create_app: db/blobs/data_dir_obj must be supplied together, or none at all"
        )
    resolved_dir = Path(data_dir) if data_dir is not None else default_data_dir()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        dd = DataDir(resolved_dir) if owns_db else data_dir_obj
        assert dd is not None
        if owns_db:
            _blobs = BlobStore(dd.artifacts_dir)
            _db = open_repo_database(dd, _blobs)
        else:
            _db = db  # type: ignore[assignment]
            _blobs = blobs  # type: ignore[assignment]
        app.state.data_dir = dd
        # Names this server's browser cookies (see auth.server_id).
        app.state.server_id = auth_core.server_id(dd.root)
        app.state.db = _db
        app.state.blobs = _blobs
        _stop = asyncio.Event()

        def _maintenance() -> None:
            mark_crashed(_db)
            alerts_core.maintenance_cycle(_db, alert_webhook)

        # Crashed/stale-run reaping + alert delivery.
        async def _maintenance_loop():
            while not _stop.is_set():
                try:
                    await asyncio.to_thread(_maintenance)
                except Exception:  # noqa: BLE001
                    _log.exception("maintenance cycle failed")
                try:
                    await asyncio.wait_for(_stop.wait(), timeout=MAINTENANCE_INTERVAL)
                    break
                except asyncio.TimeoutError:
                    pass

        # A daemon server (``cairn server --daemon``) exits once idle.
        async def _idle_loop(timeout: float):
            while not _stop.is_set():
                try:
                    await asyncio.wait_for(_stop.wait(), timeout=min(30.0, timeout / 4))
                    break
                except asyncio.TimeoutError:
                    pass
                activity = app.state.activity
                idle = time.monotonic() - activity["last"]
                if activity["in_flight"] == 0 and idle > timeout:
                    _log.warning("cairn: idle for %.0f s; the daemon server exits", idle)
                    shutdown = getattr(app.state, "request_shutdown", None)
                    if shutdown is not None:
                        shutdown()
                    return

        tasks: list[asyncio.Task] = []
        if background_tasks:
            tasks.append(asyncio.create_task(_maintenance_loop()))
            idle_timeout = getattr(app.state, "idle_timeout", None)
            if idle_timeout:
                tasks.append(asyncio.create_task(_idle_loop(float(idle_timeout))))

        try:
            yield
        finally:
            _stop.set()
            for task in tasks:
                task.cancel()
            if owns_db:
                _db.close()

    app = FastAPI(
        title="Cairn",
        description="Open-source ML experiment tracker.",
        version=__version__,
        lifespan=lifespan,
    )
    # Read by the auth dependency family (auth_core.require_role) and the
    # before any router registration so it's never accessed unset.
    app.state.auth_enabled = auth_enabled
    app.state.alert_webhook = alert_webhook
    # Short-lived, in-memory store for /embed/card specs. Created
    # per-app so it shares the app's lifetime; specs are throwaway render
    # inputs, not persisted domain data. See cairn/server/embed_specs.py.
    app.state.embed_specs = EmbedSpecStore()
    # Share links: each share's live report scope (cached 30 s) and the
    # per-client limit on redeem attempts. See routes/shares.py.
    app.state.share_scopes = ScopeCache()
    app.state.share_redeem_limiter = shares.RateLimiter()
    # See _Activity; ``idle_timeout`` (seconds) and ``request_shutdown`` (a
    # callable stopping the HTTP server) are set by ``cairn server --daemon``.
    app.state.activity = {"last": time.monotonic(), "in_flight": 0}
    app.state.idle_timeout = None
    app.state.request_shutdown = None
    app.state.daemon = False

    # No page or API response may leak its URL (a share link's secret sits in
    # one) to another origin through the Referer header.
    app.add_middleware(_NoReferrer)
    app.add_middleware(_Activity, state=app.state)
    app.add_middleware(_JsonGZip)

    app.add_middleware(
        CORSMiddleware,
        # Auth-enabled mode: same-origin posture only. The SPA is served by
        # this same app, so the UI never needs cross-origin API access; an
        # empty allow_origins list blocks it outright (no wildcard+credentials
        # combination, ever). Auth-off mode keeps the pre-auth wildcard
        # default so today's dev/CI workflows (and existing tests) are
        # unaffected.
        allow_origins=[] if auth_enabled else ["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Range", "Content-Length", "Accept-Ranges"],
    )

    require = auth_core.require_role

    # Exempt: no dependency attached. /api/health is a liveness probe;
    # /api/auth/* is how you obtain credentials in the first place.
    app.include_router(health.public_router)
    app.include_router(auth_routes.router)
    # Redeeming a share link is how a share principal comes to exist.
    app.include_router(shares.public_router)

    # Read-role routers. A handful of these also carry individual
    # write-role overrides on their mutating routes (POST/PUT/PATCH/DELETE)
    # declared directly on the route decorator in the route module itself
    # (projects, project_docs, reports,
    # report_assets, report_comments, report_templates, artifact_registry) —
    # role hierarchy (admin > write > read) means a write/admin token still
    # satisfies the router-level read dependency, so stacking both
    # dependencies on the same route correctly requires write-or-above.
    for router in (
        health.router,
        projects.router,
        project_docs.router,
        runs.router,
        sequences.router,
        series_buckets.router,
        artifacts.router,
        query.router,
        logs.router,
        source.router,
        compare.router,
        reports.router,
        report_assets.router,
        report_comments.router,
        report_templates.router,
        shares.router,
        artifact_registry.router,
        embed.router,
        alerts.router,
        sweeps.router,
        viewers.router,
        metric_rules_routes.router,
    ):
        app.include_router(router, dependencies=[Depends(require("read"))])

    # Write-role routers (uniformly mutating — no read-only routes inside).
    for router in (ingest.router, records.router, import_export.router, admin.router):
        app.include_router(router, dependencies=[Depends(require("write"))])

    if mount_ui:
        mount_viewer(app)
    else:
        @app.get("/", include_in_schema=False)
        def _ingest_root() -> JSONResponse:
            # ``ui_port``: the paired viewer's port when `cairn server --ui`
            # runs one (set on app.state by the CLI), so `cairn open` can
            # print a URL that renders.
            return JSONResponse(
                {
                    "status": "ingest",
                    "message": (
                        "Cairn ingest API is running here; UI lives on the "
                        "companion UI port."
                    ),
                    "ui_port": getattr(app.state, "ui_port", None),
                },
                status_code=200,
            )

    return app
