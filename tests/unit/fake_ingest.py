"""A fake cairn server implementing the 0.6 ingestion protocol (spec §4),
for the uploader's tests: in process (``httpx.MockTransport``) or on a real
socket (``serve``), with fault injection.

Exactly once is the server's half of the contract: it applies records with
``seq > applied_seq`` in order and ignores the rest. The fake counts every
apply, so a test can assert each record was applied once, and that the
client never made the server skip one (``violations``).
"""

from __future__ import annotations

import gzip
import hashlib
import json
import random
import re
import threading
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import httpx

from cairn.sdk.runlog.codec import record_blobs

_LOG = re.compile(r"^/api/ingest/runs/([^/]+)/logs/([^/]+)$")
_BLOB = re.compile(r"^/api/blobs/([0-9a-f]{64})$")

#: What a fault hook returns: None (serve normally), ("status", code,
#: headers), "drop" (close the connection before handling) or "drop_after"
#: (handle, then close the connection without answering).
Fault = Any


class FakeIngest:
    def __init__(
        self,
        *,
        fault: Callable[[str, str], Fault] | None = None,
        apply_fn: Callable[[str, str, dict[str, Any]], None] | None = None,
        max_body: int | None = None,
    ) -> None:
        self.lock = threading.Lock()
        self.applied: dict[tuple[str, str], int] = {}
        self.records: dict[tuple[str, str], list[dict[str, Any]]] = {}
        self.blobs: dict[str, bytes] = {}
        self.apply_counts: dict[tuple[str, str, int], int] = {}
        self.violations: list[str] = []
        self.requests: list[tuple[str, str]] = []
        self.fault = fault
        self.apply_fn = apply_fn
        #: Bodies (as received) above this get a 413.
        self.max_body = max_body

    # ---- the protocol ------------------------------------------------------------

    def handle(self, method: str, path: str, headers: dict[str, str], body: bytes) -> tuple[int, dict[str, str], bytes]:
        with self.lock:
            self.requests.append((method, path))
        m = _LOG.match(path)
        if m:
            key = (m.group(1), m.group(2))
            if method == "GET":
                with self.lock:
                    return _json(200, {"applied_seq": self.applied.get(key, 0)})
            if method == "POST":
                if self.max_body is not None and len(body) > self.max_body:
                    return _json(413, {"detail": "body too large"})
                if headers.get("content-encoding") == "gzip":
                    body = gzip.decompress(body)
                req = json.loads(body)
                return self._post(key, req)
        m = _BLOB.match(path)
        if m:
            digest = m.group(1)
            if method == "HEAD":
                with self.lock:
                    return (200 if digest in self.blobs else 404), {}, b""
            if method == "PUT":
                if hashlib.sha256(body).hexdigest() != digest:
                    return _json(400, {"detail": "hash mismatch"})
                with self.lock:
                    self.blobs[digest] = body
                return _json(200, {"hash": digest})
        return _json(404, {"detail": "not found"})

    def _post(self, key: tuple[str, str], req: dict[str, Any]) -> tuple[int, dict[str, str], bytes]:
        from_seq = req["from_seq"]
        records = req["records"]
        with self.lock:
            applied = self.applied.get(key, 0)
            if from_seq > applied + 1:
                return _json(409, {"applied_seq": applied})
            for i, rec in enumerate(records):
                if rec["seq"] != from_seq + i:
                    return _json(400, {"detail": "seqs not consecutive"})
            # Like the real server: every referenced blob first, else 409 and
            # nothing applied.
            missing = sorted({h for rec in records if rec["seq"] > applied
                              for h in record_blobs(rec) if h not in self.blobs})
            if missing:
                return _json(409, {"applied_seq": applied, "missing_blobs": missing})
            for rec in records:
                if rec["seq"] <= applied:
                    continue  # exactly once: already applied
                for digest in record_blobs(rec):
                    if digest not in self.blobs:
                        self.violations.append(f"{key} seq {rec['seq']}: blob {digest} missing")
                if self.apply_fn is not None:
                    self.apply_fn(key[0], key[1], rec)
                ck = (key[0], key[1], rec["seq"])
                self.apply_counts[ck] = self.apply_counts.get(ck, 0) + 1
                self.records.setdefault(key, []).append(rec)
                applied = rec["seq"]
            self.applied[key] = applied
            return _json(200, {"applied_seq": applied})

    # ---- checks ------------------------------------------------------------------

    def assert_exactly_once(self, run_id: str, log: str, last_seq: int, first_seq: int = 1) -> None:
        key = (run_id, log)
        assert not self.violations, self.violations
        assert self.applied.get(key, 0) == last_seq, (self.applied.get(key), last_seq)
        seqs = [r["seq"] for r in self.records.get(key, [])]
        assert seqs == list(range(first_seq, last_seq + 1)), seqs[:20]
        assert all(self.apply_counts[(run_id, log, s)] == 1 for s in seqs)

    # ---- transports ----------------------------------------------------------------

    def mock_transport(self) -> httpx.MockTransport:
        def handler(request: httpx.Request) -> httpx.Response:
            action = self.fault(request.method, request.url.path) if self.fault else None
            if action == "drop":
                raise httpx.ConnectError("injected drop", request=request)
            if isinstance(action, tuple) and action[0] == "status":
                return httpx.Response(action[1], headers=action[2] if len(action) > 2 else {},
                                      json={"detail": "injected"})
            status, headers, body = self.handle(
                request.method, request.url.path,
                {k.lower(): v for k, v in request.headers.items()}, request.read(),
            )
            if action == "drop_after":
                raise httpx.ReadError("injected drop after handling", request=request)
            return httpx.Response(status, headers=headers, content=body)

        return httpx.MockTransport(handler)

    def client(self, base: str = "http://fake") -> httpx.Client:
        return httpx.Client(base_url=base, transport=self.mock_transport())

    def serve(self) -> "Served":
        return Served(self)


