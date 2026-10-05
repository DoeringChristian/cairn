"""Custom viewers from Python: publish a viewer folder, run its dev loop.

A viewer is a folder with a ``cairn-viewer.json`` manifest and ES modules
(see ``cairn.server.viewer_manifest`` and the custom viewers guide). Publishing
logs it as a version of the artifact family ``<manifest name>`` of type
``cairn-viewer``, with the normalized manifest and the folder's content digest
in the version's metadata; an unchanged folder is not published again.
"""

from __future__ import annotations

import functools
import hashlib
import secrets
import threading
import time
from pathlib import Path
from typing import Any, Callable

from ..server.viewer_manifest import (
    MANIFEST_FILE,
    VIEWER_TYPE,
    ManifestError,
    content_digest,
    folder_files,
    load_folder,
)
from .artifacts import Artifact, ArtifactVersion


def publish_folder(
    transport: Any, registry: Any, project_id: str, path: str | Path, *,
    aliases: list[str] | None = None, created_by_run: str | None = None, backend: Any = None,
) -> ArtifactVersion:
    """Publish ``path`` unless ``latest`` already has its content (shared by
    ``publish_viewer`` and ``Run.use_viewer``)."""
    from .run import log_draft

    manifest, files = load_folder(path)
    name = manifest["name"]
    digest = content_digest((rel, sha) for rel, _p, sha, _n in files)
    try:
        latest = transport.resolve_artifact(project_id, f"{name}:latest")
    except LookupError:
        latest = None
    except RuntimeError:  # WAL mode cannot look up; publish
        latest = None
    if latest is not None and latest.get("type") != VIEWER_TYPE:
        raise ValueError(
            f"artifact {name!r} in project {project_id!r} is a {latest.get('type')!r}, not a viewer"
        )
    if latest is not None and (latest.get("metadata") or {}).get("content_digest") == digest:
        for alias in aliases or []:
            if alias not in (latest.get("aliases") or []):
                latest = transport.add_artifact_alias(latest["id"], alias)
        return ArtifactVersion(latest, backend)
    draft = Artifact(
        name, type=VIEWER_TYPE, description=manifest["description"],
        metadata={"manifest": manifest, "content_digest": digest},
    )
    for rel, p, _sha, _n in files:
        draft.add_file(p, rel)
    return log_draft(
        transport, registry, project_id, draft, aliases, None,
        created_by_run=created_by_run, backend=backend,
    )


def publish_viewer(
    path: str | Path,
    *,
    project: str,
    aliases: list[str] | None = None,
    repo: str | Path | None = None,
) -> ArtifactVersion:
    """Publish a custom viewer folder to a project (if it changed).

    The folder holds ``cairn-viewer.json`` and the viewer's ES modules. It
    becomes a new version of the artifact ``<manifest name>`` (type
    ``cairn-viewer``) only when its content differs from the ``latest``
    version; otherwise that version is returned (with ``aliases`` added).

    Example:
        ```python
        cairn.publish_viewer("viewers/vmf", project="guiding")
        ```

    Args:
        path: The viewer folder.
        project: The project the viewer is available in.
        aliases: User aliases moved to the version (``latest`` always is).
        repo: Where to write, resolved like ``cairn.Run(repo=...)``.

    Returns:
        The viewer's ``ArtifactVersion`` (new, or the unchanged ``latest``).

    Raises:
        ManifestError: The manifest or folder is invalid (missing entry or
            import target, over 50 MB, ...).
    """
    from . import handlers as _handlers  # noqa: F401  (register built-ins)
    from ..server.routes._common import slugify
    from .connect import open_transport
    from .handlers.registry import default_registry
    from .run import backend_for_transport

    transport, _server = open_transport(repo)
    try:
        version = publish_folder(transport, default_registry, slugify(project), path, aliases=aliases)
        version._backend_src = functools.partial(backend_for_transport, transport)
    finally:
        transport.close()
    return version


