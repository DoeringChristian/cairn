"""Where a client reaches a repo: ``resolve_endpoint`` -> ``Endpoint(url, token)``.

The server is the only process that opens a repo's database. Everything
else — ``cairn.Reader``, the CLI, ``cairn ui``, runs (through the uploader)
— talks to a server over HTTP, found like this:

1. an explicit server (``server=`` / a ``repo=`` URL), else ``CAIRN_REPO`` /
   ``CAIRN_SERVER`` / the config file naming one (``cairn.config``'s usual
   order), with its token (``CAIRN_TOKEN`` / ``cairn login``);
2. else the local repo (``CAIRN_REPO`` / config / ``./.cairn``) is served by
   a server on this machine: the one registered in ``<repo>/server.json``
   when it is alive and answers, else a daemon started now —
   ``cairn server --repo <repo> --daemon``: loopback, a free port, auth on
   with the repo's same-user token, exits after ``CAIRN_SERVER_IDLE_TIMEOUT``
   seconds (default 30 min) without requests. Starting waits up to
   ``START_TIMEOUT`` (10 s) for it to answer.
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path

from . import config as _config

log = logging.getLogger(__name__)

#: Seconds to wait for a started daemon server to answer.
START_TIMEOUT = 10.0
#: Seconds to wait for a server that is still starting (``server.json`` says
#: ``"state": "starting"``): an upgrade backs up and migrates the database
#: and imports the 0.5 run logs before it listens.
STARTING_TIMEOUT = 900.0


class EndpointUnavailable(RuntimeError):
    """No server could be reached or started for the target."""


@dataclass(frozen=True)
class Endpoint:
    """A server to talk to: its base URL and the Bearer token for it."""

    url: str
    token: str | None = None
    #: The local repo this server serves, when it was found through one.
    repo: Path | None = None

    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"} if self.token else {}

    def client(self, timeout: float = 30.0):  # -> httpx.Client
        import httpx

        return httpx.Client(base_url=self.url, headers=self.headers(), timeout=timeout)


def resolve_endpoint(
    server: str | None = None,
    repo: str | Path | None = None,
    *,
    start: bool = True,
) -> Endpoint:
    """The endpoint for ``server``/``repo`` (see the module docstring).

    Args:
        server: A server URL (``http(s)://``, ``cairn://host:port``).
        repo: A local ``.cairn/`` directory or a server URL.
        start: Start a daemon server for a local repo that has none; False
            raises ``EndpointUnavailable`` instead.

    Raises:
        EndpointUnavailable: The local repo's server did not start in time.
    """
    target = _config.resolve_target(repo=repo, server=server)
    if not target.is_local:
        url = target.location.rstrip("/")
        return Endpoint(url, _config.resolve_token(url))
    return local_endpoint(Path(target.location), start=start)


def _server_id(root: Path) -> str | None:
    try:
        return (root / "auth" / "server_id").read_text().strip() or None
    except OSError:
        return None


def _answers(info: dict, root: Path) -> bool:
    """Whether the server ``info`` describes answers, and serves ``root``."""
    import httpx

    try:
        resp = httpx.get(f"{info['url']}/api/health", timeout=5.0)
    except (httpx.HTTPError, OSError):
        return False
    if resp.status_code != 200:
        return False
    try:
        sid = resp.json().get("server_id")
    except ValueError:
        return False
    mine = _server_id(root)
    return sid is None or mine is None or sid == mine


def live_server(root: Path) -> Endpoint | None:
    """The live server registered for the local repo ``root``, or None."""
    from .server.registration import read_info

    root = Path(root).expanduser().resolve()
    info = read_info(root)
    if info is None or not _answers(info, root):
        return None
    return Endpoint(info["url"].rstrip("/"), info.get("token"), root)


def local_endpoint(root: Path, *, start: bool = True) -> Endpoint:
    """The server of the local repo ``root``, started when there is none.

    A server that holds the repo but does not answer yet — still starting
    (an upgrade's backup and 0.5 log import can take minutes), or busy — is
    waited for, never doubled: ``START_TIMEOUT`` for one that registered its
    URL, ``STARTING_TIMEOUT`` for one still starting.

    Raises:
        EndpointUnavailable: No server answered in time (or, with
            ``start=False``, none serves the repo).
    """
    root = Path(root).expanduser().resolve()
    found = wait_existing(root)
    if found is not None:
        return found
    if not start:
        raise EndpointUnavailable(f"no server is serving {root}")
    root.mkdir(parents=True, exist_ok=True)
    with _spawn_lock(root):
        found = wait_existing(root)  # another process started one meanwhile
        if found is not None:
            return found
        proc = start_server(root)
        found = wait_existing(root, proc=proc, fresh=True)
        if found is not None:
            return found
    raise EndpointUnavailable(
        f"the cairn server for {root} did not start within {START_TIMEOUT:.0f} s; "
        f"see {root / 'server.log'}"
    )


def wait_existing(
    root: Path, *, proc: "subprocess.Popen[bytes] | None" = None, fresh: bool = False,
) -> Endpoint | None:
    """The live server of ``root``, waiting for one that holds the repo but
    does not answer yet; None when no process serves (or starts serving) it.
    ``proc``/``fresh``: a server just started here, waited for even before
    it registers."""
    from .server.registration import read_info, read_starting

    deadline = time.monotonic() + START_TIMEOUT
    noticed = False
    while True:
        info = read_info(root)
        if info is not None and _answers(info, root):
            return Endpoint(info["url"].rstrip("/"), info.get("token"), root)
        starting = read_starting(root) if info is None else None
        if starting is not None:
            if not noticed:
                noticed = True
                deadline = max(deadline, time.monotonic() + STARTING_TIMEOUT)
                log.warning(
                    "cairn: waiting for the server of %s (pid %s) to finish starting "
                    "(an upgrade backs up and migrates the repo first; see %s)",
                    root, starting.get("pid"), root / "server.log",
                )
        elif info is None and not fresh:
            return None  # nobody serves it
        if proc is not None and proc.poll() is not None:
            raise EndpointUnavailable(
                f"the cairn server for {root} exited (status {proc.returncode}):\n"
                + _tail(root / "server.log")
            )
        if time.monotonic() > deadline:
            if info is not None and not fresh:
                from .server.registration import is_locked

                if not is_locked(root):
                    return None  # a stale registration (its pid reused): nobody serves it
                raise EndpointUnavailable(
                    f"the cairn server of {root} (pid {info.get('pid')}, {info.get('url')}) "
                    f"does not answer; see {root / 'server.log'}"
                )
            return None
        time.sleep(0.05)


class _spawn_lock:
    """Serializes starting a repo's server across processes (``flock``)."""

    def __init__(self, root: Path) -> None:
        self.path = root / "server.start.lock"
        self.fh = None

    def __enter__(self) -> None:
        self.fh = open(self.path, "a+b")  # noqa: SIM115
        if os.name != "nt":
            import fcntl

            fcntl.flock(self.fh.fileno(), fcntl.LOCK_EX)

    def __exit__(self, *exc: object) -> None:
        if self.fh is not None:
            self.fh.close()


def _tail(path: Path, lines: int = 15) -> str:
    try:
        return "\n".join(path.read_text(errors="replace").splitlines()[-lines:])
    except OSError:
        return ""


def start_server(root: Path) -> "subprocess.Popen[bytes] | None":
    """Start ``cairn server --repo root --daemon`` detached from this
    process (its own session, no terminal; output to ``<repo>/server.log``).
    Returns at once; ``local_endpoint`` waits for it to answer. Tests replace
    this with an in-process server."""
    log_path = root / "server.log"
    with open(log_path, "ab") as out:
        proc = subprocess.Popen(
            [sys.executable, "-m", "cairn", "server", "--repo", str(root), "--daemon"],
            stdin=subprocess.DEVNULL,
            stdout=out,
            stderr=subprocess.STDOUT,
            close_fds=True,
            start_new_session=True,
            cwd=str(root),
        )
    # Reap it when it exits (idle timeout, shutdown), so a long-lived client
    # (a notebook) does not collect zombies; ``proc.poll()`` still works.
    threading.Thread(target=proc.wait, name="cairn-server-reaper", daemon=True).start()
    return proc
