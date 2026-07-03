"""FastAPI application factory.

The app can be used in one of two modes:

* **Self-owned**: ``create_app(data_dir=...)`` creates a ``Database`` /
  ``BlobStore`` / ``DataDir`` internally in its lifespan. Fine for standalone
  use (``cairn ui`` or a single-server setup).
* **Shared**: ``create_app(db=..., blobs=..., data_dir=...)`` accepts
  pre-constructed instances and does NOT close the DB on shutdown. This lets
  ``cairn server`` run two FastAPI apps (ingest + UI) in the same process
  against ONE Database (DuckDB allows one connection per file).
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import auth as auth_core
from .routes import (
    artifact_registry,
    artifacts,
    auth as auth_routes,
    compare,
    comparison_templates,
    comparisons,
    health,
    import_export,
    ingest,
    logs,
    plugin_ws,
    projects,
    reports,
    runs,
    sequences,
    source,
)
from .storage.blobs import BlobStore
from .storage.datadir import DataDir, default_data_dir
from .storage.db import Database
from .wal_ingest import ingest_all

_log = logging.getLogger(__name__)


def create_app(
    data_dir: Path | None = None,
    *,
    db: Database | None = None,
    blobs: BlobStore | None = None,
    data_dir_obj: DataDir | None = None,
    mount_ui: bool = True,
    auth_enabled: bool = False,
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
        mount_ui: When True (default), mount the React SPA at ``/``. Set
            False on the ingest-only server in a dual-port deployment so the
            SPA is served exclusively by the UI app.
        auth_enabled: When True, every ``/api/*`` route except
            ``/api/health`` and ``/api/auth/*`` requires a Bearer token or
            session cookie (see ``cairn/server/auth.py``). Defaults to
            False so existing test fixtures (``tests/conftest.py``) and
            library callers of ``create_app()`` are unaffected; the CLI
            (``cairn server`` / ``cairn ui``) opts in unless ``--no-auth``.
    """
    owns_db = db is None
    if (db is None) != (blobs is None) or (db is None) != (data_dir_obj is None):
        raise ValueError(
            "create_app: db/blobs/data_dir_obj must be supplied together, or none at all"
        )
    resolved_dir = Path(data_dir) if data_dir is not None else default_data_dir()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if owns_db:
            dd = DataDir(resolved_dir)
            _db = Database.open(dd.db_path)
            _blobs = BlobStore(dd.artifacts_dir)
        else:
            assert data_dir_obj is not None
            dd = data_dir_obj
            _db = db  # type: ignore[assignment]
            _blobs = blobs  # type: ignore[assignment]
        app.state.data_dir = dd
        app.state.db = _db
        app.state.blobs = _blobs

        # Background WAL ingestion — polls every 2s for new per-run WAL files.
        _stop = asyncio.Event()

        async def _wal_ingestion_loop():
            while not _stop.is_set():
                try:
                    count = ingest_all(dd, _db, _blobs)
                    if count > 0:
                        _log.debug("WAL ingestion: %d ops", count)
                except Exception:  # noqa: BLE001
                    _log.exception("WAL ingestion cycle failed")
                try:
                    await asyncio.wait_for(_stop.wait(), timeout=2.0)
                    break  # stop was set
                except asyncio.TimeoutError:
                    pass  # normal — loop again

        task = asyncio.create_task(_wal_ingestion_loop())

        try:
            yield
        finally:
            _stop.set()
            task.cancel()
            if owns_db:
                _db.close()

    app = FastAPI(
        title="Cairn",
        description="Open-source ML experiment tracker.",
        version="0.1.0",
        lifespan=lifespan,
    )
    # Read by the auth dependency family (auth_core.require_role) and the
    # WS handshake gate (plugin_ws.py) on every request/connection. Set
    # before any router registration so it's never accessed unset.
    app.state.auth_enabled = auth_enabled

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

    # Read-role routers. A handful of these also carry individual
    # write-role overrides on their mutating routes (POST/PUT/PATCH/DELETE)
    # declared directly on the route decorator in the route module itself
    # (projects, comparisons, comparison_templates, artifact_registry) —
    # role hierarchy (admin > write > read) means a write/admin token still
    # satisfies the router-level read dependency, so stacking both
    # dependencies on the same route correctly requires write-or-above.
    for router in (
        health.router,
        projects.router,
        runs.router,
        sequences.router,
        artifacts.router,
        logs.router,
        source.router,
        compare.router,
        comparisons.router,
        comparison_templates.router,
        reports.router,
        artifact_registry.router,
    ):
        app.include_router(router, dependencies=[Depends(require("read"))])

    # Write-role routers (uniformly mutating — no read-only routes inside).
    for router in (ingest.router, import_export.router):
        app.include_router(router, dependencies=[Depends(require("write"))])

    # WebSocket: gates itself (session cookie only, checked before accept()
    # — see plugin_ws.py). A FastAPI Depends() can't run before accept() for
    # a websocket route, so this one is deliberately excluded from the
    # dependencies= loops above.
    app.include_router(plugin_ws.router)

    if mount_ui:
        _mount_spa_or_placeholder(app)
    else:
        @app.get("/", include_in_schema=False)
        def _ingest_root() -> JSONResponse:
            return JSONResponse(
                {
                    "status": "ingest",
                    "message": (
                        "Cairn ingest API is running here; UI lives on the "
                        "companion UI port."
                    ),
                },
                status_code=200,
            )

    return app


def _mount_spa_or_placeholder(app: FastAPI) -> None:
    """Mount the built React bundle with SPA-style fallback routing.

    Any request that isn't handled by an ``/api/*`` route and doesn't match
    a static asset in ``ui/dist/`` gets ``index.html`` so React Router can
    handle client-side routing (e.g. ``/p/demo/r/abc123/metrics``).
    """
    ui_dist = Path(__file__).resolve().parent.parent / "ui" / "dist"
    if (ui_dist / "index.html").exists():
        index_html = (ui_dist / "index.html").read_bytes()

        # Mount static assets first (JS, CSS, images, etc.)
        app.mount(
            "/assets",
            StaticFiles(directory=str(ui_dist / "assets")),
            name="ui-assets",
        )

        # SPA catch-all: serve index.html for any non-API, non-asset path.
        # Explicitly refuse anything under /api/ instead of falling through
        # to index.html — registration order alone (API routers registered
        # first) already prevents this for *known* /api/* routes, but a
        # typo'd or unregistered /api/* path would otherwise silently 200
        # with the HTML shell instead of a clean 404. All data lives behind
        # /api/*, so this path must never serve the SPA.
        @app.get("/{path:path}", include_in_schema=False)
        async def _spa_fallback(path: str) -> Response:
            from fastapi.responses import JSONResponse, Response

            # Case-insensitive: refuse /API/... too. No route matches an
            # uppercased /API/* today so there's no live data leak, but this
            # keeps the "shell never serves under the api namespace" invariant
            # airtight regardless of path casing.
            lowered = path.lower()
            if lowered == "api" or lowered.startswith("api/"):
                return JSONResponse({"detail": "not found"}, status_code=404)
            return Response(content=index_html, media_type="text/html")
    else:
        @app.get("/", include_in_schema=False)
        def _no_ui() -> JSONResponse:
            return JSONResponse(
                {
                    "status": "no_ui",
                    "message": (
                        "Cairn is running but the UI bundle is not present. "
                        "Build it with `cd ui-src && npm run build`, or use "
                        "the API at /api/."
                    ),
                },
                status_code=200,
            )
