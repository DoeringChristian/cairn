"""Embed spec routes (WS-EMBED) — POST/GET a short-lived card spec by ``sid``.

The ``/embed/card`` HTML entry (served by ``app.py``) renders ONE viewer card
standalone in an iframe; it looks its card descriptor up here by ``?sid=``.

* ``POST /api/embed/specs`` — store a card spec, return a short ``sid``
  (content-hash idempotent, TTL'd; see ``cairn/server/embed_specs.py``).
* ``GET /api/embed/specs/{sid}`` — fetch a stored spec.

Both routes sit behind the router-level ``require_role("read")`` dependency
attached in ``app.py`` (same posture as the other ``/api`` data routes), so
``--no-auth`` mode is unaffected and auth-on mode is not weakened. The POST is
a read-role, idempotent, TTL'd render-cache seed (not persistent domain data),
so it deliberately does not carry the write-role override that the
comparisons/reports mutations do.

TODO(remote-embed): for cross-origin hosts this needs a per-sid capability
token in the URL + a ``--embed-origins`` CORS allowlist. Deferred to a later
security-reviewed follow-up — this route is LOCAL / SAME-ORIGIN only.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api/embed", tags=["embed"])


class EmbedSpecCreate(BaseModel):
    # A viewer card descriptor, e.g.
    # {"type": "scalar", "series": [{"runId": "...", "name": "loss",
    #  "context_hash": ""}]}. Kept as a free-form dict so the embed entry and
    # the viewer's card types stay the single source of truth for its shape.
    spec: dict[str, Any]


@router.post("/specs")
def create_embed_spec(body: EmbedSpecCreate, request: Request) -> dict[str, Any]:
    store = request.app.state.embed_specs
    sid = store.put(body.spec)
    return {"sid": sid}


@router.get("/specs/{sid}")
def get_embed_spec(sid: str, request: Request) -> dict[str, Any]:
    store = request.app.state.embed_specs
    spec = store.get(sid)
    if spec is None:
        raise HTTPException(status_code=404, detail="embed spec not found or expired")
    return {"sid": sid, "spec": spec}
