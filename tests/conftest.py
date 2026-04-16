"""Shared pytest fixtures for Cairn tests."""

from __future__ import annotations

import socket
import threading
import time
from pathlib import Path

import pytest
import uvicorn
from fastapi.testclient import TestClient

from cairn.server.app import create_app
from cairn.server.storage.blobs import BlobStore
from cairn.server.storage.datadir import DataDir
from cairn.server.storage.db import Database


@pytest.fixture
def data_dir(tmp_path) -> DataDir:
    return DataDir(tmp_path / "cairn")


@pytest.fixture
def fresh_db(data_dir: DataDir):
    db = Database.open(data_dir.db_path)
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def blob_store(data_dir: DataDir) -> BlobStore:
    return BlobStore(data_dir.artifacts_dir)


@pytest.fixture
def app(tmp_path):
    return create_app(data_dir=tmp_path / "cairn")


@pytest.fixture
def client(app):
    with TestClient(app) as c:
        yield c


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def live_server(app):
    """Start uvicorn on an ephemeral port in a background thread.

    Required when tests use a sync ``httpx.Client`` to talk to the app
    (``ASGITransport`` only supports async). Yields the base URL.
    """
    port = _find_free_port()
    config = uvicorn.Config(
        app=app,
        host="127.0.0.1",
        port=port,
        log_level="warning",
        lifespan="on",
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    # Wait for readiness
    deadline = time.time() + 10
    while time.time() < deadline and not server.started:
        time.sleep(0.02)
    if not server.started:
        raise RuntimeError("uvicorn failed to start within 10s")
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(timeout=10)