def _json(status: int, body: Any) -> tuple[int, dict[str, str], bytes]:
    return status, {"Content-Type": "application/json"}, json.dumps(body).encode()


class Served:
    """The fake on a real localhost socket (``url``); ``close()`` stops it."""

    def __init__(self, fake: FakeIngest) -> None:
        self.fake = fake

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args: Any) -> None:
                pass

            def _do(self) -> None:
                n = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(n) if n else b""
                action = fake.fault(self.command, self.path) if fake.fault else None
                if action == "drop":
                    self.close_connection = True
                    self.connection.close()
                    return
                if isinstance(action, tuple) and action[0] == "status":
                    self._reply(action[1], action[2] if len(action) > 2 else {}, b"{}")
                    return
                status, headers, out = fake.handle(
                    self.command, self.path, {k.lower(): v for k, v in self.headers.items()}, body,
                )
                if action == "drop_after":
                    self.close_connection = True
                    self.connection.close()
                    return
                self._reply(status, headers, out)

            def _reply(self, status: int, headers: dict[str, str], out: bytes) -> None:
                self.send_response(status)
                for k, v in headers.items():
                    self.send_header(k, v)
                self.send_header("Content-Length", str(len(out) if self.command != "HEAD" else 0))
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(out)

            do_GET = do_POST = do_PUT = do_HEAD = _do

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.httpd.daemon_threads = True
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        self._thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self._thread.start()

    def close(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()


def flaky(rate: float, *, seed: int = 0, kinds: tuple[str, ...] = ("500", "429", "drop", "drop_after")) -> Callable[[str, str], Fault]:
    """A fault hook failing ``rate`` of the requests in assorted ways."""
    rng = random.Random(seed)
    lock = threading.Lock()

    def fault(method: str, path: str) -> Fault:
        with lock:
            if rng.random() >= rate:
                return None
            kind = rng.choice(kinds)
        if kind == "500":
            return ("status", 500, {})
        if kind == "503":
            return ("status", 503, {"Retry-After": "0"})
        if kind == "429":
            return ("status", 429, {"Retry-After": "0"})
        return kind

    return fault
