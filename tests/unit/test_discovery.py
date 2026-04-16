"""Zeroconf advertise + discover round-trip.

Skipped in CI (multicast is flaky in containers) and when the ``discovery``
extra isn't installed.
"""

from __future__ import annotations

import os
import time

import pytest

_zc = pytest.importorskip("zeroconf")

pytestmark = pytest.mark.skipif(
    os.environ.get("CI") == "true", reason="zeroconf multicast unreliable in CI"
)


def test_advertise_and_discover_roundtrip():
    from cairn.sdk.discovery import discover_servers
    from cairn.server.advertise import Advertiser

    ad = Advertiser()
    ad.start(host="127.0.0.1", port=14300, service_name="cairn-test-a")
    try:
        # Allow mDNS propagation.
        time.sleep(0.5)
        servers = discover_servers(timeout=2.0)
        # At minimum one server should be reported.
        assert any(port == 14300 for _host, port in servers)
    finally:
        ad.stop()


def test_discover_one_or_error_raises_when_none():
    # Without any advertiser running, short timeout should yield zero then raise.
    from cairn.sdk.discovery import discover_one_or_error

    with pytest.raises(RuntimeError):
        discover_one_or_error(timeout=0.3)
