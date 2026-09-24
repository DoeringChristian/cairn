"""Alert delivery and stale-run reaping: the server's periodic maintenance.

``ingest_ops`` only WRITES alert rows (``run.alert()``, a run finishing
``failed``/``killed``, a reaped run), because runs also finish with no server
up. The server's lifespan task (``app.py``) calls :func:`maintenance_cycle`
every few seconds: it reaps runs whose heartbeat stopped, then claims the
undelivered alerts and posts them to the configured webhook. Alerts written
while no server was up are delivered at the next server start.

The webhook payload depends on the host: ntfy (``ntfy.`` in the hostname)
gets a text body with ``Title``/``Priority`` headers, Slack incoming webhooks
``{text}``, Discord webhooks ``{content}``, anything else the alert as JSON.
"""

from __future__ import annotations

import base64
import json
import logging
import urllib.request
from typing import Any
from urllib.parse import urlsplit

from . import ingest_ops
from .routes._common import utc_now
from .storage.datadir import DataDir
from .storage.db import Database

_log = logging.getLogger(__name__)

#: A running run with no heartbeat for this long is marked killed. The SDK
#: heartbeats every 10 s.
STALE_HEARTBEAT_SECONDS = 120

WEBHOOK_TIMEOUT = 5.0

_NTFY_PRIORITY = {"info": "default", "warn": "high", "error": "urgent"}
_EMOJI = {"info": "ℹ️", "warn": "⚠️", "error": "🚨"}


def reap_stale_runs(db: Database, data_dir: DataDir | None = None) -> list[str]:
    """Mark running runs whose heartbeat is too old as killed; alert on each.

    Claims with ``UPDATE … RETURNING`` so two callers never reap (and alert)
    the same run twice. Also removes the reaped runs' WAL lock files so the
    ingester can do the final full drain. Returns the reaped run ids.
    """
    now = utc_now()
    with db.transaction() as con:
        rows = con.execute(
            """
            UPDATE runs SET status = 'killed', ended_at = ?
            WHERE status = 'running'
              AND julianday('now') - julianday(COALESCE(last_heartbeat, created_at))
                  > ? / 86400.0
            RETURNING id, display_name
            """,
            [now, STALE_HEARTBEAT_SECONDS],
        ).fetchall()
    for run_id, display_name in rows:
        ingest_ops.insert_alert(
            db, run_id,
            title=f"Run {display_name or run_id[:8]} killed",
            text=f"no heartbeat for {STALE_HEARTBEAT_SECONDS} s",
            level="warn",
        )
        if data_dir is not None:
            lock_path = data_dir.root / "wals" / f"{run_id}.lock"
            if lock_path.exists():
                lock_path.unlink(missing_ok=True)
                _log.info("removed stale WAL lock for killed run %s", run_id[:8])
    return [r[0] for r in rows]


def claim_undelivered(db: Database) -> list[dict[str, Any]]:
    """Mark every undelivered alert delivered and return them (with the run's
    name and project name), oldest first."""
    with db.transaction() as con:
        cur = con.execute(
            "UPDATE alerts SET delivered_at = ? WHERE delivered_at IS NULL RETURNING *",
            [utc_now().isoformat()],
        )
        cols = [d[0] for d in cur.description]
        alerts = [dict(zip(cols, row)) for row in cur.fetchall()]
    for a in alerts:
        rows = db.read_columns(
            "SELECT r.display_name, p.name AS project_name FROM runs r "
            "LEFT JOIN projects p ON p.id = r.project_id WHERE r.id = ?",
            [a["run_id"]],
        )
        a["run_name"] = rows[0]["display_name"] if rows else None
        a["project_name"] = rows[0]["project_name"] if rows else None
    return sorted(alerts, key=lambda a: a["created_at"])


def _header(value: str) -> str:
    """An HTTP header value: latin-1 as-is, otherwise RFC 2047 (ntfy decodes it)."""
    try:
        value.encode("latin-1")
        return value
    except UnicodeEncodeError:
        return "=?UTF-8?B?" + base64.b64encode(value.encode("utf-8")).decode() + "?="


def build_request(url: str, alert: dict[str, Any]) -> urllib.request.Request:
    """The webhook request for one alert, shaped for the webhook's host."""
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    project = alert.get("project_name") or alert["project_id"]
    title = f"[{project}] {alert['title']}"
    text = alert.get("text") or ""
    if host.startswith("ntfy.") or ".ntfy." in host:
        return urllib.request.Request(
            url, data=(text or alert["title"]).encode("utf-8"), method="POST",
            headers={
                "Title": _header(title),
                "Priority": _NTFY_PRIORITY.get(alert["level"], "default"),
                "Tags": alert["level"],
            },
        )
    if host == "hooks.slack.com":
        body: dict[str, Any] = {"text": f"{_EMOJI.get(alert['level'], '')} *{title}*\n{text}".strip()}
    elif host in ("discord.com", "discordapp.com") and parts.path.startswith("/api/webhooks"):
        body = {"content": f"{_EMOJI.get(alert['level'], '')} **{title}**\n{text}".strip()}
    else:
        body = {
            k: alert.get(k)
            for k in ("id", "run_id", "run_name", "project_id", "project_name",
                      "level", "title", "text", "created_at")
        }
    return urllib.request.Request(
        url, data=json.dumps(body).encode("utf-8"), method="POST",
        headers={"Content-Type": "application/json"},
    )


def post_alert(url: str, alert: dict[str, Any]) -> None:
    """Post one alert; failures are logged, never raised (the row stays claimed)."""
    try:
        with urllib.request.urlopen(build_request(url, alert), timeout=WEBHOOK_TIMEOUT) as resp:
            resp.read()
    except Exception as exc:  # noqa: BLE001
        _log.warning("alert webhook delivery failed for %s: %s", alert["id"], exc)


def maintenance_cycle(db: Database, data_dir: DataDir, webhook: str | None) -> int:
    """Reap stale runs, then deliver pending alerts. Blocking; run it off the
    event loop. Returns the number of alerts posted. Without a webhook the
    alerts stay undelivered (shown in the UI only)."""
    reap_stale_runs(db, data_dir)
    if not webhook:
        return 0
    alerts = claim_undelivered(db)
    for alert in alerts:
        post_alert(webhook, alert)
    return len(alerts)
