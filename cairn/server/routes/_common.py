"""Shared helpers for route modules."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, Request

from cairn.backend.progress import COLUMNS as PROGRESS_COLUMNS
from cairn.backend.progress import run_progress
from cairn.backend.storage.blobs import BlobStore
from cairn.backend.storage.datadir import DataDir
from cairn.backend.storage.db import Database




def get_db(request: Request) -> Database:
    return request.app.state.db


def get_data_dir(request: Request) -> DataDir:
    return request.app.state.data_dir


def get_blobs(request: Request) -> BlobStore:
    return request.app.state.blobs




def require_run(db: Database, run_id: str) -> dict[str, Any]:
    rows = db.read_columns("SELECT * FROM runs WHERE id = ?", [run_id])
    if not rows:
        raise HTTPException(status_code=404, detail=f"run {run_id} not found")
    return api_run_row(rows[0])







from cairn.backend.common import slugify, api_run_row, utc_now, parse_timestamp, value_type
