"""In-memory, short-lived store for embed card specs (WS-EMBED).

An *embed spec* is a small JSON card descriptor (a viewer ``ComparisonCard``:
``{type, series:[{runId, name, context_hash}]}``) that the ``/embed/card``
entry renders standalone in an iframe. Specs are throwaway render inputs, not
domain data — so they live in process memory with a TTL rather than in the
DuckDB store (no migration, no persistence across restarts needed).

Design:

* **Content-hash idempotent** — the ``sid`` is derived from a canonical JSON
  hash of the spec, so POSTing the same spec twice returns the same ``sid``
  (and refreshes its TTL). No unbounded growth from re-embeds of one card.
* **TTL + lazy GC** — every ``put``/``get`` sweeps expired entries. There is
  no background thread; access-time GC is sufficient for this small,
  self-cleaning store. A hard ``max_entries`` cap evicts the oldest specs if
  a burst outpaces expiry.

Auth note: the routes that front this store (``routes/embed.py``) sit behind
the same ``require_role("read")`` dependency as the other ``/api`` data
routes, so ``--no-auth`` mode is unaffected and auth-on mode is not weakened.

TODO(remote-embed): cross-origin embedding will need each ``sid`` to carry an
unguessable capability token (so a leaked short ``sid`` alone can't be read
from another origin) plus a ``--embed-origins`` CORS allowlist. Deferred to a
later security-reviewed follow-up; this store is LOCAL / SAME-ORIGIN only.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from typing import Any

# One hour is plenty for a page to load its iframe(s); specs are re-POSTed
# idempotently on each host render, so an expired sid simply gets recreated.
DEFAULT_TTL_SECONDS = 3600.0
DEFAULT_MAX_ENTRIES = 1024


class EmbedSpecStore:
    """Thread-safe in-memory TTL map from a content-hash ``sid`` to a spec."""

    def __init__(
        self,
        *,
        ttl_seconds: float = DEFAULT_TTL_SECONDS,
        max_entries: int = DEFAULT_MAX_ENTRIES,
    ) -> None:
        self._ttl = ttl_seconds
        self._max = max_entries
        self._lock = threading.Lock()
        # sid -> (spec, expires_at_monotonic)
        self._store: dict[str, tuple[dict[str, Any], float]] = {}

    @staticmethod
    def _sid_for(spec: dict[str, Any]) -> str:
        canonical = json.dumps(spec, sort_keys=True, separators=(",", ":"))
        digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        return digest[:16]

    def _gc_locked(self, now: float) -> None:
        expired = [k for k, (_, exp) in self._store.items() if exp <= now]
        for k in expired:
            del self._store[k]
        # Hard cap: evict oldest-expiring first if still over budget.
        if len(self._store) > self._max:
            ordered = sorted(self._store.items(), key=lambda kv: kv[1][1])
            for k, _ in ordered[: len(self._store) - self._max]:
                del self._store[k]

    def put(self, spec: dict[str, Any]) -> str:
        """Store ``spec`` and return its (content-derived) ``sid``.

        Idempotent: an identical spec yields the same ``sid`` and refreshes
        the TTL.
        """
        sid = self._sid_for(spec)
        now = time.monotonic()
        with self._lock:
            self._gc_locked(now)
            self._store[sid] = (spec, now + self._ttl)
        return sid

    def get(self, sid: str) -> dict[str, Any] | None:
        """Return the spec for ``sid``, or ``None`` if unknown/expired."""
        now = time.monotonic()
        with self._lock:
            self._gc_locked(now)
            entry = self._store.get(sid)
            return entry[0] if entry is not None else None

    def __len__(self) -> int:  # pragma: no cover - introspection helper
        with self._lock:
            return len(self._store)
