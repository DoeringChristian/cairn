"""Configuration: repo resolution and config file I/O.

A ``Run`` is bound to *one* destination — either a local repo path or
a remote server. Resolution order:

    1. explicit ``repo=`` kwarg
    2. module-level ``configure(repo=...)``
    3. ``CAIRN_REPO`` env var
    4. config file ``repo`` key

If none of these are set, defaults to ``./.cairn`` in CWD (local mode).

URL scheme:
    repo="/path/to/.cairn"       → local mode (direct DB or WAL)
    repo="cairn://host:port"     → HTTP server mode
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import platformdirs

if sys.version_info >= (3, 11):
    import tomllib
else:  # pragma: no cover - only exercised on 3.10
    import tomli as tomllib

import tomli_w

DEFAULT_SERVER = "http://localhost:4300"
"""Fallback URL used by ``resolve_server`` for CLI commands only."""

_configured: dict[str, Any] = {}
"""Module-level state populated by ``configure()``."""

CAIRN_SCHEME = "cairn://"


@dataclass(frozen=True)
class RunTarget:
    """Resolved destination for a Run."""

    kind: Literal["local", "server"]
    location: str

    @property
    def is_local(self) -> bool:
        return self.kind == "local"


def config_file_path() -> Path:
    """Return the OS-appropriate config file path."""
    return Path(platformdirs.user_config_dir("cairn")) / "config.toml"


def load_config_file(path: Path | None = None) -> dict[str, Any]:
    """Load the TOML config file; return ``{}`` if missing or malformed."""
    path = path or config_file_path()
    if not path.exists():
        return {}
    try:
        with path.open("rb") as fh:
            return tomllib.load(fh)
    except (OSError, tomllib.TOMLDecodeError):
        return {}


def write_config_file(data: dict[str, Any], path: Path | None = None) -> None:
    """Write ``data`` as TOML, creating parent dirs as needed.

    The config file may hold plaintext bearer tokens (the ``[tokens]`` table
    ``cairn login`` writes — explicitly the multi-user-host scenario), so it
    is created 0o600 and its parent dir 0o700 unconditionally (regardless of
    whether a token is present right now) so a later token add is safe on a
    shared host. On Windows these POSIX modes are a no-op; document
    filesystem ACLs there.
    """
    path = path or config_file_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path.parent, 0o700)
    except OSError:
        pass  # e.g. parent not owned by us, or non-POSIX FS
    # Open with O_CREAT|O_WRONLY|O_TRUNC and mode 0o600 so the file is never
    # even briefly world-readable between creation and a post-hoc chmod.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as fh:
        tomli_w.dump(data, fh)
    # An existing file keeps its old mode through O_CREAT, so tighten
    # explicitly in case it predated this hardening.
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def configure(**kwargs: Any) -> None:
    """Set process-wide defaults for runs, readers and CLI calls made afterwards.

    A value set here beats the environment and the config file, but an
    explicit argument (``cairn.Run(repo=...)``) beats it. ``None`` values are
    ignored.

    Example:
        ```python
        cairn.configure(repo="cairn://gpubox.local:4300")
        cairn.configure(repo="./.cairn")
        cairn.configure(mode="disabled")  # every cairn.Run becomes a no-op
        ```

    Args:
        **kwargs: ``repo`` (a ``.cairn/`` path or ``cairn://host:port``),
            ``server`` (a server URL; ``repo`` wins when both are set) and
            ``mode`` (``"disabled"`` turns tracking off).
    """
    _configured.update({k: v for k, v in kwargs.items() if v is not None})


def reset_configured() -> None:
    """Clear module-level configuration (primarily for tests)."""
    _configured.clear()


def _parse_repo(value: str) -> RunTarget:
    """Parse a repo string into a RunTarget.

    ``cairn://host:port``   → server mode (HTTP)
    ``http(s)://host:port`` → server mode (an http URL is never a local path)
    anything else           → local mode (filesystem path)
    """
    if value.startswith(CAIRN_SCHEME):
        http_url = "http://" + value[len(CAIRN_SCHEME):]
        return RunTarget("server", http_url)
    if value.startswith(("http://", "https://")):
        return RunTarget("server", value)
    return RunTarget("local", str(Path(value).expanduser()))


def _as_server_url(value: str) -> str:
    """Accept ``http(s)://...`` or ``cairn://host:port`` server spellings."""
    v = str(value)
    if v.startswith(CAIRN_SCHEME):
        return "http://" + v[len(CAIRN_SCHEME):]
    return v


def resolve_server(explicit: str | None = None) -> str:
    """Resolve the server URL per the server-only priority chain.

    Kept for callers (CLI `ping`/`list`/...) that only speak HTTP.

    Priority (the ``server`` family ahead of the ``repo`` family):
    explicit > configured server > configured repo(server-mode) >
    $CAIRN_SERVER > $CAIRN_REPO(server-mode) > file server > file
    repo(server-mode) > default.
    """
    if explicit is not None:
        return explicit
    if "server" in _configured:
        return _as_server_url(str(_configured["server"]))
    if "repo" in _configured:
        t = _parse_repo(str(_configured["repo"]))
        if not t.is_local:
            return t.location
    env = os.environ.get("CAIRN_SERVER")
    if env:
        return _as_server_url(env)
    env = os.environ.get("CAIRN_REPO")
    if env:
        t = _parse_repo(env)
        if not t.is_local:
            return t.location
    cfg = load_config_file()
    if "server" in cfg:
        return _as_server_url(str(cfg["server"]))
    if "repo" in cfg:
        t = _parse_repo(str(cfg["repo"]))
        if not t.is_local:
            return t.location
    return DEFAULT_SERVER


def normalize_server_url(url: str) -> str:
    """The canonical spelling of a server URL — the key of its saved token.

    ``cairn://host:port`` becomes ``http://host:port``; a bare ``host:port``
    is taken as ``http``. Scheme and host are lowercased, the scheme's default
    port (80/443) is dropped, a path prefix (a server behind a reverse proxy)
    is kept without its trailing slash, and query, fragment and credentials
    are dropped. The loopback names ``127.0.0.1`` and ``::1`` become
    ``localhost``: they reach the same server.

        >>> normalize_server_url("cairn://GPUBOX:4300/")
        'http://gpubox:4300'
    """
    from urllib.parse import urlsplit

    raw = str(url).strip()
    if raw.startswith(CAIRN_SCHEME):
        raw = "http://" + raw[len(CAIRN_SCHEME):]
    elif "://" not in raw:
        raw = "http://" + raw
    parts = urlsplit(raw)
    scheme = parts.scheme.lower()
    if scheme not in ("http", "https") or not parts.hostname:
        raise ValueError(f"not a server URL: {url!r}")
    host = parts.hostname.lower()
    if host in ("127.0.0.1", "::1"):
        host = "localhost"
    if ":" in host:  # IPv6 literal
        host = f"[{host}]"
    try:
        port = parts.port
    except ValueError as exc:
        raise ValueError(f"not a server URL: {url!r}") from exc
    netloc = host if port is None or port == {"http": 80, "https": 443}[scheme] else f"{host}:{port}"
    return f"{scheme}://{netloc}{parts.path.rstrip('/')}"


def saved_tokens() -> dict[str, str]:
    """The per-server tokens in the config file's ``[tokens]`` table,
    keyed by normalized server URL."""
    table = load_config_file().get("tokens")
    if not isinstance(table, dict):
        return {}
    out: dict[str, str] = {}
    for url, token in table.items():
        if not token:
            continue
        try:
            out[normalize_server_url(url)] = str(token)
        except ValueError:
            continue
    return out


def save_token(server_url: str, token: str | None) -> str:
    """Save ``token`` for ``server_url`` in the config file's ``[tokens]``
    table, or remove that server's entry when ``token`` is ``None``. Returns
    the normalized URL used as the key."""
    key = normalize_server_url(server_url)
    data = load_config_file()
    table = data.get("tokens")
    table = dict(table) if isinstance(table, dict) else {}
    # Re-key under the canonical spelling, so a hand-edited entry is replaced
    # rather than shadowed.
    table = {
        k: v for k, v in table.items()
        if _normalized_or_none(k) != key
    }
    if token is not None:
        table[key] = token
    if table:
        data["tokens"] = table
    else:
        data.pop("tokens", None)
    write_config_file(data)
    return key


def _normalized_or_none(url: str) -> str | None:
    try:
        return normalize_server_url(url)
    except ValueError:
        return None


def resolve_token(server_url: str | None, explicit: str | None = None) -> str | None:
    """Resolve the Bearer token for the server at ``server_url``:

        1. explicit arg (e.g. ``Transport(..., token=...)``)
        2. ``CAIRN_TOKEN`` env var — applies to every server
        3. the config file's ``[tokens]`` entry for ``server_url``
           (written by ``cairn login``), matched after
           ``normalize_server_url``

    Returns ``None`` (not an error) when no token is configured — auth-off
    servers work with no token at all.
    """
    if explicit is not None:
        return explicit
    env = os.environ.get("CAIRN_TOKEN")
    if env:
        return env
    if server_url is None:
        return None
    key = _normalized_or_none(server_url)
    return saved_tokens().get(key) if key is not None else None


MODES = ("enabled", "disabled")
"""``disabled`` makes ``cairn.Run`` a no-op: nothing is written, no thread starts."""


def resolve_mode(explicit: str | None = None) -> str:
    """Resolve the run mode: explicit ``Run(mode=)`` > ``configure(mode=)`` >
    ``CAIRN_MODE`` env var > config file ``mode`` key > ``"enabled"``."""
    if explicit is not None:
        mode = explicit
    elif "mode" in _configured:
        mode = str(_configured["mode"])
    elif os.environ.get("CAIRN_MODE"):
        mode = os.environ["CAIRN_MODE"]
    else:
        mode = str(load_config_file().get("mode", "enabled"))
    if mode not in MODES:
        raise ValueError(f"cairn mode must be one of {MODES}, got {mode!r}")
    return mode


def resolve_target(
    repo: str | Path | None = None,
    server: str | None = None,
) -> RunTarget:
    """Resolve where a ``Run`` should send its data.

    Returns a ``RunTarget`` tagged ``local`` (with a filesystem path) or
    ``server`` (with a URL).

    Accepts ``cairn://host:port`` for HTTP server mode.
    """
    if repo is not None:
        return _parse_repo(str(repo))
    if server is not None:
        return RunTarget("server", _as_server_url(server))
    if "repo" in _configured:
        return _parse_repo(str(_configured["repo"]))
    if "server" in _configured:
        return RunTarget("server", _as_server_url(str(_configured["server"])))
    env_repo = os.environ.get("CAIRN_REPO")
    if env_repo:
        return _parse_repo(env_repo)
    env_server = os.environ.get("CAIRN_SERVER")
    if env_server:
        return RunTarget("server", _as_server_url(env_server))
    cfg = load_config_file()
    if "repo" in cfg:
        return _parse_repo(str(cfg["repo"]))
    if "server" in cfg:
        return RunTarget("server", _as_server_url(str(cfg["server"])))
    # Default: ./.cairn in CWD
    return RunTarget("local", str(Path.cwd() / ".cairn"))
