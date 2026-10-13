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

from cairn.server.app import create_app
from tests import standin_server
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

# A daemon server a test's subprocess starts (a CLI command, a script) must
# not outlive the test run by the default 30 min.
os.environ.setdefault("CAIRN_SERVER_IDLE_TIMEOUT", "20")

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


class _RepoServers:
    """In-process servers for the local repos a test touches.

    ``cairn.endpoint`` starts a daemon server (a subprocess) for a local
    repo nobody serves. Tests replace that with a uvicorn in a thread of the
    test process, registered in the repo's ``server.json`` exactly like a
    daemon (no auth), and stopped when the test ends; tests of the real
    daemon (``test_endpoint.py``) opt out with ``real_daemons``.
    """

    def __init__(self) -> None:
        self.running: list[tuple[Path, uvicorn.Server, threading.Thread]] = []

    def start(self, root: Path):
        from cairn.server.registration import write_info

        app = create_app(data_dir=root, mount_ui=False)
        port = _find_free_port()
        server = uvicorn.Server(uvicorn.Config(
            app=app, host="127.0.0.1", port=port, log_level="warning", lifespan="on",
        ))
        # Like a daemon: it stops on request (an archive Reader's close) and
        # takes its server.json along.
        app.state.daemon = True
        app.state.request_shutdown = lambda: setattr(server, "should_exit", True)

        def run() -> None:
            try:
                server.run()
            finally:
                (root / "server.json").unlink(missing_ok=True)

        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        deadline = time.time() + 10
        while time.time() < deadline and not server.started:
            if not thread.is_alive():
                raise RuntimeError(f"the test server for {root} failed to start")
            time.sleep(0.01)
        url = f"http://127.0.0.1:{port}"
        write_info(root, url=url, token=None)
        self.running.append((root, server, thread))
        return None

    def stop_repo(self, root: Path) -> None:
        """Stop the test server of ``root`` (the repo is free again)."""
        root = Path(root).resolve()
        for i, (r, server, thread) in enumerate(self.running):
            if Path(r).resolve() == root:
                server.should_exit = True
                thread.join(timeout=10)
                (r / "server.json").unlink(missing_ok=True)
                del self.running[i]
                return

    def stop_from(self, index: int) -> None:
        """Stop the servers started since ``len(self.running)`` was ``index``."""
        for root, server, thread in reversed(self.running[index:]):
            server.should_exit = True
            thread.join(timeout=10)
            (root / "server.json").unlink(missing_ok=True)
        del self.running[index:]


_SERVERS = _RepoServers()

import cairn.endpoint as _endpoint  # noqa: E402

_REAL_START_SERVER = _endpoint.start_server


@pytest.fixture(scope="session", autouse=True)
def _repo_servers_session():
    """Local repos are served in-process during tests (see ``_RepoServers``);
    servers started by module- or session-scoped fixtures stop at the end."""
    import cairn.endpoint

    real = cairn.endpoint.start_server
    cairn.endpoint.start_server = _SERVERS.start
    try:
        yield _SERVERS
    finally:
        cairn.endpoint.start_server = real
        _SERVERS.stop_from(0)


@pytest.fixture(autouse=True)
def repo_servers(request, monkeypatch, _repo_servers_session):
    """The in-process servers a test started stop when it ends. Tests marked
    ``real_daemons`` get real daemon subprocesses instead."""
    if "real_daemons" in request.keywords:
        import cairn.endpoint

        monkeypatch.setattr(cairn.endpoint, "start_server", _REAL_START_SERVER)
        yield None
        return
    if not getattr(request.module, "STANDIN", True):
        # Modules testing the client on its own: no server comes up for a repo.
        import cairn.endpoint

        def offline(root):
            raise cairn.endpoint.EndpointUnavailable(f"no server is serving {root} (test)")

        monkeypatch.setattr(cairn.endpoint, "start_server", offline)
    mark = len(_SERVERS.running)
    try:
        yield _SERVERS
    finally:
        _SERVERS.stop_from(mark)


@pytest.fixture(autouse=True)
def _upload_on_commit(request, monkeypatch):
    """Runs upload at every group commit, in-process, to the repo's (test)
    server: tests read back right after logging. A module sets
    ``STANDIN = False`` to test the client on its own."""
    if getattr(request.module, "STANDIN", True):
        standin_server.install(monkeypatch)
    yield


def ingest_repo(repo) -> None:
    """Upload a local repo's pending run directories now."""
    standin_server.sync_repo(repo)
