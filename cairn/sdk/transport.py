"""HTTP transport for the SDK — retries, backoff, dedup, WAL + spill-to-disk."""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import random
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable, TypeVar

import httpx
import platformdirs

from .. import config as _config
from .wal import WALEntry, WriteAheadLog

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

#: 4xx statuses that are not a verdict on the request itself: a credential
#: fixed later, a timeout, a rate limit. Every other 4xx is final.
_TRANSIENT_4XX = frozenset({401, 403, 408, 425, 429})


def _rejected(exc: Exception) -> bool:
    """The server refused this request for good (resending cannot help)."""
    return (
        isinstance(exc, httpx.HTTPStatusError)
        and exc.response.status_code < 500
        and exc.response.status_code not in _TRANSIENT_4XX
    )


def default_spill_dir() -> Path:
    return Path(platformdirs.user_cache_dir("cairn")) / "pending"


class Transport:
    """HTTP client with retries, exponential backoff, artifact dedup, WAL.

    The SDK uses one ``Transport`` per ``Run``. All methods are blocking;
    concurrency belongs to the caller (``MetricBuffer`` drives this from a
    daemon thread).

    When a WAL is attached, every event is written to the WAL before being
    sent, and the WAL is the queue (see ``_deliver``):

    * an event is sent ONCE. A timeout is not retried in place: the server
      may still be working on it, and resending a slow request piles more
      work on a server that is already behind (timed-out batches used to be
      sent up to five times while the first copy was still being written).
    * a failure (timeout, connection error, 5xx) marks the server down for
      a backoff that doubles up to ``backoff_cap``; meanwhile events are
      only appended to the WAL, so no caller waits on a dead or overloaded
      server.
    * once the backoff ends, a flush thread (``catch_up``) replays the
      pending events in order, then sending resumes directly.
    * an event the server rejects (a 4xx other than auth/timeout/rate
      limit) goes to the run's dead-letter file and is skipped, so the
      events behind it are not blocked.
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
        token: str | None = None,
    ):
        self.server_url = server_url.rstrip("/")
        self.timeout = timeout
        self.spill_dir = Path(spill_dir) if spill_dir is not None else default_spill_dir()
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
        self._wal = wal
        # Backoff state for WAL-backed sends (see the class docstring).
        self._state_lock = threading.Lock()
        self._down_until = 0.0  # time.monotonic() before which nothing is sent
        self._backoff = 0.0
        # Some WAL events were not delivered in order: send nothing directly
        # until a replay has caught up.
        self._behind = False
        self._replay_lock = threading.Lock()  # one replay at a time

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

    # ---- WAL-backed delivery (see the class docstring) ---------------------

    def _backing_off(self) -> bool:
        return time.monotonic() < self._down_until

    def _mark_down(self, exc: BaseException) -> None:
        with self._state_lock:
            self._behind = True
            first = self._backoff == 0.0
            self._backoff = min(
                self.backoff_cap, max(self.backoff_base, self._backoff * 2),
            )
            self._down_until = time.monotonic() + self._backoff * random.uniform(1.0, 1.25)
        if first:
            log.warning(
                "cairn server %s unreachable or overloaded (%s); logging to the "
                "local WAL and retrying in the background", self.server_url, exc,
            )

    def _mark_up(self) -> None:
        with self._state_lock:
            recovered = self._backoff != 0.0
            self._backoff = 0.0
            self._down_until = 0.0
        if recovered:
            log.info("cairn server %s reachable again", self.server_url)

    def _dead_letter(self, entry: WALEntry, exc: Exception) -> None:
        assert self._wal is not None
        log.warning(
            "server rejected %s (WAL seq %d): %s; kept in %s", entry.op, entry.seq,
            exc, self._wal.dead_letter_path,
        )
        self._wal.dead_letter(entry, str(exc))

    def _deliver(
        self, entry: WALEntry, send: Callable[[], Any], *, catch_up: bool,
    ) -> bool:
        """Deliver ``entry`` (already appended to the WAL) once, or leave it
        pending. ``catch_up``: the caller is a flush thread, which may replay
        a backlog; the training thread never does (it would stall)."""
        assert self._wal is not None
        if self._behind or self._backing_off():
            self._behind = True
            return self.catch_up() if catch_up else False
        try:
            send()
        except (httpx.HTTPError, OSError) as exc:
            if _rejected(exc):
                self._dead_letter(entry, exc)
            else:
                self._mark_down(exc)
            return False
        self._wal.ack(entry.seq)
        self._mark_up()
        return True

    def catch_up(self) -> bool:
        """Replay pending WAL events if the server's backoff is over; True
        once nothing is behind. Never blocks on another thread's replay."""
        if not self._behind:
            return True
        if self._wal is None or self._backing_off():
            return False
        if not self._replay_lock.acquire(blocking=False):
            return False
        try:
            _, done = self._replay_pending(None)
        finally:
            self._replay_lock.release()
        return done

    def _replay_pending(self, deadline: float | None) -> tuple[int, bool]:
        """Replay pending WAL events in order, once each, until one fails or
        ``deadline`` (``time.monotonic()``) passes -> (replayed, all done)."""
        assert self._wal is not None
        replayed = 0
        for entry in self._wal.pending():
            if deadline is not None and time.monotonic() > deadline:
                return replayed, False
            try:
                self._replay_wal_entry(entry)
            except (httpx.HTTPError, OSError) as exc:
                if _rejected(exc):
                    self._dead_letter(entry, exc)
                    continue
                log.warning("WAL replay failed at seq %d: %s", entry.seq, exc)
                self._mark_down(exc)
                return replayed, False
            self._wal.ack(entry.seq)
            replayed += 1
        self._behind = False
        self._mark_up()
        return replayed, True

    def _logged(
        self, op: str, payload: dict[str, Any], path: str, body: dict[str, Any],
        *, catch_up: bool,
    ) -> bool:
        """Append ``op`` to the WAL and deliver it as a JSON POST."""
        assert self._wal is not None
        seq = self._wal.append(op, payload)
        return self._deliver(
            WALEntry(seq, op, payload),
            lambda: self.post_json(path, body, retry=False),
            catch_up=catch_up,
        )

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
        """Post a sequence batch (from a flush thread). With a WAL, the batch
        is durable before it is sent; False when it was left pending."""
        path = f"/api/runs/{run_id}/batch"
        if self._wal is not None:
            return self._logged("batch", {"run_id": run_id, "points": points}, path,
                                {"points": points}, catch_up=True)
        try:
            self.post_json(path, {"points": points})
            return True
        except (httpx.HTTPError, OSError) as exc:
            log.warning("batch POST failed for %s: %s", run_id, exc)
            self._spill(run_id, path, {"points": points})
            return False

    def defer_batch(self, run_id: str, points: list[dict[str, Any]]) -> None:
        """Log a batch to the WAL without sending it now; ``catch_up`` (or
        ``finish``) sends it. How a full buffer sheds load without blocking
        the training loop."""
        if self._wal is None:
            self.post_batch(run_id, points)
            return
        self._wal.append("batch", {"run_id": run_id, "points": points})
        self._behind = True

    def post_params(self, run_id: str, params: dict[str, Any]) -> None:
        path = f"/api/runs/{run_id}/params"
        if self._wal is not None:
            self._logged("params", {"run_id": run_id, "params": params}, path,
                         {"params": params}, catch_up=False)
            return
        try:
            self.post_json(path, {"params": params})
        except (httpx.HTTPError, OSError) as exc:
            log.warning("params POST failed for %s: %s", run_id, exc)

    def post_summary(self, run_id: str, summary: dict[str, Any]) -> None:
        path = f"/api/runs/{run_id}/summary"
        if self._wal is not None:
            self._logged("summary", {"run_id": run_id, "summary": summary}, path,
                         {"summary": summary}, catch_up=False)
            return
        try:
            self.post_json(path, {"summary": summary})
        except (httpx.HTTPError, OSError) as exc:
            log.warning("summary POST failed for %s: %s", run_id, exc)

    def post_logs(self, run_id: str, lines: list[dict[str, Any]]) -> bool:
        path = f"/api/runs/{run_id}/logs"
        if self._wal is not None:
            return self._logged("logs", {"run_id": run_id, "lines": lines}, path,
                                {"lines": lines}, catch_up=True)
        try:
            self.post_json(path, {"lines": lines})
            return True
        except (httpx.HTTPError, OSError) as exc:
            log.warning("logs POST failed for %s: %s", run_id, exc)
            self._spill(run_id, path, {"lines": lines})
            return False

    def finish_run(
        self, run_id: str, status: str, exit_code: int | None = None,
        ended_at: str | None = None, *, deadline: float | None = None,
    ) -> bool:
        """Mark the run finished. With a WAL: logged, then everything still
        pending is replayed in order until ``deadline`` (``time.monotonic()``);
        False if something is left for ``cairn sync``. Never raises for an
        unreachable server then."""
        body = {"status": status, "exit_code": exit_code, "ended_at": ended_at}
        if self._wal is None:
            self.post_json(f"/api/runs/{run_id}/finish", body)
            return True
        self._wal.append("finish", {"run_id": run_id, **body})
        self._behind = True
        self.drain_wal(deadline=deadline, wait_backoff=True)
        return not self._behind

    def set_tags(self, run_id: str, tags: list[str]) -> None:
        self.post_json(f"/api/runs/{run_id}/tags", {"tags": tags})

    def set_notes(self, run_id: str, notes: str) -> None:
        self.post_json(f"/api/runs/{run_id}/notes", {"notes": notes})

    def rename_run(self, run_id: str, name: str) -> None:
        self._request("PATCH", f"/api/runs/{run_id}", json={"display_name": name})

    def delete_keys(self, run_id: str, table: str, keys: list[str]) -> None:
        self._request("DELETE", f"/api/runs/{run_id}/{table}", json={"keys": keys})

    def alert(self, run_id: str, alert: dict[str, Any]) -> None:
        """``alert``: alert_id, title, text, level, created_at."""
        self.post_json(f"/api/runs/{run_id}/alerts", alert)

    def heartbeat(self, run_id: str) -> str | None:
        """Returns the run's ``stop_requested`` timestamp, if any."""
        return self.post_json(f"/api/runs/{run_id}/heartbeat", {}).json().get("stop_requested")

    def set_metric_rule(
        self, run_id: str, name: str, x: str | None, summary: str | None,
    ) -> None:
        self.post_json(
            f"/api/runs/{run_id}/metric-rules",
            {"name": name, "x": x, "summary": summary},
        )

    def resume_run(self, run_id: str) -> dict[str, Any]:
        return self.post_json(f"/api/runs/{run_id}/resume", {}).json()

    def rewind_run(self, run_id: str, step: int) -> dict[str, Any]:
        return self.post_json(f"/api/runs/{run_id}/rewind", {"step": step}).json()

    def fork_run(
        self, parent_id: str, new_id: str, step: int, body: dict[str, Any],
    ) -> dict[str, Any]:
        """``body`` is the child's create body (the ``create_run`` shape)."""
        fields = {k: v for k, v in body.items() if k not in ("project", "run_id", "created_at",
                                                            "parent_run_id", "fork_step")}
        return self.post_json(
            f"/api/runs/{parent_id}/fork", {**fields, "new_id": new_id, "step": step},
        ).json()

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
        """Hash, dedup-probe, upload if absent; return the sha256 digest.

        Called on the training thread: with a WAL it makes one attempt at
        most, and none while the server is backing off (the upload then
        waits in the WAL)."""
        digest = hashlib.sha256(data).hexdigest()

        def send() -> None:
            head_resp = self.head(f"/api/artifacts/{digest}", retry=self._wal is None)
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
                    data=form_data, retry=self._wal is None,
                )

        if self._wal is None:
            try:
                send()
            except (httpx.HTTPError, OSError) as exc:
                log.warning("artifact upload failed: %s", exc)
            return digest
        payload = self._wal.artifact_payload(data, mime_type, metadata, object_type)
        seq = self._wal.append("artifact", payload)
        self._deliver(WALEntry(seq, "artifact", payload), send, catch_up=False)
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

    def drain_wal(
        self, *, deadline: float | None = None, wait_backoff: bool = False,
    ) -> int:
        """Replay pending WAL entries in order, ignoring any backoff; stop at
        the first failure or at ``deadline`` (``time.monotonic()``). Return
        the count replayed. ``wait_backoff``: on a failure, wait out the
        backoff and try again while the deadline allows (``finish``)."""
        if not self._wal or not self._wal.has_pending:
            self._behind = False
            return 0
        replayed = 0
        while True:
            with self._replay_lock:
                n, done = self._replay_pending(deadline)
            replayed += n
            if done or not wait_backoff or deadline is None:
                return replayed
            resume = self._down_until
            if resume >= deadline:
                return replayed
            time.sleep(max(0.0, resume - time.monotonic()))

    def _replay_wal_entry(self, entry: "WriteAheadLog | Any") -> None:
        """Replay a single WAL entry by re-executing the operation."""
        from .wal import WALEntry
        e: WALEntry = entry
        p = e.payload
        # Once each: a failure is the caller's to back off from.
        if e.op == "batch":
            self.post_json(f"/api/runs/{p['run_id']}/batch", {"points": p["points"]}, retry=False)
        elif e.op == "params":
            self.post_json(f"/api/runs/{p['run_id']}/params", {"params": p["params"]}, retry=False)
        elif e.op == "summary":
            self.post_json(f"/api/runs/{p['run_id']}/summary", {"summary": p["summary"]}, retry=False)
        elif e.op == "logs":
            self.post_json(f"/api/runs/{p['run_id']}/logs", {"lines": p["lines"]}, retry=False)
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
            head_resp = self.head(f"/api/artifacts/{digest}", retry=False)
            if head_resp.status_code != 200:
                form = {"mime_type": mime_type, "metadata": json.dumps(metadata)}
                if p.get("object_type"):
                    form["object_type"] = p["object_type"]
                self.post_multipart(
                    "/api/artifacts",
                    files={"file": ("blob", data, mime_type)},
                    data=form, retry=False,
                )
        elif e.op == "finish":
            self.post_json(
                f"/api/runs/{p['run_id']}/finish",
                {"status": p.get("status", "completed"), "exit_code": p.get("exit_code"),
                 "ended_at": p.get("ended_at")},
                retry=False,
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
