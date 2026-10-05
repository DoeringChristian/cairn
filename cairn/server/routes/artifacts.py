"""Blob read endpoint: fetch content-addressed bytes with Range support."""

from __future__ import annotations

import hashlib
import re
from urllib.parse import quote

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse

from ._common import get_blobs, get_db

router = APIRouter(prefix="/api", tags=["artifacts"])

_RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$")

# Content is addressed by SHA256 digest, so a given URL's bytes never change —
# safe to cache forever. This is the immutable half of the query-URL freshness
# contract (the /api/query resolver is Cache-Control: no-store). The viewer
# relies on it: stepping through media requests the same URL for the same
# bytes in every card, so after the first load each image comes from the
# browser cache. The digest doubles as a strong ETag, so a revalidation (a
# hard reload, or a cache that ignores `immutable`) is a bodiless 304.
_IMMUTABLE = "public, max-age=31536000, immutable"

#: On every response carrying stored (user-supplied) bytes: the browser never
#: sniffs a type other than the declared one, and a blob opened directly as a
#: document (an HTML file, a viewer's script) runs in an opaque-origin
#: sandbox — no scripts, no same-origin access to the API or cookies. Only
#: documents are affected: ``<img>``/``<video>``/``<audio>``, ``fetch`` and
#: downloads load as before.
UNTRUSTED_CONTENT_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox",
}


def _etag(digest: str) -> str:
    return f'"{digest}"'


def _etag_matches(if_none_match: str | None, digest: str) -> bool:
    """RFC 9110 weak comparison of an If-None-Match list against the digest's ETag."""
    if not if_none_match:
        return False
    tags = [t.strip() for t in if_none_match.split(",")]
    return any(t == "*" or t.removeprefix("W/") == _etag(digest) for t in tags)


@router.get("/artifacts/{digest}")
def get_artifact(
    digest: str,
    request: Request,
    range_header: str | None = Header(default=None, alias="range"),
    if_none_match: str | None = Header(default=None, alias="if-none-match"),
) -> Response:
    return serve_blob(request, digest, range_header=range_header, if_none_match=if_none_match)