# ---------------------------------------------------------------------------
# Dev loop
# ---------------------------------------------------------------------------

class DevSync:
    """Mirror a viewer folder to a server's dev source (``cairn viewer dev``).

    ``sync()`` declares the folder's file set and uploads what the server
    lacks; call it whenever the folder changed, and at least every
    ``HEARTBEAT_S`` (the server drops a silent source after 30 s). ``run()``
    polls the folder and does both until stopped; ``close()`` removes the
    source.

    Args:
        client: An ``httpx.Client`` on the server (base URL + auth set).
        project: The project id the viewer shows in.
        root: The viewer folder.
    """

    HEARTBEAT_S = 10.0

    def __init__(self, client: Any, project: str, root: str | Path) -> None:
        self.client = client
        self.project = project
        self.root = Path(root)
        manifest, _files = load_folder(self.root)
        self.name: str = manifest["name"]
        self.session = secrets.token_hex(16)
        self.revision = 0
        self._hashes: dict[str, tuple[int, int, str]] = {}  # path -> (mtime_ns, size, sha)
        self._stop = threading.Event()

    def _url(self, suffix: str = "") -> str:
        return f"/api/projects/{self.project}/viewers/dev/{self.name}{suffix}"

    def snapshot(self) -> dict[str, str]:
        """``{path: sha256}`` of the folder (hashes cached by mtime and size)."""
        out: dict[str, str] = {}
        for rel, p in folder_files(self.root):
            st = p.stat()
            hit = self._hashes.get(rel)
            if hit is None or hit[:2] != (st.st_mtime_ns, st.st_size):
                hit = (st.st_mtime_ns, st.st_size, hashlib.sha256(p.read_bytes()).hexdigest())
                self._hashes[rel] = hit
            out[rel] = hit[2]
        return out

    def check(self) -> str | None:
        """The folder's manifest error, or None when it is valid."""
        try:
            manifest, _ = load_folder(self.root)
        except ManifestError as exc:
            return str(exc)
        if manifest["name"] != self.name:
            return f"the manifest name changed to {manifest['name']!r}; restart `cairn viewer dev`"
        return None

    def sync(self, files: dict[str, str] | None = None) -> int:
        """Declare + upload; returns the server's revision."""
        files = self.snapshot() if files is None else files
        resp = self.client.post(self._url(), json={"session": self.session, "files": files})
        resp.raise_for_status()
        body = resp.json()
        for path in body["missing"]:
            data = (self.root / path).read_bytes()
            r = self.client.put(
                self._url("/file"), params={"path": path, "session": self.session}, content=data,
            )
            if r.status_code == 400 and "does not match" in r.text:
                return self.sync()  # changed while uploading: declare again
            r.raise_for_status()
            body = r.json()
        self.revision = body["revision"]
        return self.revision

    def run(
        self, *, interval: float = 0.5, on_change: Callable[[int, str | None], Any] | None = None,
    ) -> None:
        """Poll the folder every ``interval`` seconds until ``stop()``."""
        last: dict[str, str] | None = None
        last_sent = 0.0
        while not self._stop.is_set():
            files = self.snapshot()
            now = time.monotonic()
            if files != last or now - last_sent >= self.HEARTBEAT_S:
                before = self.revision
                try:
                    self.sync(files)
                    last, last_sent = files, now
                except Exception as exc:  # noqa: BLE001  (server down: retry)
                    if on_change is not None:
                        on_change(self.revision, f"sync failed: {exc}")
                else:
                    if on_change is not None and self.revision != before:
                        on_change(self.revision, self.check())
            self._stop.wait(interval)

    def stop(self) -> None:
        self._stop.set()

    def close(self) -> None:
        """Remove the dev source from the server (best effort)."""
        try:
            self.client.delete(self._url(), params={"session": self.session})
        except Exception:  # noqa: BLE001
            pass


__all__ = ["MANIFEST_FILE", "DevSync", "publish_folder", "publish_viewer"]
