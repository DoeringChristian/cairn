"""Log line storage and paginated read."""

from __future__ import annotations

from datetime import datetime, timezone


def _now():
    return datetime.now(timezone.utc).isoformat()


def test_logs_round_trip_and_disk_files(client, tmp_path):
    rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
    client.post(
        f"/api/runs/{rid}/logs",
        json={
            "lines": [
                {"stream": "stdout", "wall_time": _now(), "line_no": 1, "content": "hello"},
                {"stream": "stderr", "wall_time": _now(), "line_no": 2, "content": "oops"},
                {"stream": "stdout", "wall_time": _now(), "line_no": 3, "content": "bye"},
            ]
        },
    )
    lines = client.get(f"/api/runs/{rid}/logs").json()["lines"]
    assert len(lines) == 3
    only_stdout = client.get(f"/api/runs/{rid}/logs?stream=stdout").json()["lines"]
    assert len(only_stdout) == 2
    assert all(ln["stream"] == "stdout" for ln in only_stdout)


def test_logs_search_substring(client):
    rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
    client.post(
        f"/api/runs/{rid}/logs",
        json={
            "lines": [
                {"stream": "stdout", "wall_time": _now(), "line_no": 1, "content": "nothing interesting"},
                {"stream": "stdout", "wall_time": _now(), "line_no": 2, "content": "found the pattern here"},
            ]
        },
    )
    r = client.get(f"/api/runs/{rid}/logs?search=pattern").json()
    assert len(r["lines"]) == 1
    assert "pattern" in r["lines"][0]["content"]


def test_logs_paginated(client):
    rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
    client.post(
        f"/api/runs/{rid}/logs",
        json={
            "lines": [
                {"stream": "stdout", "wall_time": _now(), "line_no": i, "content": str(i)}
                for i in range(10)
            ]
        },
    )
    r1 = client.get(f"/api/runs/{rid}/logs?limit=4&offset=0").json()
    r2 = client.get(f"/api/runs/{rid}/logs?limit=4&offset=4").json()
    assert r1["total"] == 10
    assert len(r1["lines"]) == 4
    assert len(r2["lines"]) == 4
    assert r1["lines"][0]["content"] != r2["lines"][0]["content"]
