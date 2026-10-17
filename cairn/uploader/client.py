"""The HTTP side of uploading: the server's ingestion protocol (0.6 spec §4).

``GET  /api/ingest/runs/{run_id}/logs/{log}``  -> ``{"applied_seq": n}``
``POST /api/ingest/runs/{run_id}/logs/{log}``  ``{"from_seq", "records"}`` -> ``{"applied_seq"}``
                                                (409 + applied_seq on a gap)
``HEAD /api/blobs/{sha256}`` / ``PUT /api/blobs/{sha256}`` (raw body)
"""

from __future__ import annotations

import email.utils
import gzip
import json
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx

#: Bodies above this are gzipped.
GZIP_ABOVE = 64 << 10
#: A batch's JSON body stays below this (the server takes up to 8 MiB).
MAX_BODY = 6 << 20


class UploadError(Exception):
    """An upload attempt failed; retry later.

    ``retry_after``: seconds the server asked to wait (429/503), else None.
    ``rejected``: the server refused the request itself (a 4xx other than
    auth, timeout or rate limit): retrying cannot help until something
    changes, so the uploader backs off to the maximum.
    """

    def __init__(
        self, message: str, *, retry_after: float | None = None, rejected: bool = False,
        status: int | None = None,
    ):
        super().__init__(message)
        self.retry_after = retry_after
        self.rejected = rejected
        self.status = status


class UploadPending(UploadError):
    """A valid batch awaits its primary run; keep its journal unacknowledged."""


class Gap(Exception):
    """409: the server has applied less than the batch assumes (resend from
    ``applied_seq + 1``), or lacks blobs the batch references
    (``missing_blobs``: PUT them, then resend; nothing was applied)."""

    def __init__(self, applied_seq: int, missing_blobs: list[str] | None = None):
        super().__init__(f"server applied_seq is {applied_seq}"
                         + (f", missing blobs {missing_blobs}" if missing_blobs else ""))
        self.applied_seq = applied_seq
        self.missing_blobs = list(missing_blobs or [])


_TRANSIENT_4XX = frozenset({401, 403, 408, 425, 429})


def _retry_after(resp: httpx.Response) -> float | None:
    value = resp.headers.get("Retry-After")
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        pass
    try:
        when = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    return max(0.0, when.timestamp() - time.time())


def _applied(body: Any) -> int | None:
    if isinstance(body, dict):
        for src in (body, body.get("detail")):
            if isinstance(src, dict) and isinstance(src.get("applied_seq"), int):
                return src["applied_seq"]
    return None


class IngestClient:
    """One server's ingestion endpoints.

    Args:
        url: The server's base URL.
        token: Bearer token (writer role).
        client: A ready ``httpx.Client`` to send through instead (its base
            URL is the server; e.g. a FastAPI ``TestClient``). The caller
            keeps ownership.
    """

    def __init__(
        self, url: str, token: str | None = None, *, client: httpx.Client | None = None,
        timeout: float = 30.0,
    ) -> None:
        self.url = url.rstrip("/")
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        self._own = client is None
        self._client = client or httpx.Client(base_url=self.url, timeout=timeout, headers=headers)
        if client is not None and token:
            self._client.headers.update(headers)
        #: Blobs the server is known to hold (HEAD 200 or PUT done).
        self.known_blobs: set[str] = set()

    def close(self) -> None:
        if self._own:
            self._client.close()

    # ---- plumbing ------------------------------------------------------------

    def _send(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        try:
            resp = self._client.request(method, path, **kwargs)
        except httpx.HTTPError as exc:
            raise UploadError(f"{method} {path}: {type(exc).__name__}: {exc}") from None
        if resp.status_code in (429, 503):
            raise UploadError(
                f"{method} {path}: not now ({resp.status_code}) {resp.text[:200]}",
                retry_after=_retry_after(resp), status=resp.status_code,
            )
        if resp.status_code >= 500:
            raise UploadError(f"{method} {path}: server error {resp.status_code}",
                              status=resp.status_code)
        if resp.status_code >= 400 and resp.status_code not in (404, 409):
            raise UploadError(
                f"{method} {path}: {resp.status_code} {resp.text[:300]}",
                rejected=resp.status_code not in _TRANSIENT_4XX, status=resp.status_code,
            )
        return resp

    @staticmethod
    def _log_path(run_id: str, log: str) -> str:
        return f"/api/ingest/runs/{quote(run_id, safe='')}/logs/{quote(log, safe='')}"

    # ---- records ---------------------------------------------------------------

    def applied_seq(self, run_id: str, log: str) -> int:
        resp = self._send("GET", self._log_path(run_id, log))
        if resp.status_code == 404:
            return 0
        seq = _applied(_json(resp))
        if seq is None:
            raise UploadError(f"GET {self._log_path(run_id, log)}: no applied_seq in the answer")
        return seq

    def post_records(self, run_id: str, log: str, records: list[dict[str, Any]]) -> int:
        """Send ``records`` (consecutive seqs); returns the server's applied_seq.

        Raises:
            Gap: 409, the server's applied_seq is below ``from_seq - 1``.
            UploadError: Anything else went wrong.
        """
        path = self._log_path(run_id, log)
        body = json.dumps({"from_seq": records[0]["seq"], "records": records},
                          separators=(",", ":")).encode()
        headers = {"Content-Type": "application/json"}
        if len(body) > GZIP_ABOVE:
            body = gzip.compress(body, compresslevel=5)
            headers["Content-Encoding"] = "gzip"
        resp = self._send("POST", path, content=body, headers=headers)
        if resp.status_code == 409:
            body = _json(resp)
            seq = _applied(body)
            if seq is None:
                raise UploadError(f"POST {path}: 409 without applied_seq: {resp.text[:200]}")
            missing = None
            for src in (body, body.get("detail") if isinstance(body, dict) else None):
                if isinstance(src, dict) and isinstance(src.get("missing_blobs"), list):
                    missing = [str(h) for h in src["missing_blobs"]]
            raise Gap(seq, missing)
        if resp.status_code == 404:
            raise UploadError(f"POST {path}: 404 (no ingestion endpoint?)", rejected=True)
        seq = _applied(_json(resp))
        if seq is None:
            raise UploadError(f"POST {path}: no applied_seq in the answer")
        return seq

    # ---- blobs -----------------------------------------------------------------

    def ensure_blob(self, digest: str, path: Path) -> bool:
        """Make sure the server holds blob ``digest`` (HEAD, then PUT from
        ``path``). False when the server lacks it and ``path`` does not exist."""
        if digest in self.known_blobs:
            return True
        resp = self._send("HEAD", f"/api/blobs/{digest}")
        if resp.status_code != 200:
            try:
                fh = open(path, "rb")  # noqa: SIM115
            except FileNotFoundError:
                return False
            with fh:
                self._send(
                    "PUT", f"/api/blobs/{digest}", content=fh,
                    headers={"Content-Type": "application/octet-stream"},
                )
        self.known_blobs.add(digest)
        return True


def _json(resp: httpx.Response) -> Any:
    try:
        return resp.json()
    except ValueError:
        return None
