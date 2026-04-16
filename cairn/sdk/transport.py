"""HTTP transport for the SDK — retries, backoff, dedup, spill-to-disk."""

from __future__ import annotations

import hashlib
import json
import logging
import random
import time
import uuid
from pathlib import Path
from typing import Any, Callable, TypeVar

import httpx
import platformdirs

log = logging.getLogger(__name__)

T = TypeVar("T")

DEFAULT_MAX_RETRIES = 5
DEFAULT_BACKOFF_CAP = 30.0
DEFAULT_BACKOFF_BASE = 1.0


def default_spill_dir() -> Path:
    return Path(platformdirs.user_cache_dir("cairn")) / "pending"


class Transport:
    """HTTP client with retries, exponential backoff, artifact dedup, spill-to-disk.

    The SDK uses one ``Transport`` per ``Run``. All methods are blocking;
    concurrency belongs to the caller (``MetricBuffer`` drives this from a
    daemon thread).
    """

    def __init__(
        self,
        server_url: str,
        *,
        timeout: float = 10.0,
        spill_dir: Path | None = None,
        max_retries: int = DEFAULT_MAX_RETRIES,
        backoff_base: float = DEFAULT_BACKOFF_BASE,
        backoff_cap: float = DEFAULT_BACKOFF_CAP,
        client: httpx.Client | None = None,
    ):
        self.server_url = server_url.rstrip("/")
        self.timeout = timeout
        self.spill_dir = Path(spill_dir) if spill_dir is not None else default_spill_dir()
        self.max_retries = max_retries
        self.backoff_base = backoff_base
        self.backoff_cap = backoff_cap
        # Allow injection of a pre-configured client (used by tests with
        # ASGITransport for in-process server access).
        self._client = client or httpx.Client(base_url=self.server_url, timeout=timeout)
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
        self, method: str, path: str, **kwargs: Any
    ) -> httpx.Response:
        def call() -> httpx.Response:
            resp = self._client.request(method, path, **kwargs)
            resp.raise_for_status()
            return resp

        return self._retry(call)

    def post_json(self, path: str, body: dict[str, Any]) -> httpx.Response:
        return self._request("POST", path, json=body)

    def post_multipart(
        self, path: str, files: dict[str, Any], data: dict[str, Any] | None = None
    ) -> httpx.Response:
        return self._request("POST", path, files=files, data=data or {})

    def get(self, path: str, params: dict[str, Any] | None = None) -> httpx.Response:
        return self._request("GET", path, params=params or {})

    def head(self, path: str) -> httpx.Response:
        """HEAD does not raise on 404 — used for dedup probes."""
        def call() -> httpx.Response:
            return self._client.request("HEAD", path)

        return self._retry(call)

    def delete(self, path: str) -> httpx.Response:
        return self._request("DELETE", path)

    # ---- spill-to-disk ----------------------------------------------------

    def _spill_path(self, run_id: str) -> Path:
        d = self.spill_dir / run_id
        d.mkdir(parents=True, exist_ok=True)
        return d / f"{uuid.uuid4().hex}.json"

    def _spill(self, run_id: str, path: str, body: dict[str, Any]) -> None:
        target = self._spill_path(run_id)
        target.write_text(json.dumps({"path": path, "body": body}))
        log.warning("spilled request for run %s to %s", run_id, target)

    # ---- high-level ops ----------------------------------------------------

    def create_run(self, body: dict[str, Any]) -> dict[str, Any]:
        return self.post_json("/api/runs", body).json()

    def post_batch(self, run_id: str, points: list[dict[str, Any]]) -> bool:
        """Post a sequence batch. On final failure, spill to disk; return False."""
        try:
            self.post_json(f"/api/runs/{run_id}/batch", {"points": points})
            return True
        except (httpx.HTTPError, OSError) as exc:
            log.warning("batch POST failed for %s: %s", run_id, exc)
            self._spill(run_id, f"/api/runs/{run_id}/batch", {"points": points})
            return False

    def post_params(self, run_id: str, params: dict[str, Any]) -> None:
        self.post_json(f"/api/runs/{run_id}/params", {"params": params})

    def post_logs(self, run_id: str, lines: list[dict[str, Any]]) -> bool:
        try:
            self.post_json(f"/api/runs/{run_id}/logs", {"lines": lines})
            return True
        except httpx.HTTPError as exc:
            log.warning("logs POST failed for %s: %s", run_id, exc)
            self._spill(run_id, f"/api/runs/{run_id}/logs", {"lines": lines})
            return False

    def finish_run(
        self, run_id: str, status: str, exit_code: int | None = None
    ) -> None:
        self.post_json(
            f"/api/runs/{run_id}/finish", {"status": status, "exit_code": exit_code}
        )

    def set_tags(self, run_id: str, tags: list[str]) -> None:
        self.post_json(f"/api/runs/{run_id}/tags", {"tags": tags})

    def set_notes(self, run_id: str, notes: str) -> None:
        self.post_json(f"/api/runs/{run_id}/notes", {"notes": notes})

    def attach_artifact(
        self, run_id: str, name: str, digest: str, step: int | None = None
    ) -> None:
        self.post_json(
            f"/api/runs/{run_id}/artifacts",
            {"name": name, "hash": digest, "step": step},
        )

    def upload_source(self, run_id: str, archive: bytes, manifest: dict[str, Any]) -> None:
        self.post_multipart(
            f"/api/runs/{run_id}/source",
            files={"archive": ("tree.tar.zst", archive, "application/zstd")},
            data={"manifest": json.dumps(manifest)},
        )

    def upload_artifact(
        self, data: bytes, mime_type: str, metadata: dict[str, Any] | None = None
    ) -> str:
        """Hash, dedup-probe, upload if absent; return the sha256 digest."""
        digest = hashlib.sha256(data).hexdigest()
        head_resp = self.head(f"/api/artifacts/{digest}")
        if head_resp.status_code == 200:
            return digest
        self.post_multipart(
            "/api/artifacts",
            files={"file": ("blob", data, mime_type)},
            data={"mime_type": mime_type, "metadata": json.dumps(metadata or {})},
        )
        return digest

    def drain_spill(self, run_id: str | None = None) -> int:
        """Replay any spilled JSON payloads. Return count of successfully replayed."""
        if not self.spill_dir.exists():
            return 0
        targets = (
            [self.spill_dir / run_id] if run_id else list(self.spill_dir.iterdir())
        )
        replayed = 0
        for run_dir in targets:
            if not run_dir.is_dir():
                continue
            for spill_file in sorted(run_dir.glob("*.json")):
                try:
                    payload = json.loads(spill_file.read_text())
                    self.post_json(payload["path"], payload["body"])
                    spill_file.unlink()
                    replayed += 1
                except (httpx.HTTPError, OSError, json.JSONDecodeError) as exc:
                    log.warning("spill replay failed for %s: %s", spill_file, exc)
                    break  # stop replaying on first error for this run
            # Cleanup empty run dir
            try:
                if not any(run_dir.iterdir()):
                    run_dir.rmdir()
            except OSError:
                pass
        return replayed
