"""Read what a backend stored, over its HTTP API (the orchestrator's view).

``points(kind, url, run_id)`` -> ``{name: [(step, value, order_key), ...]}`` in
the store's insertion order (cairn: rowid via ``/updates``; MLflow: the
history ordered by timestamp, then as returned). ``verify`` counts lost,
duplicated, reordered and corrupted points against the deterministic values
``bench.worker.value``.
"""

from __future__ import annotations

from typing import Any

import httpx

from .worker import value


def cairn_points(url: str, run_id: str, timeout: float = 120.0) -> dict[str, list[tuple[int, float]]]:
    out: dict[str, list[tuple[int, float]]] = {}
    since = 0
    with httpx.Client(base_url=url, timeout=timeout) as c:
        while True:
            r = c.get(f"/api/runs/{run_id}/updates", params={"since": since})
            r.raise_for_status()
            body = r.json()
            for p in body["points"]:
                out.setdefault(p["name"], []).append((p["step"], p["scalar_value"]))
            since = body["cursor"]
            if not body["more"]:
                break
    return out


def cairn_status(url: str, run_id: str) -> str | None:
    try:
        r = httpx.get(f"{url}/api/runs/{run_id}", timeout=30)
        if r.status_code != 200:
            return None
        return r.json()["run"]["status"]
    except httpx.HTTPError:
        return None


def mlflow_points(url: str, run_id: str, names: list[str], timeout: float = 120.0) -> dict[str, list[tuple[int, float]]]:
    out: dict[str, list[tuple[int, float]]] = {}
    with httpx.Client(base_url=url, timeout=timeout) as c:
        for n in names:
            rows: list[dict[str, Any]] = []
            token = None
            while True:
                params: dict[str, Any] = {"run_id": run_id, "metric_key": n, "max_results": 25000}
                if token:
                    params["page_token"] = token
                r = c.get("/api/2.0/mlflow/metrics/get-history", params=params)
                r.raise_for_status()
                body = r.json()
                rows.extend(body.get("metrics", []))
                token = body.get("next_page_token")
                if not token:
                    break
            # Insertion order is not exposed; timestamp (client clock at log
            # time) is the closest proxy. Stable sort keeps the store's order on ties.
            rows.sort(key=lambda m: int(m.get("timestamp", 0)))
            if rows:
                out[n] = [(int(m.get("step", 0)), float(m["value"])) for m in rows]
    return out


def mlflow_status(url: str, run_id: str) -> str | None:
    try:
        r = httpx.get(f"{url}/api/2.0/mlflow/runs/get", params={"run_id": run_id}, timeout=30)
        if r.status_code != 200:
            return None
        return r.json()["run"]["info"]["status"]
    except httpx.HTTPError:
        return None


def mlflow_metric_keys(url: str, run_id: str) -> list[str]:
    r = httpx.get(f"{url}/api/2.0/mlflow/runs/get", params={"run_id": run_id}, timeout=60)
    r.raise_for_status()
    return [m["key"] for m in r.json()["run"]["data"].get("metrics", [])]


def points(kind: str, url: str, run_id: str, names: list[str]) -> dict[str, list[tuple[int, float]]]:
    if kind == "mlflow":
        return mlflow_points(url, run_id, names)
    got = cairn_points(url, run_id)
    return {n: got.get(n, []) for n in names}


def verify(stored: dict[str, list[tuple[int, float]]], names: list[str], expected_steps: range,
           accepted_last: int | None = None) -> dict[str, Any]:
    """Compare stored points of ``names`` (``m{j}`` = metric j) with the
    deterministic values for ``expected_steps``.

    lost: expected (step, metric) pairs with no stored point;
    lost_accepted: of those, pairs at steps <= ``accepted_last`` (the last
      step whose track()/log call returned: data the client believed logged);
    duplicated: extra stored points for a (step, metric) already seen;
    corrupted: stored value != value(step, j), or a step outside the range;
    reordered: adjacent step inversions in the store's insertion order.
    """
    exp = set(expected_steps)
    lost = lost_acc = dup = corrupt = reorder = present = 0
    for j, n in enumerate(names):
        rows = stored.get(n, [])
        seen: set[int] = set()
        prev = None
        for step, v in rows:
            if prev is not None and step < prev:
                reorder += 1
            prev = step
            if step in seen:
                dup += 1
                continue
            seen.add(step)
            if step not in exp or v is None or float(v) != value(step, j):
                corrupt += 1
            else:
                present += 1
        missing = exp - seen
        lost += len(missing)
        if accepted_last is not None:
            lost_acc += sum(1 for s in missing if s <= accepted_last)
    return {"expected": len(exp) * len(names), "present": present, "lost": lost,
            "lost_accepted": lost_acc if accepted_last is not None else None,
            "duplicated": dup, "corrupted": corrupt, "reordered": reorder}
