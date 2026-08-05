"""``GET /api/query`` — live query URLs.

Resolves a run/artifact *selector* (expressed as query params) to a concrete
content-addressed blob and either 302-redirects to the immutable
``/api/artifacts/{digest}`` endpoint (``format=raw``, the default) or returns a
small JSON envelope describing the resolution (``format=json``).

The endpoint re-resolves on every request and is marked ``Cache-Control:
no-store`` so a ``run=latest`` URL is always current on report open; the digest
it points at is immutable and cached forever (see ``routes/artifacts.py``).

Grammar and semantics live in :mod:`cairn.server.query_resolver` (pure,
HTTP-free, unit-tested directly).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse

from ..query_resolver import (
    QueryError,
    QueryNotFound,
    parse_query_params,
    resolve,
)
from ._common import get_db

router = APIRouter(prefix="/api", tags=["query"])

_NO_STORE = {"Cache-Control": "no-store"}


@router.get("/query")
def query(request: Request) -> Any:
    db = get_db(request)
    try:
        spec = parse_query_params(request.query_params.multi_items())
    except QueryError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        art = resolve(db, spec)
    except QueryNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if spec.fmt == "json":
        return JSONResponse(
            {
                "run_id": art.run_id,
                "digest": art.digest,
                "step": art.step,
                "mime_type": art.mime_type,
                "size": art.size,
                "url": f"/api/artifacts/{art.digest}",
            },
            headers=_NO_STORE,
        )
    return RedirectResponse(
        url=f"/api/artifacts/{art.digest}", status_code=302, headers=_NO_STORE
    )
