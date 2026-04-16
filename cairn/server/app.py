"""FastAPI application factory."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .routes import (
    artifacts,
    compare,
    health,
    ingest,
    logs,
    projects,
    runs,
    sequences,
    source,
)
from .storage.blobs import BlobStore
from .storage.datadir import DataDir, default_data_dir
from .storage.db import Database


def create_app(data_dir: Path | None = None) -> FastAPI:
    """Build a FastAPI app bound to a data directory.

    The app owns a ``Database`` and ``BlobStore`` for its lifetime; they are
    created on startup and closed on shutdown.
    """
    resolved_dir = Path(data_dir) if data_dir is not None else default_data_dir()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        dd = DataDir(resolved_dir)
        db = Database.open(dd.db_path)
        blobs = BlobStore(dd.artifacts_dir)
        app.state.data_dir = dd
        app.state.db = db
        app.state.blobs = blobs
        try:
            yield
        finally:
            db.close()

    app = FastAPI(
        title="Cairn",
        description="Open-source ML experiment tracker.",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Range", "Content-Length", "Accept-Ranges"],
    )

    for router in (
        health.router,
        ingest.router,
        projects.router,
        runs.router,
        sequences.router,
        artifacts.router,
        logs.router,
        source.router,
        compare.router,
    ):
        app.include_router(router)

    # Mount UI if a pre-built bundle exists; otherwise return a friendly JSON.
    ui_dist = Path(__file__).resolve().parent.parent / "ui" / "dist"
    if (ui_dist / "index.html").exists():
        app.mount("/", StaticFiles(directory=str(ui_dist), html=True), name="ui")
    else:
        @app.get("/", include_in_schema=False)
        def _no_ui() -> JSONResponse:
            return JSONResponse(
                {
                    "status": "no_ui",
                    "message": (
                        "Cairn server is running but the UI bundle is not "
                        "present. API is available at /api/."
                    ),
                },
                status_code=200,
            )

    return app
