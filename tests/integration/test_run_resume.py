"""Transport spill + drain_spill recovery path."""

from __future__ import annotations

import httpx
import pytest

from cairn.sdk.transport import Transport


def test_failed_batch_spills_and_drains(live_server, tmp_path):
    transport = Transport(
        live_server,
        spill_dir=tmp_path / "spill",
        max_retries=1,
        backoff_base=0.001,
        backoff_cap=0.001,
    )
    # Create a run first.
    rid = transport.create_run({"project": "p"})["run_id"]

    # Swap the client for a dead one to force spill.
    dead = httpx.Client(
        base_url="http://test",
        transport=httpx.MockTransport(lambda r: httpx.Response(503)),
    )
    original = transport._client
    transport._client = dead

    ok = transport.post_batch(
        rid,
        [
            {
                "name": "loss",
                "step": 0,
                "wall_time": "2026-01-01T00:00:00Z",
                "object_type": "scalar",
                "scalar_value": 1.0,
            }
        ],
    )
    assert ok is False
    spilled = list((tmp_path / "spill" / rid).glob("*.json"))
    assert len(spilled) == 1

    # Restore real client; drain replays.
    transport._client = original
    replayed = transport.drain_spill(rid)
    assert replayed == 1
    with httpx.Client(base_url=live_server, timeout=10.0) as c:
        pts = c.get(f"/api/runs/{rid}/sequences/loss").json()["points"]
    assert len(pts) == 1
    transport.close()
