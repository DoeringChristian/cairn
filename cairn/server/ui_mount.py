"""Mount the cairn-ui viewer onto a FastAPI app.

FastAPI wiring only: every path and layout question is answered by
:mod:`cairn.viewer`. Both ``create_app(mount_ui=True)`` and the remote proxy go
through :func:`mount_viewer`, so ``proxy.py`` no longer reaches into ``app.py``
for a private helper.

Nothing here builds a path from a string literal — that is what keeps the
boundary check in ``tests/unit/test_package_boundaries.py`` a simple token scan.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.responses import JSONResponse, Response

from .. import viewer


def mount_viewer(app: FastAPI, *, disable_webgpu: bool = False) -> bool:
    """Mount the SPA and its sibling shells, or a JSON placeholder at ``/``.

    Returns True when a real viewer was mounted. Shells are read ONCE here and
    closed over, so no request touches the filesystem.
    """
    from fastapi.staticfiles import StaticFiles

    assets = viewer.assets_dir()
    index_html = viewer.shell("index.html", disable_webgpu=disable_webgpu)
    if index_html is None or assets is None:
        _mount_placeholder(app)
        return False

    # Static assets first (JS, CSS, images).
    app.mount("/assets", StaticFiles(directory=str(assets)), name="ui-assets")

    # WS-EMBED and the standalone cairn-plot entry are SEPARATE HTML bundles
    # from the SPA, so both must be registered BEFORE the catch-all below —
    # otherwise it swallows them and serves the full app shell instead.
    embed_html = viewer.shell("embed.html", disable_webgpu=disable_webgpu)
    if embed_html is not None:

        @app.get("/embed/card", include_in_schema=False)
        async def _embed_card() -> Response:
            return Response(content=embed_html, media_type="text/html")

    plot_html = viewer.shell("plot.html", disable_webgpu=disable_webgpu)
    if plot_html is not None:

        @app.get("/plot", include_in_schema=False)
        async def _plot() -> Response:
            return Response(content=plot_html, media_type="text/html")

    # SPA catch-all: serve index.html for any non-API, non-asset path so the
    # client-side router can handle it. Explicitly refuse anything under /api/
    # rather than falling through — registration order already covers *known*
    # /api/* routes, but a typo'd one would otherwise 200 with the HTML shell
    # instead of a clean 404. Case-insensitive, so /API/... is refused too.
    @app.get("/{path:path}", include_in_schema=False)
    async def _spa_fallback(path: str) -> Response:
        lowered = path.lower()
        if lowered == "api" or lowered.startswith("api/"):
            return JSONResponse({"detail": "not found"}, status_code=404)
        return Response(content=index_html, media_type="text/html")

    return True


def _mount_placeholder(app: FastAPI) -> None:
    @app.get("/", include_in_schema=False)
    def _no_ui() -> JSONResponse:
        return JSONResponse(
            {"status": "no_ui", "message": viewer.NOT_INSTALLED_HINT},
            status_code=200,
        )
