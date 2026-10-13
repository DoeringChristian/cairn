"""Shared pytest fixtures for Cairn tests."""

from __future__ import annotations

import os
import socket
import tempfile
import threading
import time
from pathlib import Path

import pytest
import uvicorn
from fastapi.testclient import TestClient

import cairn.server.app as _app_mod
from tests import standin_server

# TEST-ONLY (client branch; see tests/standin_server.py): every app a test
# builds also speaks the 0.6 ingestion protocol. Patched before any test
# module imports create_app.
_real_create_app = _app_mod.create_app


def _create_app_with_ingest(*args, **kwargs):
    from fastapi import Depends

    from cairn.server.auth import require_role

    app = _real_create_app(*args, **kwargs)
    # Write role, like the real upload routes.
    app.include_router(standin_server.ingest_router(),
                       dependencies=[Depends(require_role("write"))])
    return app


_app_mod.create_app = _create_app_with_ingest
create_app = _create_app_with_ingest
from cairn.server.storage.blobs import BlobStore
from cairn.server.storage.datadir import DataDir
from cairn.server.storage.db import Database

# No test may open a browser tab on the developer's machine: Python's
# `webbrowser` runs $BROWSER when it is set, here a no-op command. Set at
# import, so every subprocess a test starts (a real `cairn ui`, `cairn open`)
# inherits it too.
os.environ["BROWSER"] = "true"

# Nor write into the developer's real cairn cache (unsent run data of the
# HTTP client, the Reader's blob cache): one temp dir for the whole session,
# inherited by subprocesses too.
os.environ["CAIRN_CACHE_DIR"] = tempfile.mkdtemp(prefix="cairn-test-cache-")

# Run directories ($CAIRN_DIR) and the uploader's state (registry, lock) go
# to temp dirs too, never ./.cairn of the checkout or ~/.local/state. The
# background uploader is off unless a test turns it on (CAIRN_UPLOADER=on):
# runs stay in their directories, uploaded by the test itself.
# INTEGRATION NOTE (0.6 merge): tests that log with cairn.Run and read back
# with the Reader need the upload step (an auto-started local server, or an
# explicit in-process sync); decide here whether to turn the uploader on.
os.environ.setdefault("CAIRN_DIR", tempfile.mkdtemp(prefix="cairn-test-rundirs-"))
os.environ["CAIRN_AGENT_DIR"] = tempfile.mkdtemp(prefix="cairn-test-agent-")
os.environ.setdefault("CAIRN_UPLOADER", "off")


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
    # Explicit even though it is now the default: the API tests that use this
    # must not depend on whether a viewer happens to be installed.
    return create_app(data_dir=tmp_path / "cairn", mount_ui=False)


@pytest.fixture
def client(app):
    with TestClient(app) as c:
        yield c


@pytest.fixture
def ui_app(tmp_path):
    """An app with the viewer mounted; skips when cairn-ui is not installed."""
    from cairn import viewer

    if not viewer.is_available():
        pytest.skip("cairn-ui viewer not installed")
    return create_app(data_dir=tmp_path / "cairn", mount_ui=True)


@pytest.fixture
def ui_client(ui_app):
    with TestClient(ui_app) as c:
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


@pytest.fixture(autouse=True)
def _standin_server(request, monkeypatch):
    """TEST-ONLY: local repos get an in-process server and runs upload at every
    group commit (tests/standin_server.py). A module sets ``STANDIN = False``
    to test the client on its own."""
    if getattr(request.module, "STANDIN", True):
        standin_server.install(monkeypatch)
    yield
    standin_server.close_all()


def ingest_repo(repo) -> None:
    """Apply a local repo's pending run logs now, under its ingest lease (what
    a server's background loop, a Reader or a CLI command does)."""
    from cairn.sdk.local import RepoTransport
    from cairn.server.wal_ingest import ingest_all

    standin_server.sync_repo(repo)
    rt = RepoTransport(repo)
    try:
        rt.under_lease(lambda db: ingest_all(rt.data_dir, db, rt.blobs), catch_up_first=False)
    finally:
        rt.close()
