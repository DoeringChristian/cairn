"""Benchmark scenarios. Each returns a JSON-able dict of results.

Sizes come from ``SCALES[scale]``; every scenario stands each backend up fresh
under ``<work>/<scenario>/<backend>...`` and tears it down afterwards.
"""

from __future__ import annotations

import json
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

import httpx

from . import common as c
from .systems import System, cairn_counts, system, wait_visible

SCALES: dict[str, dict[str, Any]] = {
    "quick": {
        "tp_clients": [1, 4, 16],
        "tp_single": {"metrics": 10, "steps": 2000},
        "tp_multi": {"metrics": 10, "steps": 1000},
        "media_clients": [1, 4],
        "media": {"metrics": 10, "steps": 300, "media_every": 3, "media_px": 256},
        "lag_secs": 15, "lag_rate": 20, "lag_load_clients": 4,
        "storage_points": 200_000, "storage_images": 100,
        "api_runs": [1000], "api_series_points": 200_000, "api_wide_metrics": 1000, "api_reps": 10,
        "deadline": 300,
    },
    "lab": {
        "tp_clients": [1, 4, 16],
        "tp_single": {"metrics": 1000, "steps": 1000},
        "tp_multi": {"metrics": 100, "steps": 1000},
        "media_clients": [1, 4],
        "media": {"metrics": 10, "steps": 1000, "media_every": 2, "media_px": 256},
        "lag_secs": 60, "lag_rate": 20, "lag_load_clients": 4,
        "storage_points": 1_000_000, "storage_images": 1000,
        "api_runs": [1000, 10000], "api_series_points": 1_000_000, "api_wide_metrics": 1000, "api_reps": 20,
        "deadline": 900,
    },
}


def _worker_cmd(sysm: System, args: dict[str, Any]) -> list[str]:
    return [sysm.python, "-m", "bench.worker", json.dumps(args)]


def _agg(runs: list[dict[str, Any]]) -> dict[str, Any]:
    ok = [r for r in runs if "points" in r]
    pts = sum(r["points"] for r in ok)
    wall = max((r["t_loop"] + r["t_finish"]) for r in ok) if ok else None
    return {
        "clients": len(runs), "failed_clients": len(runs) - len(ok),
        "points": pts, "media": sum(r.get("media", 0) for r in ok),
        "media_raw_mb": sum(r.get("media_raw_bytes", 0) for r in ok) / 2**20,
        "client_wall_s": wall, "client_pts_per_s": (pts / wall) if wall else None,
        "media_mb_per_s": (sum(r.get("media_raw_bytes", 0) for r in ok) / 2**20 / wall) if wall else None,
        "loop_s_max": max((r["t_loop"] for r in ok), default=None),
        "finish_s_max": max((r["t_finish"] for r in ok), default=None),
        "step_p50_ms": c.pct([r["step_latency"].get("p50_ms", 0) for r in ok], 0.5),
        "step_max_ms": max((r["step_latency"].get("max_ms", 0) for r in ok), default=None),
        "blocked_s_max": max((r["step_latency"].get("blocked_s", 0) for r in ok), default=None),
        "client_rss_peak_mb": max((r.get("rss_peak_bytes", 0) for r in ok), default=0) / 2**20,
        "client_cpu_s_max": max((r.get("cpu_user_s", 0) + r.get("cpu_sys_s", 0) for r in ok), default=None),
        "errors": sum(r.get("errors", 0) for r in ok),
        "first_errors": [e for r in runs for e in (r.get("first_errors") or ([r["error"]] if "error" in r else []))][:3],
    }


# ---------------------------------------------------------------- throughput

