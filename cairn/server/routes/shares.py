"""Report share links.

A share link is ``/share/<secret>``: 256 random bits, stored only as their
sha256, with a required expiry (30 days unless given) and revocable. The
viewer's page redeems the secret (``POST /api/share/redeem``, public and
rate-limited), which puts it in the HttpOnly ``cairn_share`` cookie; from
then on the browser is a share principal, admitted only to the routes in
``auth.SHARE_ALLOWED`` and only for the report's own runs
(``report_scope.py``). ``GET /api/share/context`` hands the viewer everything
the report page needs up front.

Creating, listing and revoking shares takes the write role. Share links need
auth: without it every request is already admitted, so creating one is a 400.
"""

from __future__ import annotations

import secrets
import threading
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from .. import auth
from ..storage.db import Database
from ..summary_rules import resolved_values
from ._common import api_run_row, get_db, utc_now
from .report_assets import require_report
from .reports import _parse_payload
from .runs import RUN_LIST_COLUMNS

router = APIRouter(prefix="/api", tags=["shares"])
#: Registered without the require_role dependency: redeeming is how a share
#: principal comes to exist.
public_router = APIRouter(prefix="/api", tags=["shares"])
_write = Depends(auth.require_role("write"))

DEFAULT_SHARE_DAYS = 30
#: Redeem attempts one client may make per window.
REDEEM_LIMIT = 10
REDEEM_WINDOW_S = 60.0


class RateLimiter:
    """At most ``limit`` events per ``window_s`` seconds per key (in memory)."""

    def __init__(self, limit: int = REDEEM_LIMIT, window_s: float = REDEEM_WINDOW_S) -> None:
        self.limit = limit
        self.window_s = window_s
        self._lock = threading.Lock()
        self._events: dict[str, deque[float]] = {}

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._events.setdefault(key, deque())
            while q and q[0] <= now - self.window_s:
                q.popleft()
            if len(q) >= self.limit:
                return False
            q.append(now)
            if len(self._events) > 10_000:  # bound memory: drop idle keys
                for k in [k for k, v in self._events.items() if not v]:
                    del self._events[k]
            return True


class ShareCreate(BaseModel):
    #: ISO timestamp; defaults to 30 days from now. Must lie in the future.
    expires_at: str | None = Field(default=None, max_length=64)


class RedeemRequest(BaseModel):
    secret: str = Field(max_length=512)


def _parse_expiry(raw: str | None) -> str:
    if raw is None:
        return (utc_now() + timedelta(days=DEFAULT_SHARE_DAYS)).isoformat()
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=422, detail="expires_at must be an ISO timestamp")
    dt = dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)
    if dt <= utc_now():
        raise HTTPException(status_code=422, detail="expires_at must lie in the future")
    return dt.isoformat()


def _share_row(r: dict[str, Any]) -> dict[str, Any]:
    now = utc_now().isoformat()
    status = "revoked" if r["revoked_at"] else "expired" if r["expires_at"] <= now else "active"
    return {
        "id": r["id"],
        "report_id": r["report_id"],
        "created_by": r["created_by"],
        "created_at": r["created_at"],
        "expires_at": r["expires_at"],
        "revoked_at": r["revoked_at"],
        "status": status,
    }


@router.post("/projects/{project_id}/reports/{report_id}/shares", dependencies=[_write])
def create_share(
    project_id: str, report_id: str, body: ShareCreate, request: Request,
) -> dict[str, Any]:
    """Mint a share link. The secret is returned here and never again."""
    if not getattr(request.app.state, "auth_enabled", False):
        raise HTTPException(
            status_code=400,
            detail="share links need auth; this server runs with --no-auth, "
                   "so anyone who can reach it can already read the report",
        )
    db = get_db(request)
    require_report(db, project_id, report_id)
    expires_at = _parse_expiry(body.expires_at)
    principal = auth.principal_from_request(request)
    share_id = secrets.token_hex(8)
    secret = auth.generate_secret(32)
    now = utc_now().isoformat()
    db.write(
        """INSERT INTO report_shares
               (id, report_id, secret_hash, created_by, created_at, expires_at, revoked_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL)""",
        [share_id, report_id, auth.hash_secret(secret),
         principal.name if principal else None, now, expires_at],
    )
    return {
        "id": share_id,
        "report_id": report_id,
        "secret": secret,
        "url": f"/share/{secret}",
        "created_at": now,
        "expires_at": expires_at,
    }


