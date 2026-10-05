"""Mount the cairn-ui viewer onto a FastAPI app.

FastAPI wiring only: every path and layout question is answered by
``cairn.viewer``. Both ``create_app(mount_ui=True)`` and the remote proxy go
through ``mount_viewer``, so ``proxy.py`` no longer reaches into ``app.py``
for a private helper.

Nothing here builds a path from a string literal — that is what keeps the
boundary check in ``tests/unit/test_package_boundaries.py`` a simple token scan.

Caching and compression matter here: the viewer is usually opened over a
network (``http://host:port``), and the bundle is megabytes of JavaScript.
Asset file names carry a content hash, so they are cached for a year as
immutable and sent gzipped (compressed once, kept in memory); the HTML shells
are ``no-cache`` so a new build is picked up on the next load.
"""

from __future__ import annotations

import gzip
import hashlib
import mimetypes
import threading
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

from .. import viewer

#: Hashed assets never change under the same name.
IMMUTABLE = "public, max-age=31536000, immutable"
#: The HTML shells name the current assets, so they are always revalidated.
NO_CACHE = "no-cache"
#: Formats that are already compressed (gzip would only cost CPU).
_PRECOMPRESSED = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".woff", ".woff2", ".gz", ".br", ".zip")


class _Asset:
    __slots__ = ("body", "gz", "etag", "media_type")

    def __init__(self, body: bytes, gz: bytes | None, etag: str, media_type: str) -> None:
        self.body = body
        self.gz = gz
        self.etag = etag
        self.media_type = media_type


class _AssetCache:
    """Assets read (and gzipped) once per process, on first request."""

    def __init__(self, root: Path) -> None:
        self._root = root.resolve()
        self._lock = threading.Lock()
        self._items: dict[str, _Asset | None] = {}

    def get(self, rel: str) -> _Asset | None:
        with self._lock:
            if rel in self._items:
                return self._items[rel]
        item = self._load(rel)
        with self._lock:
            self._items[rel] = item
        return item

    def _load(self, rel: str) -> _Asset | None:
        path = (self._root / rel).resolve()
        if self._root not in path.parents or not path.is_file():
            return None
        body = path.read_bytes()
        media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if media_type in ("application/javascript", "text/javascript"):
            media_type = "text/javascript; charset=utf-8"
        gz = None
        if len(body) >= 1024 and not path.name.lower().endswith(_PRECOMPRESSED):
            packed = gzip.compress(body, compresslevel=9, mtime=0)
            gz = packed if len(packed) < len(body) else None
        etag = '"' + hashlib.blake2b(body, digest_size=12).hexdigest() + '"'
        return _Asset(body, gz, etag, media_type)


def _accepts_gzip(request: Request) -> bool:
    return "gzip" in request.headers.get("accept-encoding", "").lower()


# The app's frames may only load the app itself (``'self'``, e.g. an
# ``/embed/card``) and blobs; ``srcdoc``/``about:blank`` frames need no
# source. The point is the sandboxed frames that run user code (custom
# viewers, logged HTML): a frame's navigation is checked against its
# PARENT's ``frame-src``, so a viewer that sets ``location`` to an outside URL
# (data in the query string) is refused before any request leaves. srcdoc
# frames inherit this policy too, so nested frames inside them are held to it
# as well. Only ``frame-src`` (not ``child-src``, which would also govern
# workers) and nothing else: scripts, styles, images and connections of the
# app are unaffected.
FRAME_CSP = "frame-src 'self' blob:"


def _html(content: bytes | str) -> Response:
    return Response(
        content=content,
        media_type="text/html",
        headers={"Cache-Control": NO_CACHE, "Content-Security-Policy": FRAME_CSP},
    )


def mount_viewer(app: FastAPI) -> bool:
    """Mount the SPA and its sibling shells, or a JSON placeholder at ``/``.

    Returns True when a real viewer was mounted. Shells are read ONCE here and
    closed over, so no request touches the filesystem; assets are read once,
    on first request.
    """
    assets = viewer.assets_dir()
    index_html = viewer.shell(viewer.INDEX)
    if index_html is None or assets is None:
        _mount_placeholder(app)
        return False

    cache = _AssetCache(Path(assets))

    # Static assets first (JS, CSS, images): immutable, gzipped when asked.
    @app.get("/assets/{rel:path}", include_in_schema=False)
    async def _asset(rel: str, request: Request) -> Response:
        item = cache.get(rel)
        if item is None:
            return JSONResponse({"detail": "not found"}, status_code=404)
        headers = {"Cache-Control": IMMUTABLE, "ETag": item.etag, "Vary": "Accept-Encoding"}
        if request.headers.get("if-none-match") == item.etag:
            return Response(status_code=304, headers=headers)
        if item.gz is not None and _accepts_gzip(request):
            headers["Content-Encoding"] = "gzip"
            return Response(content=item.gz, media_type=item.media_type, headers=headers)
        return Response(content=item.body, media_type=item.media_type, headers=headers)

    # The embed entry is a SEPARATE HTML bundle from the SPA, so it must be
    # registered BEFORE the catch-all below — otherwise it swallows it and
    # serves the full app shell instead.
    embed_html = viewer.shell(viewer.EMBED)
    if embed_html is not None:

        @app.get("/embed/card", include_in_schema=False)
        async def _embed_card() -> Response:
            return _html(embed_html)

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
        return _html(index_html)

    return True


def _mount_placeholder(app: FastAPI) -> None:
    @app.get("/", include_in_schema=False)
    def _no_ui() -> JSONResponse:
        return JSONResponse(
            {"status": "no_ui", "message": viewer.NOT_INSTALLED_HINT},
            status_code=200,
        )