def throughput(scale: str, backends: list[str], work: Path) -> dict[str, Any]:
    """Logging throughput: N concurrent clients, each its own run, as fast as
    possible; scalar-only and with images. ``client_pts_per_s``: points over
    the slowest client's loop+finish; ``e2e_pts_per_s`` adds the time until
    every point is readable through the API (cairn-local: the ingester)."""
    cfg = SCALES[scale]
    out = []
    for variant in ("scalar", "media"):
        clients = cfg["tp_clients"] if variant == "scalar" else cfg["media_clients"]
        for be in backends:
            for n in clients:
                shape = cfg["media"] if variant == "media" else (cfg["tp_single"] if n == 1 else cfg["tp_multi"])
                w = work / f"tp-{variant}-{be}-{n}"
                row: dict[str, Any] = {"variant": variant, "backend": be, "n_clients": n, **shape}
                print(f"[throughput] {variant} {be} N={n} {shape}", flush=True)
                try:
                    with system(be, w) as sysm:
                        args = [sysm.worker_args(project="tp", name=f"c{i}", seed=i, deadline=cfg["deadline"], **shape)
                                for i in range(n)]
                        env = c.isolated_env(w)
                        with c.RssSampler(lambda: sysm.server.pid) as rs:
                            t0 = time.monotonic()
                            runs = c.run_workers([_worker_cmd(sysm, a) for a in args], env, cfg["deadline"] * 2 + 120)
                            t_workers = time.monotonic() - t0
                            vis = wait_visible(sysm, "tp", runs)
                        agg = _agg(runs)
                        row.update(agg)
                        row["orchestrator_wall_s"] = t_workers
                        row["visible_after_finish_s"] = vis
                        if agg["client_wall_s"] and vis is not None:
                            row["e2e_pts_per_s"] = agg["points"] / (agg["client_wall_s"] + vis)
                        row["server_rss_peak_mb"] = rs.peak / 2**20
                        row["server_startup_s"] = sysm.extra.get("startup_s")
                    row["storage"] = sysm.storage()
                except Exception as exc:  # noqa: BLE001
                    row["error"] = f"{type(exc).__name__}: {exc}"
                print("   ->", {k: row.get(k) for k in ("client_pts_per_s", "e2e_pts_per_s", "blocked_s_max", "error")}, flush=True)
                out.append(row)
    return {"rows": out}


# ---------------------------------------------------------------- ingest lag

def _discover(sysm: System, project: str, name: str) -> str | None:
    try:
        if sysm.read_kind == "cairn":
            r = httpx.get(f"{sysm.read_url}/api/runs", params={"project": project, "limit": 100}, timeout=10)
            for run in r.json().get("runs", []):
                if run.get("display_name") == name:
                    return run["id"]
            return None
        r = httpx.get(f"{sysm.read_url}/api/2.0/mlflow/experiments/get-by-name",
                      params={"experiment_name": project}, timeout=10)
        if r.status_code != 200:
            return None
        exp = r.json()["experiment"]["experiment_id"]
        r = httpx.post(f"{sysm.read_url}/api/2.0/mlflow/runs/search",
                       json={"experiment_ids": [exp], "filter": f"attributes.run_name = '{name}'", "max_results": 5},
                       timeout=10)
        runs = r.json().get("runs", [])
        return runs[0]["info"]["run_id"] if runs else None
    except (httpx.HTTPError, KeyError, ValueError):
        return None


class LagPoller(threading.Thread):
    """Polls the newest ``t_log`` points every ``interval`` s; a point's lag is
    (first time it is readable) - (the time.time() it carries)."""

    def __init__(self, sysm: System, project: str, name: str, interval: float = 0.05) -> None:
        super().__init__(daemon=True)
        self.sysm, self.project, self.name, self.interval = sysm, project, name, interval
        self.lags: list[float] = []
        self.seen: set[int] = set()
        self.stop_ev = threading.Event()
        self.run_id: str | None = None
        self.poll_ms: list[float] = []

    def run(self) -> None:
        since = 0
        cl = httpx.Client(base_url=self.sysm.read_url, timeout=10)
        while not self.stop_ev.is_set():
            if self.run_id is None:
                self.run_id = _discover(self.sysm, self.project, self.name)
            if self.run_id is not None:
                t0 = time.time()
                try:
                    if self.sysm.read_kind == "cairn":
                        more = True
                        while more:
                            r = cl.get(f"/api/runs/{self.run_id}/updates", params={"since": since})
                            body = r.json()
                            now = time.time()
                            for p in body["points"]:
                                if p["name"] == "t_log" and p["step"] not in self.seen:
                                    self.seen.add(p["step"])
                                    self.lags.append(now - p["scalar_value"])
                            since = body["cursor"]
                            more = body["more"]
                    else:
                        r = cl.get("/api/2.0/mlflow/metrics/get-history",
                                   params={"run_id": self.run_id, "metric_key": "t_log", "max_results": 25000})
                        now = time.time()
                        for m in r.json().get("metrics", []):
                            s = int(m.get("step", 0))
                            if s not in self.seen:
                                self.seen.add(s)
                                self.lags.append(now - float(m["value"]))
                except (httpx.HTTPError, ValueError, KeyError):
                    pass
                self.poll_ms.append((time.time() - t0) * 1e3)
            self.stop_ev.wait(self.interval)
        cl.close()


