"""Resume a killed run against a live server: it runs again, steps continue."""

from __future__ import annotations

import time

import httpx
import pytest

import cairn

QUIET = dict(
    capture_source=False, capture_stdout=False, capture_env=False,
    capture_system_metrics=False,
)


@pytest.fixture(autouse=True)
def _reset_active_run():
    from cairn.sdk.capture import stdout as scap

    scap._active_run_id = None
    yield
    scap._active_run_id = None


def test_killed_run_resumes_and_continues(live_server):
    first = cairn.Run(project="p", name="long", server=live_server, **QUIET)
    for s in range(5):
        first.track(float(s), name="loss", step=s)
    first.finish("killed")  # what the SIGTERM handler records

    with httpx.Client(base_url=live_server, timeout=10.0) as c:
        assert c.get(f"/api/runs/{first.id}").json()["run"]["status"] == "killed"

        again = cairn.Run(project="p", resume=first.id, server=live_server, **QUIET)
        assert again.id == first.id
        # The resume record reaches the server at the next group commit.
        deadline = time.monotonic() + 10
        while c.get(f"/api/runs/{first.id}").json()["run"]["status"] != "running":
            assert time.monotonic() < deadline
            time.sleep(0.05)
        for s in range(5, 8):
            again.track(float(s), name="loss", step=s)
        again.finish()

        run = c.get(f"/api/runs/{first.id}").json()["run"]
        assert run["status"] == "completed" and run["ended_at"] is not None
        pts = c.get(f"/api/runs/{first.id}/sequences/loss").json()["points"]
        assert [p["step"] for p in pts] == list(range(8))

        kid = cairn.Run(project="p", fork_from=(first.id, 2), server=live_server,
                        **QUIET)
        kid.finish()
        graph = c.get("/api/projects/p/lineage").json()
        assert {"source": first.id, "target": kid.id, "kind": "forked"} in graph["edges"]