def serve_blob(
    request: Request,
    digest: str,
    *,
    mime_type: str | None = None,
    filename: str | None = None,
    range_header: str | None = None,
    if_none_match: str | None = None,
) -> Response:
    """A content-addressed blob's bytes (Range and If-None-Match aware).

    ``mime_type`` overrides the stored one; ``filename`` adds an inline
    ``Content-Disposition`` naming it.
    """
    db = get_db(request)
    blobs = get_blobs(request)
    rows = db.read_columns(
        "SELECT mime_type, size_bytes FROM artifacts WHERE hash = ?", [digest]
    )
    if not rows:
        raise HTTPException(status_code=404, detail="artifact not found")
    mime_type = mime_type or rows[0]["mime_type"]
    total_size = rows[0]["size_bytes"]
    cache_headers = {"Cache-Control": _IMMUTABLE, "ETag": _etag(digest), **UNTRUSTED_CONTENT_HEADERS}
    if filename:
        cache_headers["Content-Disposition"] = f"inline; filename*=UTF-8''{quote(filename)}"

    # A validator the client already holds names these exact bytes.
    if _etag_matches(if_none_match, digest):
        return Response(status_code=304, headers=cache_headers)

    if range_header:
        m = _RANGE_RE.match(range_header)
        if not m:
            raise HTTPException(status_code=416, detail="bad Range")
        start_s, end_s = m.groups()
        start = int(start_s) if start_s else 0
        # A last byte past the end means "to the end" (RFC 9110 14.1.2).
        end = min(int(end_s), total_size - 1) if end_s else total_size - 1
        if start < 0 or start >= total_size or start > end:
            raise HTTPException(status_code=416, detail="range not satisfiable")
        length = end - start + 1
        fh = blobs.open_stream(digest)
        fh.seek(start)

        def iterator(fh=fh, remaining=length):
            try:
                while remaining > 0:
                    chunk = fh.read(min(65536, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk
            finally:
                fh.close()

        headers = {
            "Content-Range": f"bytes {start}-{end}/{total_size}",
            "Content-Length": str(length),
            "Accept-Ranges": "bytes",
            **cache_headers,
        }
        return StreamingResponse(
            iterator(), status_code=206, headers=headers, media_type=mime_type
        )

    # Full body
    data, _meta = blobs.get(digest)
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(len(data)),
        **cache_headers,
    }
    return Response(content=data, media_type=mime_type, headers=headers)


# ---------------------------------------------------------------------------
# Logged HTML as its own document
# ---------------------------------------------------------------------------

#: The sandbox a logged HTML document runs in (``cairn.Html``, an ``.html``
#: file). Like ``wandb.Html``, it may run scripts and load anything from
#: anywhere — CDN scripts, images, external iframes — so it has no
#: ``frame-src``/``script-src``/``img-src`` restriction. What it never gets is
#: cairn's origin: without ``allow-same-origin`` the document has an opaque
#: origin, so no cookies, no storage and no readable API responses of cairn.
#: Links may open in a new tab (``allow-popups``) as an ordinary page
#: (``allow-popups-to-escape-sandbox``: an external site works there, and
#: cairn opened that way is just cairn, logged in as the user). Not granted:
#: ``allow-same-origin`` (the document would BE cairn), ``allow-top-navigation``
#: (it could replace the app), ``allow-forms`` (form posts), ``allow-modals``.
#: Its own navigation is still held to the app shell's ``frame-src 'self'
#: blob:`` (ui_mount.FRAME_CSP), which checks a frame's navigation against its
#: parent. The iframe (HtmlViewer.tsx) sets the same sandbox attribute.
#:
#: Known limit: sandbox flags are inherited by nested frames, so an embedded
#: YouTube player (which needs its own origin) stays black; plain external
#: pages, scripts and images work.
HTML_DOC_SANDBOX = "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox"

#: Posts the document's height to the host (``cairn:resize``, read by the
#: UI's card-kit/use-iframe-auto-height). Re-posts on a short fixed schedule
#: after ``load`` because a frame's layout may settle after the first
#: ResizeObserver callback; measures ``document.body`` (``documentElement``'s
#: scrollHeight is clamped to the viewport, so a frame could never shrink)
#: plus the body's margins.
RESIZE_SHIM = (
    "<script>(function(){function height(){var b=document.body;"
    "if(!b)return Math.ceil(document.documentElement.getBoundingClientRect().height);"
    "var m=0;try{var s=getComputedStyle(b);m=(parseFloat(s.marginTop)||0)+(parseFloat(s.marginBottom)||0)}catch(e){}"
    "return Math.ceil(Math.max(b.scrollHeight,b.offsetHeight)+m)}"
    "function post(){try{parent.postMessage({type:\"cairn:resize\",height:height(),protocolVersion:1},\"*\")}catch(e){}}"
    "try{new ResizeObserver(post).observe(document.body||document.documentElement)}catch(e){}"
    "try{new MutationObserver(post).observe(document.body||document.documentElement,{childList:true,subtree:true})}catch(e){}"
    "window.addEventListener(\"load\",function(){post();[0,100,300,1000].forEach(function(d){setTimeout(post,d)})});"
    "post();})();</script>"
)
#: Part of every HTML document's ETag: a new shim invalidates cached copies.
_SHIM_TAG = hashlib.blake2b(f"{HTML_DOC_SANDBOX}\n{RESIZE_SHIM}".encode(), digest_size=4).hexdigest()

_BODY_END = re.compile(r"</body>", re.IGNORECASE)
_HTML_END = re.compile(r"</html>", re.IGNORECASE)


def inject_resize_shim(html: str) -> str:
    """``html`` with the resize shim before ``</body>`` (else ``</html>``, else at the end)."""
    for pattern in (_BODY_END, _HTML_END):
        m = pattern.search(html)
        if m:
            return html[: m.start()] + RESIZE_SHIM + html[m.start():]
    return html + RESIZE_SHIM


@router.get("/artifacts/{digest}/html")
def get_artifact_html(
    digest: str,
    request: Request,
    max_bytes: int | None = Query(default=None, ge=1),
    if_none_match: str | None = Header(default=None, alias="if-none-match"),
) -> Response:
    """A stored HTML file as its own sandboxed document (the HTML card's frame).

    ``max_bytes`` serves only the head of a big file. The document gets the
    resize shim and ``HTML_DOC_SANDBOX``; it is revalidated (``no-cache``)
    against an ETag naming the bytes, the cut and the shim.
    """
    db = get_db(request)
    rows = db.read_columns("SELECT size_bytes FROM artifacts WHERE hash = ?", [digest])
    if not rows:
        raise HTTPException(status_code=404, detail="artifact not found")
    total = rows[0]["size_bytes"]
    cut = max_bytes is not None and total is not None and total > max_bytes
    etag = f'"{digest}.{_SHIM_TAG}{f".{max_bytes}" if cut else ""}"'
    headers = {
        "Cache-Control": "no-cache",
        "ETag": etag,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": HTML_DOC_SANDBOX,
    }
    if if_none_match and any(t.strip().removeprefix("W/") == etag for t in if_none_match.split(",")):
        return Response(status_code=304, headers=headers)
    blobs = get_blobs(request)
    if cut:
        with blobs.open_stream(digest) as fh:
            data = fh.read(max_bytes)
    else:
        data, _meta = blobs.get(digest)
    # A cut may split a multi-byte character: drop the partial tail.
    text = data.decode("utf-8", errors="ignore" if cut else "replace")
    return Response(content=inject_resize_shim(text), media_type="text/html; charset=utf-8", headers=headers)