def lag(scale: str, backends: list[str], work: Path) -> dict[str, Any]:
    """Ingest lag: one client logs 10 metrics + ``t_log`` at ``lag_rate``
    steps/s; a poller reads the run every 50 ms. ``idle`` alone, ``load``
    with ``lag_load_clients`` other clients logging flat out."""
    cfg = SCALES[scale]
    out = []
    for be in backends:
        for variant in ("idle", "load"):
            w = work / f"lag-{be}-{variant}"
            row: dict[str, Any] = {"backend": be, "variant": variant, "rate_steps_s": cfg["lag_rate"],
                                   "secs": cfg["lag_secs"]}
            print(f"[lag] {be} {variant}", flush=True)
            try:
                with system(be, w) as sysm:
                    env = c.isolated_env(w)
                    steps = cfg["lag_secs"] * cfg["lag_rate"]
                    probe = sysm.worker_args(project="lag", name="lag", metrics=10, steps=steps,
                                             rate=cfg["lag_rate"], lag=True, deadline=cfg["lag_secs"] * 3)
                    poller = LagPoller(sysm, "lag", "lag")
                    poller.start()
                    loaders = []
                    if variant == "load":
                        for i in range(cfg["lag_load_clients"]):
                            a = sysm.worker_args(project="lag", name=f"load{i}", metrics=10, steps=10**7,
                                                 seed=i + 1, deadline=cfg["lag_secs"])
                            loaders.append(subprocess.Popen(_worker_cmd(sysm, a), env=env, cwd=c.REPO_ROOT,
                                                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
                    with c.RssSampler(lambda: sysm.server.pid) as rs:
                        res = c.run_workers([_worker_cmd(sysm, probe)], env, cfg["lag_secs"] * 4 + 120)[0]
                        t_end = time.monotonic()
                        while len(poller.seen) < steps and time.monotonic() - t_end < 120:
                            time.sleep(0.1)
                    poller.stop_ev.set()
                    poller.join()
                    for p in loaders:
                        p.wait(timeout=cfg["lag_secs"] * 4 + 300)
                    row.update({"lag_s": c.summary_stats(poller.lags), "points_seen": len(poller.seen),
                                "points_logged": steps, "poll_ms": c.summary_stats(poller.poll_ms),
                                "server_rss_peak_mb": rs.peak / 2**20,
                                "probe_step_latency": res.get("step_latency"), "probe_errors": res.get("errors")})
            except Exception as exc:  # noqa: BLE001
                row["error"] = f"{type(exc).__name__}: {exc}"
            print("   ->", row.get("lag_s"), row.get("error"), flush=True)
            out.append(row)
    return {"rows": out}


# ---------------------------------------------------------------- storage

def storage(scale: str, backends: list[str], work: Path) -> dict[str, Any]:
    """Bytes on disk per 1M scalar points (one run, 10 metrics) and per GB of
    logged image pixels (seeded noise, 256x256 RGB: incompressible, the worst
    case)."""
    cfg = SCALES[scale]
    out = []
    pts = cfg["storage_points"]
    for be in backends:
        if be == "mlflow-sqlite-async":
            continue
        for variant in ("scalar", "media"):
            w = work / f"storage-{be}-{variant}"
            row: dict[str, Any] = {"backend": be, "variant": variant}
            print(f"[storage] {be} {variant}", flush=True)
            try:
                with system(be, w) as sysm:
                    base = sysm.storage()
                    env = c.isolated_env(w)
                    if variant == "scalar":
                        a = sysm.worker_args(project="st", name="st", metrics=10, steps=pts // 10, params=20,
                                             deadline=cfg["deadline"] * 2)
                    else:
                        a = sysm.worker_args(project="st", name="st", metrics=1, steps=cfg["storage_images"],
                                             media_every=1, media_px=256, deadline=cfg["deadline"] * 2)
                    t0 = time.monotonic()
                    res = c.run_workers([_worker_cmd(sysm, a)], env, cfg["deadline"] * 4)[0]
                    vis = wait_visible(sysm, "st", [res])
                    row["log_and_visible_s"] = time.monotonic() - t0
                    row["visible"] = vis is not None
                # server stopped: SQLite WAL checkpointed, run logs ingested
                size = sysm.storage()
                row["baseline_bytes"] = base
                row["bytes"] = size
                if variant == "scalar":
                    n = res.get("points", 0)
                    row["points"] = n
                    row["bytes_per_1M_points_total"] = (size["total"] - base["total"]) * 1e6 / max(1, n)
                    row["bytes_per_1M_points_db"] = (size["db"] - base["db"]) * 1e6 / max(1, n)
                    row["bytes_per_point"] = (size["total"] - base["total"]) / max(1, n)
                else:
                    raw = res.get("media_raw_bytes", 0)
                    row["images"] = res.get("media", 0)
                    row["raw_pixel_bytes"] = raw
                    row["stored_bytes_per_GB_pixels"] = (size["total"] - base["total"]) * 2**30 / max(1, raw)
            except Exception as exc:  # noqa: BLE001
                row["error"] = f"{type(exc).__name__}: {exc}"
            print("   ->", {k: v for k, v in row.items() if k.startswith(("bytes_per", "stored", "error"))}, flush=True)
            out.append(row)
    return {"rows": out}


# ---------------------------------------------------------------- API (+ UI)

def _populate(sysm: System, project: str, n_runs: int, work: Path, procs: int = 16) -> float:
    env = c.isolated_env(work)
    per = [n_runs // procs + (1 if i < n_runs % procs else 0) for i in range(procs)]
    cmds, base = [], 0
    for k in per:
        if k:
            a = sysm.worker_args(project=project, runs=k, metrics=10, steps=100, params=20, seed=base)
            cmds.append(_worker_cmd(sysm, a))
            base += k
    t0 = time.monotonic()
    res = c.run_workers(cmds, env, 7200)
    errs = [r for r in res if "error" in r]
    if errs:
        raise RuntimeError(f"populate failed: {errs[0]}")
    return time.monotonic() - t0


def _time(fn, reps: int) -> dict[str, Any]:
    fn()  # warm-up
    ts, size = [], 0
    for _ in range(reps):
        t0 = time.perf_counter()
        r = fn()
        ts.append((time.perf_counter() - t0) * 1e3)
        size = len(r.content)
        if r.status_code >= 400:
            return {"error": f"HTTP {r.status_code}: {r.text[:200]}"}
    return {"p50_ms": c.pct(ts, 0.5), "p95_ms": c.pct(ts, 0.95), "max_ms": max(ts), "bytes": size, "reps": reps}


def _cairn_requests(url: str, proj: str, ids: list[str], series_id: str | None, wide_id: str | None) -> dict[str, Any]:
    cl = httpx.Client(base_url=url, timeout=600)
    ids200 = ids[:200]
    ids100 = ids[:100]
    reqs: dict[str, Any] = {
        "list_50": lambda: cl.get("/api/runs", params={"project": proj, "limit": 50}),
        "list_1000_params_stats": lambda: cl.get("/api/runs", params={"project": proj, "limit": 1000,
                                                                       "include": "params,stats"}),
        "sort_metric_50": lambda: cl.get("/api/runs", params={"project": proj, "limit": 50, "sort": "metrics.m0",
                                                               "desc": "true"}),
        "filter_metric_and_param_50": lambda: cl.post("/api/runs/query", json={
            "project": proj, "limit": 50,
            "predicates": [["metrics", "lt", "m0", 0.5], ["config", "exact", "optimizer", "adam"]]}),
        "run_detail": lambda: cl.get(f"/api/runs/{ids[0]}"),
        "batch_runs_200": lambda: cl.post("/api/runs/batch", json={"ids": ids200, "include": ["run", "sequences"]}),
        "batch_series_100x1": lambda: cl.post("/api/runs/series", json={"runs": {i: ["m0"] for i in ids100}}),
        "batch_series_200x2": lambda: cl.post("/api/runs/series", json={"runs": {i: ["m0", "m1"] for i in ids200}}),
    }
    if series_id:
        reqs["series_full_read"] = lambda: cl.get(f"/api/runs/{series_id}/sequences/m0")
        reqs["series_columnar_read"] = lambda: cl.get(f"/api/runs/{series_id}/series", params={"name": "m0"})
    if wide_id:
        reqs["wide_run_detail_1k_metrics"] = lambda: cl.get(f"/api/runs/{wide_id}")
        reqs["wide_run_catalogue_1k_metrics"] = lambda: cl.get(f"/api/runs/{wide_id}/sequences")
    return reqs


def _mlflow_requests(url: str, proj: str, ids: list[str], series_id: str | None, wide_id: str | None) -> dict[str, Any]:
    cl = httpx.Client(base_url=url, timeout=600)
    exp = cl.get("/api/2.0/mlflow/experiments/get-by-name", params={"experiment_name": proj}).json()["experiment"]["experiment_id"]
    search = "/api/2.0/mlflow/runs/search"
    ids200, ids100 = ids[:200], ids[:100]
    in200 = ",".join(f"'{i}'" for i in ids200)

    def full_history(rid: str, key: str):
        token, last = None, None
        while True:
            p: dict[str, Any] = {"run_id": rid, "metric_key": key, "max_results": 25000}
            if token:
                p["page_token"] = token
            last = cl.get("/api/2.0/mlflow/metrics/get-history", params=p)
            token = last.json().get("next_page_token")
            if not token:
                return last

    def series_many(keys: list[str], run_ids: list[str]):
        r = None
        for k in keys:
            for i in range(0, len(run_ids), 100):
                r = cl.get("/api/2.0/mlflow/metrics/get-history-bulk-interval",
                           params=[("run_ids", x) for x in run_ids[i:i + 100]] + [("metric_key", k), ("max_results", 2500)])
        return r

    reqs: dict[str, Any] = {
        "list_50": lambda: cl.post(search, json={"experiment_ids": [exp], "max_results": 50}),
        "list_1000_params_stats": lambda: cl.post(search, json={"experiment_ids": [exp], "max_results": 1000}),
        "sort_metric_50": lambda: cl.post(search, json={"experiment_ids": [exp], "max_results": 50,
                                                         "order_by": ["metrics.m0 DESC"]}),
        "filter_metric_and_param_50": lambda: cl.post(search, json={
            "experiment_ids": [exp], "max_results": 50,
            "filter": "metrics.m0 < 0.5 and params.optimizer = 'adam'"}),
        "run_detail": lambda: cl.get("/api/2.0/mlflow/runs/get", params={"run_id": ids[0]}),
        "batch_runs_200": lambda: cl.post(search, json={"experiment_ids": [exp], "max_results": 200,
                                                         "filter": f"attributes.run_id IN ({in200})"}),
        "batch_series_100x1": lambda: series_many(["m0"], ids100),
        "batch_series_200x2": lambda: series_many(["m0", "m1"], ids200),
    }
    if series_id:
        reqs["series_full_read"] = lambda: full_history(series_id, "m0")
        reqs["series_downsampled_1000"] = lambda: cl.get(
            "/api/2.0/mlflow/metrics/get-history-bulk-interval",
            params={"run_ids": series_id, "metric_key": "m0", "max_results": 1000})
    if wide_id:
        reqs["wide_run_detail_1k_metrics"] = lambda: cl.get("/api/2.0/mlflow/runs/get", params={"run_id": wide_id})
    return reqs


def _ids(sysm: System, proj: str, n: int) -> list[str]:
    if sysm.read_kind == "cairn":
        r = httpx.get(f"{sysm.read_url}/api/runs", params={"project": proj, "limit": 1000}, timeout=600)
        return [x["id"] for x in r.json()["runs"]]
    cl = httpx.Client(base_url=sysm.read_url, timeout=600)
    exp = cl.get("/api/2.0/mlflow/experiments/get-by-name", params={"experiment_name": proj}).json()["experiment"]["experiment_id"]
    r = cl.post("/api/2.0/mlflow/runs/search", json={"experiment_ids": [exp], "max_results": 1000})
    return [x["info"]["run_id"] for x in r.json()["runs"]]


def api(scale: str, backends: list[str], work: Path, *, ui: bool = True) -> dict[str, Any]:
    """API latencies (p50/p95 of ``api_reps`` after a warm-up) over projects of
    1k and 10k finished runs (10 metrics x 100 steps, 20 params each), a
    1M-point series and a 1000-metric run; then (``ui``) headless UI timings
    on the same data. cairn-local and cairn-http share one read path (the same
    server over the same database), so cairn is measured once ("cairn")."""
    cfg = SCALES[scale]
    seen = set()
    out: list[dict[str, Any]] = []
    ui_rows: list[dict[str, Any]] = []
    for be in backends:
        key = "cairn" if be.startswith("cairn") else be
        if key in seen or be == "mlflow-sqlite-async":
            continue
        seen.add(key)
        sys_be = "cairn-http" if key == "cairn" else be
        w = work / f"api-{key}"
        print(f"[api] {key}", flush=True)
        try:
            with system(sys_be, w, ui=(key == "cairn")) as sysm:
                env = c.isolated_env(w)
                # the long series and the wide run
                t0 = time.monotonic()
                sp = cfg["api_series_points"]
                if key == "cairn":
                    sr = c.run_workers([_worker_cmd(sysm, sysm.worker_args(project="series", name="series", metrics=1,
                                                                            steps=sp, deadline=7200, params=1))], env, 7200)[0]
                    series_id = sr.get("run_id")
                    wide = c.run_workers([_worker_cmd(sysm, sysm.worker_args(project="wide", name="wide",
                                                                              metrics=cfg["api_wide_metrics"], steps=100,
                                                                              deadline=7200))], env, 7200)[0]
                    wide_id = wide.get("run_id")
                else:
                    sr = c.run_workers([_worker_cmd(sysm, sysm.worker_args(project="series", runs=1, metrics=1,
                                                                            steps=sp, params=1))], env, 7200)[0]
                    series_id = (sr.get("ids") or [None])[0]
                    wide = c.run_workers([_worker_cmd(sysm, sysm.worker_args(project="wide", runs=1,
                                                                              metrics=cfg["api_wide_metrics"], steps=100))],
                                         env, 7200)[0]
                    wide_id = (wide.get("ids") or [None])[0]
                t_series = time.monotonic() - t0
                for n in cfg["api_runs"]:
                    proj = f"api{n}"
                    print(f"   populate {n} runs", flush=True)
                    t_pop = _populate(sysm, proj, n, w)
                    time.sleep(1.0)
                    ids = _ids(sysm, proj, n)
                    reqs = (_cairn_requests if key == "cairn" else _mlflow_requests)(
                        sysm.read_url, proj, ids, series_id, wide_id)
                    row: dict[str, Any] = {"backend": key, "runs": n, "populate_s": t_pop,
                                           "series_points": sp, "series_and_wide_populate_s": t_series}
                    with c.RssSampler(lambda: sysm.server.pid) as rs:
                        for name, fn in reqs.items():
                            try:
                                row[name] = _time(fn, cfg["api_reps"])
                            except Exception as exc:  # noqa: BLE001
                                row[name] = {"error": f"{type(exc).__name__}: {exc}"}
                            print(f"   {n} {name}: {row[name]}", flush=True)
                    row["server_rss_peak_mb"] = rs.peak / 2**20
                    row["server_rss_mb"] = sysm.server_rss() / 2**20
                    out.append(row)
                    if ui:
                        ui_rows.extend(_ui(sysm, key, proj, ids, w))
                row_store = sysm.storage()
            out[-1]["storage_after_all"] = row_store
        except Exception as exc:  # noqa: BLE001
            out.append({"backend": key, "error": f"{type(exc).__name__}: {exc}"})
            print("   error", exc, flush=True)
    return {"rows": out, "ui": ui_rows}


def _ui(sysm: System, key: str, proj: str, ids: list[str], work: Path) -> list[dict[str, Any]]:
    """Headless Chromium timings of the runs table and the workspace/charts."""
    if key == "cairn":
        pages = [
            {"page": "runs", "url": f"{sysm.read_url}/p/{proj}", "selector": f'a[href^="/p/{proj}/r/"]'},
            {"page": "workspace", "url": f"{sysm.read_url}/p/{proj}/workspace", "selector": "canvas"},
        ]
    else:
        cl = httpx.Client(base_url=sysm.read_url, timeout=60)
        exp = cl.get("/api/2.0/mlflow/experiments/get-by-name", params={"experiment_name": proj}).json()["experiment"]["experiment_id"]
        pages = [
            # MLflow 3 opens experiments in its GenAI overview; /runs is the
            # model-training runs table, compareRunsMode=CHART its chart view
            {"page": "runs", "url": f"{sysm.read_url}/#/experiments/{exp}/runs", "selector": 'a[href*="/runs/"]'},
            {"page": "workspace", "url": f"{sysm.read_url}/#/experiments/{exp}/runs?compareRunsMode=CHART",
             "selector": ".js-plotly-plot, canvas"},
        ]
    args = {"pages": pages, "reps": 3, "shots": str(work / f"ui-{proj}")}
    py = c.playwright_python()
    env = c.isolated_env(work)
    with c.RssSampler(lambda: sysm.server.pid) as rs:
        r = subprocess.run([py, "-m", "bench.ui_probe", json.dumps(args)], env=env, cwd=c.REPO_ROOT,
                           capture_output=True, text=True, timeout=1800)
    try:
        rows = json.loads(r.stdout.strip().splitlines()[-1])
    except (IndexError, json.JSONDecodeError):
        return [{"backend": key, "project": proj, "error": r.stderr[-1500:]}]
    for row in rows:
        row.update({"backend": key, "project": proj, "runs": len(ids) if len(ids) < 1000 else int(proj[3:]),
                    "server_rss_peak_mb": rs.peak / 2**20})
        print("   ui", {k: row.get(k) for k in ("page", "runs", "ready_ms", "settled_ms", "error")}, flush=True)
    return rows


# ---------------------------------------------------------------- profiles

def profile(scale: str, backends: list[str], work: Path) -> dict[str, Any]:
    """yappi profiles (CPU clock, all threads): the cairn server while 4 HTTP
    clients log, the server's ingester while 4 local clients log, and one
    HTTP client's process (the training loop's own cost)."""
    cfg = SCALES[scale]
    prof_py = c.profiling_python()
    out: dict[str, Any] = {}
    shape = {"metrics": 20, "steps": 5000}  # 4 clients x 100k points, any scale
    for be in ("cairn-http", "cairn-local"):
        w = work / f"profile-{be}"
        print(f"[profile] {be}", flush=True)
        from .systems import make_system

        sysm = make_system(be, w)
        srv_prof = w / "server-profile.json"
        sysm.server.cmd = [prof_py, "-m", "bench.profiled", str(srv_prof), "cairn", *sysm.server.cmd[1:]]
        sysm.server.start()
        try:
            env = c.isolated_env(w)
            cli_prof = w / "client-profile.json"
            cmds = []
            for i in range(4):
                a = sysm.worker_args(project="pf", name=f"c{i}", seed=i, deadline=cfg["deadline"], **shape)
                if i == 0:
                    cmds.append([prof_py, "-m", "bench.profiled", str(cli_prof), "bench.worker", json.dumps(a)])
                else:
                    cmds.append([sysm.python, "-m", "bench.worker", json.dumps(a)])
            runs = c.run_workers(cmds, env, cfg["deadline"] * 3)
            wait_visible(sysm, "pf", runs)
        finally:
            sysm.server.stop()
        out[be] = {"workers": _agg(runs)}
        for label, path in (("server", srv_prof), ("client", cli_prof)):
            try:
                out[be][label] = json.loads(path.read_text())
            except (OSError, json.JSONDecodeError) as exc:
                out[be][label] = {"error": str(exc)}
    return out


def api_profile(scale: str, backends: list[str], work: Path) -> dict[str, Any]:
    """yappi profile (wall clock) of the cairn server serving the slowest
    read endpoints over a project of the largest configured size."""
    cfg = SCALES[scale]
    n = max(cfg["api_runs"])
    prof_py = c.profiling_python()
    from .systems import make_system

    w = work / "profile-api"
    sysm = make_system("cairn-http", w)
    prof = w / "server-profile.json"
    sysm.server.cmd = [prof_py, "-m", "bench.profiled", str(prof), "--clock", "cpu", "cairn", *sysm.server.cmd[1:]]
    sysm.server.start()
    timings = {}
    try:
        _populate(sysm, "pa", n, w)
        env = c.isolated_env(w)
        sr = c.run_workers([_worker_cmd(sysm, sysm.worker_args(project="series", name="series", metrics=1,
                                                                steps=cfg["api_series_points"], deadline=7200))],
                           env, 7200)[0]
        ids = _ids(sysm, "pa", n)
        reqs = _cairn_requests(sysm.read_url, "pa", ids, sr.get("run_id"), None)
        for name in ("list_50", "list_1000_params_stats", "sort_metric_50", "filter_metric_and_param_50",
                     "batch_series_200x2", "series_full_read"):
            timings[name] = _time(reqs[name], 5)
    finally:
        sysm.server.stop()
    try:
        prof_body = json.loads(prof.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        prof_body = {"error": str(exc)}
    return {"runs": n, "timings_under_profiler": timings, "server": prof_body}


SCENARIOS = {
    "throughput": throughput,
    "lag": lag,
    "storage": storage,
    "api": api,
    "profile": profile,
    "api_profile": api_profile,
}

