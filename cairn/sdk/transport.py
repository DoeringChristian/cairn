"""HTTP client for the SDK's reads and edits (Reader, CLI, sweeps, registry,
imports) — retries with backoff. A ``cairn.Run`` never writes through it: it
writes its run directory, and the uploader (``cairn.uploader``) sends that."""

from __future__ import annotations

import contextlib
import hashlib
import json
import logging
import random
import time
from typing import Any, Callable, Iterator, TypeVar

import httpx

from .. import config as _config

log = logging.getLogger(__name__)


def _quiet_http_client_logs() -> None:
    """Keep httpx's per-request INFO lines out of the training log.

    httpx logs "HTTP Request: POST …/batch" for every flush and every artifact
    HEAD probe, which swamps a sweep's own output as soon as the application
    enables INFO logging. Raise the client loggers to WARNING, but only when
    the user has not configured them explicitly (level still NOTSET), so
    `logging.getLogger("httpx").setLevel(logging.INFO)` keeps working for
    debugging.
    """
    for name in ("httpx", "httpcore"):
        client_log = logging.getLogger(name)
        if client_log.level == logging.NOTSET:
            client_log.setLevel(logging.WARNING)


_quiet_http_client_logs()

T = TypeVar("T")

DEFAULT_MAX_RETRIES = 5
DEFAULT_BACKOFF_CAP = 30.0
DEFAULT_BACKOFF_BASE = 1.0

@contextlib.contextmanager
def _run_not_found(run_id: str) -> Iterator[None]:
    """A 404 for a run is ``LookupError``, as on a local repo (``RunNotFound``)."""
    try:
        yield
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise LookupError(f"run {run_id} not found") from None
        raise


