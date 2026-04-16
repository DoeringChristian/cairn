"""Zeroconf/mDNS discovery — finds ``_cairn._tcp.local.`` servers on the LAN."""

from __future__ import annotations

import socket
import time

try:
    from zeroconf import ServiceBrowser, Zeroconf
except ImportError as exc:  # pragma: no cover - exercised when extra absent
    raise ImportError(
        "cairn discovery requires `pip install cairn-track[discovery]`"
    ) from exc


SERVICE_TYPE = "_cairn._tcp.local."


class _Collector:
    def __init__(self) -> None:
        self.found: list[tuple[str, int]] = []

    def add_service(self, zc: "Zeroconf", type_: str, name: str) -> None:
        info = zc.get_service_info(type_, name, timeout=1000)
        if info is None or not info.addresses:
            return
        host = socket.inet_ntoa(info.addresses[0])
        self.found.append((host, info.port or 4300))

    # Required by the ServiceBrowser protocol; no-ops are fine.
    def remove_service(self, zc, type_, name) -> None:
        pass

    def update_service(self, zc, type_, name) -> None:
        pass


def discover_servers(timeout: float = 3.0) -> list[tuple[str, int]]:
    """Return all discovered (host, port) tuples, or empty if none found."""
    zc = Zeroconf()
    collector = _Collector()
    try:
        ServiceBrowser(zc, SERVICE_TYPE, collector)
        time.sleep(timeout)
    finally:
        zc.close()
    # Deduplicate.
    return sorted(set(collector.found))


def discover_one_or_error(timeout: float = 3.0) -> tuple[str, int]:
    """Find exactly one server. Raise if zero or more than one are found."""
    servers = discover_servers(timeout=timeout)
    if not servers:
        raise RuntimeError("no cairn servers discovered on this network")
    if len(servers) > 1:
        raise RuntimeError(
            f"multiple cairn servers discovered, please pick one explicitly: {servers}"
        )
    return servers[0]
