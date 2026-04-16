"""Zeroconf/mDNS advertising — broadcasts ``_cairn._tcp.local.``."""

from __future__ import annotations

import socket

try:
    from zeroconf import ServiceInfo, Zeroconf
except ImportError as exc:  # pragma: no cover - exercised when extra absent
    raise ImportError(
        "cairn advertise requires `pip install cairn-track[discovery]`"
    ) from exc


SERVICE_TYPE = "_cairn._tcp.local."


class Advertiser:
    """Context-manager-friendly mDNS advertiser."""

    def __init__(self) -> None:
        self._zc: Zeroconf | None = None
        self._info: ServiceInfo | None = None

    def start(
        self, host: str, port: int, service_name: str | None = None
    ) -> None:
        self._zc = Zeroconf()
        hostname = service_name or socket.gethostname()
        svc_name = f"{hostname}.{SERVICE_TYPE}"
        try:
            addr = socket.inet_aton(host)
        except OSError:
            addr = socket.inet_aton("127.0.0.1")
        self._info = ServiceInfo(
            type_=SERVICE_TYPE,
            name=svc_name,
            addresses=[addr],
            port=port,
            properties={"name": hostname},
            server=f"{hostname}.local.",
        )
        self._zc.register_service(self._info)

    def stop(self) -> None:
        if self._zc is not None:
            try:
                if self._info is not None:
                    self._zc.unregister_service(self._info)
            finally:
                self._zc.close()
                self._zc = None
                self._info = None