class Transport:
    """HTTP client with retries and exponential backoff; artifact dedup.

    All methods are blocking.
    """

    def __init__(
        self,
        server_url: str,
        *,
        timeout: float = 10.0,
        max_retries: int = DEFAULT_MAX_RETRIES,
        backoff_base: float = DEFAULT_BACKOFF_BASE,
        backoff_cap: float = DEFAULT_BACKOFF_CAP,
        client: httpx.Client | None = None,
        token: str | None = None,
    ):
        self.server_url = server_url.rstrip("/")
        self.timeout = timeout
        self.max_retries = max_retries
        self.backoff_base = backoff_base
        self.backoff_cap = backoff_cap
        # Resolution order: explicit ctor arg > CAIRN_TOKEN env > config.toml
        # `[tokens]` entry for this server (see cairn.config.resolve_token).
        # No token configured -> no Authorization header, which is fine
        # against an --no-auth server and correctly 401s against an
        # auth-enabled one.
        self.token = (
            _config.resolve_token(self.server_url, token) if client is None else token
        )
        headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}
        self._client = client or httpx.Client(
            base_url=self.server_url, timeout=timeout, headers=headers
        )
        self._owns_client = client is None

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    # ---- retry plumbing ----------------------------------------------------

    def _retry(self, fn: Callable[[], T]) -> T:
        """Call ``fn()``, retrying on transient errors with backoff."""
        last_exc: Exception | None = None
        for attempt in range(self.max_retries):
            try:
                return fn()
            except httpx.HTTPStatusError as exc:
                # Only retry 5xx; 4xx is a programmer error.
                if exc.response.status_code < 500:
                    raise
                last_exc = exc
            except (httpx.TransportError, httpx.TimeoutException) as exc:
                last_exc = exc
            sleep_for = min(
                self.backoff_cap, self.backoff_base * (2**attempt)
            ) + random.uniform(0, 1)
            log.debug("retrying after %.2fs (attempt %d): %s", sleep_for, attempt + 1, last_exc)
            time.sleep(sleep_for)
        assert last_exc is not None
        raise last_exc

    # ---- core HTTP ---------------------------------------------------------

    def _request(
        self, method: str, path: str, *, retry: bool = True, **kwargs: Any
    ) -> httpx.Response:
        def call() -> httpx.Response:
            resp = self._client.request(method, path, **kwargs)
            resp.raise_for_status()
            return resp

        return self._retry(call) if retry else call()

    def post_json(
        self, path: str, body: dict[str, Any], *, retry: bool = True,
    ) -> httpx.Response:
        # Encoded here rather than by httpx: config values may be NaN/inf,
        # which Python's JSON (the server's parser) round-trips.
        return self._request(
            "POST", path, retry=retry, content=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"},
        )

    def post_multipart(
        self, path: str, files: dict[str, Any], data: dict[str, Any] | None = None,
        *, retry: bool = True,
    ) -> httpx.Response:
        return self._request("POST", path, retry=retry, files=files, data=data or {})

    def get(self, path: str, params: dict[str, Any] | None = None) -> httpx.Response:
        return self._request("GET", path, params=params or {})

    def head(self, path: str, *, retry: bool = True) -> httpx.Response:
        """HEAD does not raise on 404 — used for dedup probes."""
        def call() -> httpx.Response:
            return self._client.request("HEAD", path)

        return self._retry(call) if retry else call()

    def delete(self, path: str) -> httpx.Response:
        return self._request("DELETE", path)

    # ---- high-level ops ----------------------------------------------------

    def create_run(self, body: dict[str, Any]) -> dict[str, Any]:
        """Create a run. Raises ValueError when its id is taken (409)."""
        try:
            return self.post_json("/api/runs", body).json()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 409:
                raise ValueError(exc.response.json().get("detail", exc.response.text)) from None
            raise

    def post_batch(self, run_id: str, points: list[dict[str, Any]]) -> bool:
        self.post_json(f"/api/runs/{run_id}/batch", {"points": points})
        return True

    def post_params(self, run_id: str, params: dict[str, Any]) -> None:
        self.post_json(f"/api/runs/{run_id}/params", {"params": params})

    def post_summary(self, run_id: str, summary: dict[str, Any]) -> None:
        self.post_json(f"/api/runs/{run_id}/summary", {"summary": summary})

    def post_logs(self, run_id: str, lines: list[dict[str, Any]]) -> bool:
        self.post_json(f"/api/runs/{run_id}/logs", {"lines": lines})
        return True

    def finish_run(
        self, run_id: str, status: str, exit_code: int | None = None,
        ended_at: str | None = None,
    ) -> None:
        self.post_json(
            f"/api/runs/{run_id}/finish",
            {"status": status, "exit_code": exit_code, "ended_at": ended_at},
        )

    def set_tags(self, run_id: str, tags: list[str]) -> None:
        self.post_json(f"/api/runs/{run_id}/tags", {"tags": tags})

    def set_notes(self, run_id: str, notes: str) -> None:
        self.post_json(f"/api/runs/{run_id}/notes", {"notes": notes})

    def rename_run(self, run_id: str, name: str) -> dict[str, Any]:
        """-> ``{"display_name", "version"}`` (the run's number in its new series)."""
        return self._request("PATCH", f"/api/runs/{run_id}", json={"display_name": name}).json()

    def delete_keys(self, run_id: str, table: str, keys: list[str]) -> None:
        self._request("DELETE", f"/api/runs/{run_id}/{table}", json={"keys": keys})

    def set_metric_rule(
        self, run_id: str, name: str, x: str | None, summary: str | None,
    ) -> None:
        self.post_json(
            f"/api/runs/{run_id}/metric-rules",
            {"name": name, "x": x, "summary": summary},
        )

    def sequence_steps(self, run_id: str) -> list[dict[str, Any]]:
        """Each of the run's series as ``{name, max_step}``."""
        return self.get(f"/api/runs/{run_id}/sequences").json()["sequences"]

    def upload_source(self, run_id: str, archive: bytes, manifest: dict[str, Any]) -> None:
        self.post_multipart(
            f"/api/runs/{run_id}/source",
            files={"archive": ("tree.tar.zst", archive, "application/zstd")},
            data={"manifest": json.dumps(manifest)},
        )

    def upload_artifact(
        self,
        data: bytes,
        mime_type: str,
        metadata: dict[str, Any] | None = None,
        object_type: str | None = None,
    ) -> str:
        """Hash, dedup-probe, upload if absent; return the sha256 digest."""
        digest = hashlib.sha256(data).hexdigest()
        if self.head(f"/api/artifacts/{digest}").status_code != 200:
            form_data: dict[str, Any] = {
                "mime_type": mime_type,
                "metadata": json.dumps(metadata or {}),
            }
            if object_type:
                form_data["object_type"] = object_type
            self.post_multipart(
                "/api/artifacts", files={"file": ("blob", data, mime_type)}, data=form_data,
            )
        return digest

    # ---- versioned artifact registry -----------------------------------------

    def _registry_request(self, method: str, path: str, **kwargs: Any) -> Any:
        """A registry call; a 4xx becomes ValueError/LookupError with the server's detail."""
        try:
            return self._request(method, path, **kwargs).json()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code >= 500:
                raise
            try:
                detail = exc.response.json().get("detail", exc.response.text)
            except ValueError:
                detail = exc.response.text
            raise (LookupError if exc.response.status_code == 404 else ValueError)(detail) from None

    def create_artifact_version(self, project_id: str, body: dict[str, Any]) -> dict[str, Any]:
        """Register an uploaded manifest as a new version -> the version dict."""
        return self._registry_request(
            "POST", f"/api/projects/{project_id}/artifact-versions", json=body,
        )

    def resolve_artifact(self, project_id: str, ref: str) -> dict[str, Any]:
        """``[project/]name[:alias|:vN]`` -> the version dict."""
        return self._registry_request(
            "POST", f"/api/projects/{project_id}/resolve-artifact-ref", json={"ref": ref},
        )

    def record_artifact_input(self, run_id: str, artifact_version_id: str, role: str) -> None:
        """Record that a run consumed an artifact version."""
        self._registry_request("POST", f"/api/runs/{run_id}/inputs", json={
            "artifact_version_id": artifact_version_id, "role": role,
        })

    def record_run_use(self, run_id: str, used_run_id: str, role: str | None) -> None:
        """Record that a run used another run directly."""
        self._registry_request("POST", f"/api/runs/{run_id}/uses", json={
            "run_id": used_run_id, "role": role,
        })

    def add_artifact_alias(self, version_id: str, alias: str) -> dict[str, Any]:
        return self._registry_request(
            "POST", f"/api/artifact-versions/{version_id}/aliases", json={"alias": alias},
        )

    def remove_artifact_alias(self, version_id: str, alias: str) -> dict[str, Any]:
        from urllib.parse import quote
        return self._registry_request(
            "DELETE", f"/api/artifact-versions/{version_id}/aliases/{quote(alias, safe='')}",
        )

    def add_artifact_tag(self, version_id: str, tag: str) -> dict[str, Any]:
        return self._registry_request(
            "POST", f"/api/artifact-versions/{version_id}/tags", json={"tag": tag},
        )

    def remove_artifact_tag(self, version_id: str, tag: str) -> dict[str, Any]:
        from urllib.parse import quote
        return self._registry_request(
            "DELETE", f"/api/artifact-versions/{version_id}/tags/{quote(tag, safe='')}",
        )

    def update_artifact_version(self, version_id: str, body: dict[str, Any]) -> dict[str, Any]:
        return self._registry_request("PATCH", f"/api/artifact-versions/{version_id}", json=body)

    def delete_artifact_version(self, version_id: str, force: bool) -> None:
        self._registry_request(
            "DELETE", f"/api/artifact-versions/{version_id}",
            params={"force": "true" if force else "false"},
        )

    def delete_artifact_family(self, project_id: str, name: str) -> None:
        from urllib.parse import quote
        fam = self._registry_request(
            "GET", f"/api/projects/{project_id}/artifact-families/by-name/{quote(name, safe='')}",
        )
        self._registry_request("DELETE", f"/api/artifact-families/{fam['id']}")

    def ingest_pending(self) -> int:
        """Have the server apply every pending run log of its repo now."""
        return int(self._request("POST", "/api/ingest/pending").json().get("ops", 0))

    def download_artifact_bytes(self, digest: str) -> bytes:
        """Download raw artifact bytes by hash."""
        resp = self._client.get(f"/api/artifacts/{digest}")
        resp.raise_for_status()
        return resp.content

    # ---- sweeps (not WAL ops: they need an answer now) ---------------------

    def _sweep_request(self, method: str, path: str, **kwargs: Any) -> Any:
        """A sweep call; a 4xx becomes ValueError/LookupError with the server's detail."""
        try:
            return self._request(method, path, **kwargs).json()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code >= 500:
                raise
            try:
                detail = exc.response.json().get("detail", exc.response.text)
            except ValueError:
                detail = exc.response.text
            raise (LookupError if exc.response.status_code == 404 else ValueError)(detail) from None

    def create_sweep(self, body: dict[str, Any]) -> dict[str, Any]:
        return self._sweep_request("POST", "/api/sweeps", json=body)

    def list_sweeps(self, project: str | None = None) -> list[dict[str, Any]]:
        params = {"project": project} if project else {}
        return self._sweep_request("GET", "/api/sweeps", params=params)["sweeps"]

    def get_sweep(self, sweep_id: str) -> dict[str, Any]:
        return self._sweep_request("GET", f"/api/sweeps/{sweep_id}")

    def sweep_action(self, sweep_id: str, action: str) -> dict[str, Any]:
        """``pause`` / ``resume`` / ``cancel``."""
        return self._sweep_request("POST", f"/api/sweeps/{sweep_id}/{action}")

    def next_trial(self, sweep_id: str) -> dict[str, Any]:
        return self._sweep_request("POST", f"/api/sweeps/{sweep_id}/next")

    def report_trial(self, sweep_id: str, trial_id: str, **body: Any) -> dict[str, Any]:
        """``run_id`` / ``value`` / ``status``; returns the trial."""
        return self._sweep_request(
            "POST", f"/api/sweeps/{sweep_id}/trials/{trial_id}/report", json=body,
        )
