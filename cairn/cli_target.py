"""Where a CLI command reads and writes: a local repo or a server.

Every command that touches data takes ``--repo`` and ``--server`` and
resolves them with ``cairn.config.resolve_target`` (the order ``cairn.Run``
and ``cairn.Reader`` use): an explicit ``--repo``/``--server``, then
``CAIRN_REPO``/``CAIRN_SERVER``, then the config file, then ``./.cairn``.

``open_api`` hands a command one HTTP-shaped client for either target:

* a server: an ``httpx.Client`` on its URL, with its token;
* a local repo whose ingest lease a live ``cairn server``/``cairn ui``
  holds: that server, with the repo's ``auth/local.token``;
* any other local repo: the server's own routes, run in-process over the
  repo (no port is opened), so a local command does exactly what the same
  command against a server does, through the same code. The command holds
  the repo's ingest lease meanwhile (it is the repo's one writer) and first
  catches up on pending run logs.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any, TypeVar

import click

from . import config as _config

REPO_HELP = (
    "A local .cairn/ directory, or a server as cairn://HOST:PORT or an "
    "http(s):// URL. Default: CAIRN_REPO / CAIRN_SERVER / the config file, "
    "else ./.cairn."
)
SERVER_HELP = "A server URL (cairn://HOST:PORT or http(s)://...); same as --repo with a URL."

F = TypeVar("F", bound=Callable[..., Any])


def target_options(f: F) -> F:
    """``--repo`` and ``--server`` on a command (keyword args ``repo``, ``server``)."""
    f = click.option("--server", default=None, metavar="URL", help=SERVER_HELP)(f)
    f = click.option("--repo", default=None, metavar="PATH|URL", help=REPO_HELP)(f)
    return f


def explicit(repo: str | None, server: str | None) -> str | None:
    """The explicitly named target as one ``repo=`` spelling (a path or a
    URL), or None to let the environment and config decide."""
    if repo is not None and server is not None:
        raise click.UsageError("pass --repo or --server, not both")
    if server is not None:
        return _config._as_server_url(server)
    return repo


def resolve(repo: str | None, server: str | None) -> _config.RunTarget:
    return _config.resolve_target(repo=explicit(repo, server))


def is_repo(path: str | Path) -> bool:
    """Whether a Cairn repo exists at ``path``: its database, or (a repo only
    runs have written so far, nothing ingested yet) its layout marker."""
    root = Path(path).expanduser()
    return (root / "cairn.db").is_file() or (root / "version").is_file()


def require_repo(path: str | Path) -> Path:
    """An existing local repo, or a one-line error saying how to name one."""
    root = Path(path).expanduser().resolve()
    if not is_repo(root):
        raise click.ClickException(
            f"no Cairn repo at {root}; create one with `cairn init`, or name "
            "yours with --repo/--server, CAIRN_REPO/CAIRN_SERVER or the config file"
        )
    return root


def reader_location(repo: str | None, server: str | None) -> tuple[str, str]:
    """``(location, label)`` for a ``cairn.Reader``: a server URL, an existing
    repo dir, or a ``.zip`` run archive; ``label`` names it in errors."""
    target = resolve(repo, server)
    if not target.is_local:
        return target.location, target.location.rstrip("/")
    loc = Path(target.location).expanduser()
    if loc.suffix == ".zip" and loc.is_file():
        return str(loc), str(loc)
    root = require_repo(loc)
    return str(root), str(root)


def serving_url(root: Path) -> tuple[str, str | None] | None:
    """``(url, token)`` of the live ``cairn server``/``cairn ui`` holding the
    repo's ingest lease, or None when none does. A holder that does not
    answer is an error, as for ``cairn.Run``."""
    from .sdk.local import ServerUnreachable, server_transport
    from .server.storage import lease as lease_mod

    holder = lease_mod.serving_holder(root)
    if holder is None:
        return None
    try:
        t = server_transport(holder, root)
    except ServerUnreachable as exc:
        raise click.ClickException(str(exc)) from None
    t.close()
    return t.server_url, t.token


class Api:
    """An HTTP client for the command's target (see the module docstring).

    ``get``/``post``/``delete``/``request`` return the response and raise for
    an error status. Against a server the error reaches the CLI's one-line
    HTTP error handler; against an in-process local repo it is turned into
    ``Error: <repo>: <detail>`` here.
    """

    def __init__(self, target: _config.RunTarget) -> None:
        self.target = target
        self.local_root: Path | None = None
        #: True when requests run in this process over a local repo.
        self.in_process = False
        self._resources: list[Any] = []
        if target.is_local:
            self.local_root = require_repo(target.location)
            served = serving_url(self.local_root)
            lease = None
            if served is None:
                from .server.storage import lease as lease_mod

                try:
                    lease = lease_mod.acquire(self.local_root, mode="cli")
                except lease_mod.ServedByServer:
                    served = serving_url(self.local_root)
                except lease_mod.LeaseBusy as exc:
                    raise click.ClickException(str(exc)) from None
            if served is not None:
                self.base, token = served
                self._client = self._http_client(self.base, token)
            else:
                self._resources.append(lease)
                self.base = str(self.local_root)
                self.in_process = True
                self._client = self._local_client(self.local_root)
        else:
            self.base = target.location.rstrip("/")
            self._client = self._http_client(self.base, _config.resolve_token(self.base))

    @staticmethod
    def _http_client(base: str, token: str | None) -> Any:
        import httpx

        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return httpx.Client(base_url=base, headers=headers, timeout=httpx.Timeout(30.0, read=600.0))

    def _local_client(self, root: Path) -> Any:
        from fastapi.testclient import TestClient

        from .server.app import create_app
        from .server.storage.blobs import BlobStore
        from .server.storage.datadir import DataDir
        from .server.storage.db import Database

        from .server.wal_ingest import ingest_all

        dd = DataDir(root)
        db = Database.open(dd.db_path)
        self._resources.insert(0, db)
        blobs = BlobStore(dd.artifacts_dir)
        # What a server's background loop would have done by now (and what
        # cairn.Reader does before reading): ingest the runs' pending logs.
        ingest_all(dd, db, blobs)
        app = create_app(
            db=db, blobs=blobs, data_dir_obj=dd,
            mount_ui=False, auth_enabled=False, background_tasks=False,
        )
        client = TestClient(app, base_url="http://cairn-local-repo")
        client.__enter__()  # runs the app's lifespan (sets its state)
        return client

    @property
    def label(self) -> str:
        """The target as shown in messages: the repo path or the server URL."""
        return str(self.local_root) if self.in_process else self.base

    def request(self, method: str, path: str, **kwargs: Any) -> Any:
        import httpx

        resp = self._client.request(method, path, **kwargs)
        try:
            resp.raise_for_status()
        except httpx.HTTPStatusError:
            if not self.in_process:
                raise
            try:
                detail = resp.json().get("detail")
            except ValueError:
                detail = None
            raise click.ClickException(
                f"{self.local_root}: {detail if isinstance(detail, str) and detail else resp.reason_phrase}"
            ) from None
        return resp

    def get(self, path: str, params: Any = None) -> Any:
        return self.request("GET", path, params=params)

    def post(self, path: str, **kwargs: Any) -> Any:
        return self.request("POST", path, **kwargs)

    def delete(self, path: str, **kwargs: Any) -> Any:
        return self.request("DELETE", path, **kwargs)

    def close(self) -> None:
        if self.in_process:
            self._client.__exit__(None, None, None)
        else:
            self._client.close()
        for r in self._resources:  # the database, then the lease
            if hasattr(r, "release"):
                r.release()
            else:
                r.close()

    def __enter__(self) -> Api:
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()


def open_api(repo: str | None, server: str | None) -> Api:
    return Api(resolve(repo, server))
