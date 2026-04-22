"""Perf test: 10k scalar points should flush quickly."""

from __future__ import annotations

import time

import httpx
import pytest

import cairn
from cairn.sdk.transport import Transport


@pytest.fixture(autouse=True)
def _reset():
    from cairn.sdk.capture import stdout as scap

    scap._active_run_id = None
    yield
    scap._active_run_id = None


@pytest.mark.slow
def test_10k_scalars_fast(live_server):
    transport = Transport(live_server, max_retries=1, timeout=60.0)
    run = cairn.Run(
        project="perf",
        capture_source=False,
        capture_stdout=False,
        capture_env=False,
        capture_system_metrics=False,
        transport=transport,
    )
    t0 = time.monotonic()
    try:
        for i in range(10_000):
            run.track(float(i) * 0.001, name="loss", step=i)
    finally:
        run.finish()
    elapsed = time.monotonic() - t0
    # Target is "the test completes without hanging" — upper bound generous;
    # 10k synchronous HTTP batch inserts through DuckDB are not zero-cost.
    assert elapsed < 120.0, f"10k scalars took {elapsed:.2f}s"

    with httpx.Client(base_url=live_server, timeout=30.0) as c:
        points = c.get(f"/api/runs/{run.id}/sequences/loss?max_points=100000").json()[
            "points"
        ]
    assert len(points) == 10_000
