"""Shared helpers for route modules."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, Request

from ..progress import COLUMNS as PROGRESS_COLUMNS
from ..progress import run_progress
from ..storage.blobs import BlobStore
from ..storage.datadir import DataDir
from ..storage.db import Database


def slugify(value: str) -> str:
    """Lower-case, dash-separated, alnum+dash+dot only. Empty raises ValueError."""
    s = value.strip().lower()
    s = re.sub(r"[^a-z0-9._-]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    if not s:
        raise ValueError(f"Cannot slugify {value!r}")
    return s


def get_db(request: Request) -> Database:
    return request.app.state.db


def get_data_dir(request: Request) -> DataDir:
    return request.app.state.data_dir


def get_blobs(request: Request) -> BlobStore:
    return request.app.state.blobs


def api_run_row(row: dict[str, Any]) -> dict[str, Any]:
    """A ``runs`` row in API shape: the ``run_group`` column is the ``group``
    field (GROUP is a reserved word in SQL, so only the column is renamed).
    The progress columns become the one ``progress`` field (``progress.py``)."""
    if "run_group" in row:
        row["group"] = row.pop("run_group")
    if "archived_at" in row:
        row["archived"] = row["archived_at"] is not None
    # The documents are served decoded, under their own names (``config_doc``
    # / ``summary_doc``), only where asked for; never as raw columns.
    row.pop("config", None)
    row.pop("summary", None)
    if "total_steps" in row:
        row["progress"] = run_progress(row)
        for col in PROGRESS_COLUMNS:
            row.pop(col, None)
    return row


def require_run(db: Database, run_id: str) -> dict[str, Any]:
    rows = db.read_columns("SELECT * FROM runs WHERE id = ?", [run_id])
    if not rows:
        raise HTTPException(status_code=404, detail=f"run {run_id} not found")
    return api_run_row(rows[0])


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def parse_timestamp(value: str | datetime | None) -> datetime | None:
    """A caller-supplied timestamp as an aware UTC datetime (naive = UTC).

    Timestamps are stored the way ``utc_now()`` values are, so a supplied
    ``created_at`` sorts consistently with server-stamped ones.
    """
    if value is None:
        return None
    dt = value if isinstance(value, datetime) else datetime.fromisoformat(
        value.replace("Z", "+00:00")
    )
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def value_type(v: Any) -> str:
    """Map a Python JSON value to the ``params.value_type`` enum."""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, int):
        return "int"
    if isinstance(v, float):
        return "float"
    if isinstance(v, str):
        return "str"
    if isinstance(v, list):
        return "list"
    if isinstance(v, dict):
        return "dict"
    return "str"