@router.get("/projects/{project_id}/reports/{report_id}/shares", dependencies=[_write])
def list_shares(project_id: str, report_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    require_report(db, project_id, report_id)
    rows = db.read_columns(
        """SELECT id, report_id, created_by, created_at, expires_at, revoked_at
             FROM report_shares WHERE report_id = ? ORDER BY created_at DESC""",
        [report_id],
    )
    return {"shares": [_share_row(r) for r in rows]}


@router.delete(
    "/projects/{project_id}/reports/{report_id}/shares/{share_id}", dependencies=[_write],
)
def revoke_share(
    project_id: str, report_id: str, share_id: str, request: Request,
) -> dict[str, Any]:
    """Revoke a link: every browser that redeemed it loses access at once."""
    db = get_db(request)
    require_report(db, project_id, report_id)
    with db.transaction() as con:
        cur = con.execute(
            """UPDATE report_shares SET revoked_at = ?
                WHERE id = ? AND report_id = ? AND revoked_at IS NULL""",
            [utc_now().isoformat(), share_id, report_id],
        )
        changed = cur.rowcount
    if not changed and db.read_one(
        "SELECT 1 FROM report_shares WHERE id = ? AND report_id = ?", [share_id, report_id],
    ) is None:
        raise HTTPException(status_code=404, detail="share not found")
    return {"revoked": share_id}


def _client_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@public_router.post("/share/redeem")
def redeem_share(body: RedeemRequest, request: Request, response: Response) -> dict[str, Any]:
    """Trade a link's secret for the ``cairn_share`` cookie."""
    if not request.app.state.share_redeem_limiter.allow(_client_key(request)):
        raise HTTPException(status_code=429, detail="too many attempts; try again in a minute")
    grant = auth.verify_share(get_db(request), body.secret)
    if grant is None:
        raise HTTPException(status_code=404, detail="this share link is invalid, expired or revoked")
    response.set_cookie(
        key=auth.SHARE_COOKIE,
        value=body.secret,
        httponly=True,
        samesite="lax",
        # Same posture as the login cookie: TLS is a reverse proxy's job.
        secure=False,
        max_age=auth.seconds_until(grant.expires_at),
        path="/",
    )
    return {"report_id": grant.report_id, "project_id": grant.project_id}


def _scope_runs(db: Database, run_ids: list[str]) -> list[dict[str, Any]]:
    if not run_ids:
        return []
    holes = ",".join("?" * len(run_ids))
    rows = db.read_columns(
        f"SELECT {RUN_LIST_COLUMNS} FROM runs WHERE id IN ({holes}) ORDER BY created_at DESC",
        run_ids,
    )
    values = resolved_values(db, [r["id"] for r in rows])
    for row in rows:
        api_run_row(row)
        row["values"] = values.get(row["id"], {})
    return rows


def _metric_index(db: Database, run_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    """Each run's sequence roster, as ``GET /api/runs/{id}/sequences`` lists it."""
    out: dict[str, list[dict[str, Any]]] = {rid: [] for rid in run_ids}
    if not run_ids:
        return out
    holes = ",".join("?" * len(run_ids))
    for r in db.read_columns(
        f"""SELECT run_id, name, MAX(object_type) AS object_type,
                   MIN(step) AS min_step, MAX(step) AS max_step, COUNT(*) AS count
              FROM sequences WHERE run_id IN ({holes})
             GROUP BY run_id, name ORDER BY run_id, name""",
        run_ids,
    ):
        out[r.pop("run_id")].append(r)
    return out


@router.get("/share/context")
def share_context(request: Request) -> dict[str, Any]:
    """The shared report, its in-scope runs (no environment) and their metric
    index. Only a share principal has a context."""
    grant = auth.request_share(request)
    if grant is None:
        raise HTTPException(status_code=404, detail="not a share link session")
    db = get_db(request)
    rows = db.read_columns(
        "SELECT id, project_id, name, created_at, updated_at, payload FROM reports WHERE id = ?",
        [grant.report_id],
    )
    if not rows:
        raise HTTPException(status_code=404, detail="report not found")
    r = rows[0]
    scope = auth.share_scope(request, grant)
    runs = _scope_runs(db, sorted(scope.run_ids))
    run_ids = [run["id"] for run in runs]
    return {
        "report": {
            "id": r["id"],
            "project_id": r["project_id"],
            "name": r["name"],
            "created_at": r["created_at"],
            "updated_at": r["updated_at"],
            "payload": _parse_payload(r["payload"]),
        },
        "expires_at": grant.expires_at,
        "runs": runs,
        "metric_index": _metric_index(db, run_ids),
        "source_run_ids": sorted(scope.source_run_ids & set(run_ids)),
    }
