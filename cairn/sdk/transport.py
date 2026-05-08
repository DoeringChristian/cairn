"""HTTP transport for the SDK — retries, backoff, dedup, WAL + spill-to-disk."""

from __future__ import annotations

import base64
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

from .wal import WriteAheadLog

log = logging.getLogger(__name__)

T = TypeVar("T")

DEFAULT_MAX_RETRIES = 5
DEFAULT_BACKOFF_CAP = 30.0
DEFAULT_BACKOFF_BASE = 1.0


def default_spill_dir() -> Path:
    return Path(platformdirs.user_cache_dir("cairn")) / "pending"


class Transport:
    """HTTP client with retries, exponential backoff, artifact dedup, WAL.

    The SDK uses one ``Transport`` per ``Run``. All methods are blocking;
    concurrency belongs to the caller (``MetricBuffer`` drives this from a
    daemon thread).

    When a WAL is attached, every event is written to the WAL before being
    sent. On failure, the event stays in the WAL and can be replayed later.
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
        wal: WriteAheadLog | None = None,
    ):
        self.server_url = server_url.rstrip("/")
        self.timeout = timeout
        self.spill_dir = Path(spill_dir) if spill_dir is not None else default_spill_dir()
        self.max_retries = max_retries
        self.backoff_base = backoff_base
        self.backoff_cap = backoff_cap
        self._client = client or httpx.Client(base_url=self.server_url, timeout=timeout)
        self._owns_client = client is None
        self._wal = wal

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
        """Post a sequence batch. WAL ensures data is durable before sending."""
        seq = self._wal.append("batch", {"run_id": run_id, "points": points}) if self._wal else None
        try:
            self.post_json(f"/api/runs/{run_id}/batch", {"points": points})
            if seq is not None and self._wal:
                self._wal.checkpoint(seq)
            return True
        except (httpx.HTTPError, OSError) as exc:
            log.warning("batch POST failed for %s (WAL seq %s): %s", run_id, seq, exc)
            if self._wal is None:
                # No WAL — fall back to legacy spill
                self._spill(run_id, f"/api/runs/{run_id}/batch", {"points": points})
            return False

    def post_params(self, run_id: str, params: dict[str, Any]) -> None:
        seq = self._wal.append("params", {"run_id": run_id, "params": params}) if self._wal else None
        try:
            self.post_json(f"/api/runs/{run_id}/params", {"params": params})
            if seq is not None and self._wal:
                self._wal.checkpoint(seq)
        except (httpx.HTTPError, OSError) as exc:
            log.warning("params POST failed for %s (WAL seq %s): %s", run_id, seq, exc)

    def post_logs(self, run_id: str, lines: list[dict[str, Any]]) -> bool:
        seq = self._wal.append("logs", {"run_id": run_id, "lines": lines}) if self._wal else None
        try:
            self.post_json(f"/api/runs/{run_id}/logs", {"lines": lines})
            if seq is not None and self._wal:
                self._wal.checkpoint(seq)
            return True
        except (httpx.HTTPError, OSError) as exc:
            log.warning("logs POST failed for %s (WAL seq %s): %s", run_id, seq, exc)
            if self._wal is None:
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

    def heartbeat(self, run_id: str) -> None:
        self.post_json(f"/api/runs/{run_id}/heartbeat", {})

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
        self,
        data: bytes,
        mime_type: str,
        metadata: dict[str, Any] | None = None,
        object_type: str | None = None,
    ) -> str:
        """Hash, dedup-probe, upload if absent; return the sha256 digest."""
        digest = hashlib.sha256(data).hexdigest()
        seq = self._wal.append_artifact(data, mime_type, metadata) if self._wal else None
        try:
            head_resp = self.head(f"/api/artifacts/{digest}")
            if head_resp.status_code != 200:
                form_data: dict[str, Any] = {
                    "mime_type": mime_type,
                    "metadata": json.dumps(metadata or {}),
                }
                if object_type:
                    form_data["object_type"] = object_type
                self.post_multipart(
                    "/api/artifacts",
                    files={"file": ("blob", data, mime_type)},
                    data=form_data,
                )
            if seq is not None and self._wal:
                self._wal.checkpoint(seq)
        except (httpx.HTTPError, OSError) as exc:
            log.warning("artifact upload failed (WAL seq %s): %s", seq, exc)
        return digest

    def drain_wal(self) -> int:
        """Replay pending WAL entries. Return count replayed."""
        if not self._wal or not self._wal.has_pending:
            return 0
        replayed = 0
        for entry in self._wal.pending():
            try:
                self._replay_wal_entry(entry)
                self._wal.checkpoint(entry.seq)
                replayed += 1
            except (httpx.HTTPError, OSError) as exc:
                log.warning("WAL replay failed at seq %d: %s", entry.seq, exc)
                break  # stop on first error to preserve order
        return replayed

    def _replay_wal_entry(self, entry: "WriteAheadLog | Any") -> None:
        """Replay a single WAL entry by re-executing the operation."""
        from .wal import WALEntry
        e: WALEntry = entry
        p = e.payload
        if e.op == "batch":
            self.post_json(f"/api/runs/{p['run_id']}/batch", {"points": p["points"]})
        elif e.op == "params":
            self.post_json(f"/api/runs/{p['run_id']}/params", {"params": p["params"]})
        elif e.op == "logs":
            self.post_json(f"/api/runs/{p['run_id']}/logs", {"lines": p["lines"]})
        elif e.op == "artifact":
            # Reconstruct artifact data from inline or file
            if "data_b64" in p:
                data = base64.b64decode(p["data_b64"])
            elif "data_file" in p:
                data = Path(p["data_file"]).read_bytes()
            else:
                log.warning("WAL artifact entry has no data at seq %d", e.seq)
                return
            mime_type = p.get("mime_type", "application/octet-stream")
            metadata = p.get("metadata", {})
            digest = hashlib.sha256(data).hexdigest()
            head_resp = self.head(f"/api/artifacts/{digest}")
            if head_resp.status_code != 200:
                self.post_multipart(
                    "/api/artifacts",
                    files={"file": ("blob", data, mime_type)},
                    data={"mime_type": mime_type, "metadata": json.dumps(metadata)},
                )
        elif e.op == "finish":
            self.post_json(
                f"/api/runs/{p['run_id']}/finish",
                {"status": p.get("status", "completed"), "exit_code": p.get("exit_code")},
            )
        else:
            log.warning("unknown WAL op %r at seq %d", e.op, e.seq)

    def drain_spill(self, run_id: str | None = None) -> int:
        """Replay WAL + any legacy spilled JSON payloads."""
        total = 0
        # Drain WAL first (ordered)
        try:
            total += self.drain_wal()
        except Exception:  # noqa: BLE001
            log.warning("WAL drain failed", exc_info=True)
        # Then drain legacy spill dir
        if not self.spill_dir.exists():
            return total
        targets = (
            [self.spill_dir / run_id] if run_id else list(self.spill_dir.iterdir())
        )
        for run_dir in targets:
            if not run_dir.is_dir():
                continue
            for spill_file in sorted(run_dir.glob("*.json")):
                try:
                    payload = json.loads(spill_file.read_text())
                    self.post_json(payload["path"], payload["body"])
                    spill_file.unlink()
                    total += 1
                except (httpx.HTTPError, OSError, json.JSONDecodeError) as exc:
                    log.warning("spill replay failed for %s: %s", spill_file, exc)
                    break
            try:
                if not any(run_dir.iterdir()):
                    run_dir.rmdir()
            except OSError:
                pass
        return total
