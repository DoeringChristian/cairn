"""One client process: logs a deterministic training run to one backend.

Run as ``python -m bench.worker '<json args>'``; prints one JSON line with
its measurements. Used by the benchmarks and the fault suite (the cairn
interpreter for ``cairn-*`` backends, the MLflow venv for ``mlflow``).

Values are deterministic so loss / duplication / corruption is countable
exactly: metric ``m{j}`` at step ``s`` is ``value(s, j) = s*1000 + j + 0.5``
(exact in float64). Images at step ``s`` are seeded noise (worst case for
compression; ``seed + s``).

Args (JSON object):
  backend       cairn-local | cairn-http | mlflow
  target        repo path (cairn-local), cairn://host:port, or http://host:port (mlflow)
  project, name run identity
  metrics       metrics per step (default 10)
  steps         steps (default 1000)
  start_step    first step (default 0)
  media_every   log one image every k steps (0: none)
  media_px      image side (default 256)
  rate          steps per second (0: as fast as possible)
  deadline      stop the loop after this many seconds (default 600)
  lag           also log ``t_log`` = time.time() each step (ingest-lag probe)
  progress      file: the last completed step is written there after every step
  params        number of config params (default 20)
  run_id/label/primary   cairn: attach to an existing run as a worker process
  mlflow_async  MLflow: log_metrics(synchronous=False)
  catch         catch exceptions per step and continue (fault mode; default True)
  finish        call finish()/end_run() (default True)
  prefix        metric name prefix (default "m")
  runs          populate mode: create this many runs (each ``steps`` x ``metrics``)
"""

from __future__ import annotations

import json
import os
import resource
import sys
import time
import traceback
from typing import Any


def value(step: int, j: int) -> float:
    return step * 1000.0 + j + 0.5


def image(seed: int, step: int, px: int):
    import numpy as np

    rng = np.random.default_rng(seed * 1_000_003 + step)
    return rng.integers(0, 256, size=(px, px, 3), dtype=np.uint8)


def params_for(i: int, n: int) -> dict[str, Any]:
    import random

    r = random.Random(i)
    out: dict[str, Any] = {"lr": round(10 ** r.uniform(-5, -1), 8), "batch_size": r.choice([16, 32, 64, 128]),
                           "optimizer": r.choice(["adam", "sgd", "adamw"]), "seed": i}
    for k in range(max(0, n - len(out))):
        out[f"p{k}"] = round(r.uniform(0, 1), 6)
    return out


class Rec:
    """Exceptions and per-step latencies."""

    def __init__(self) -> None:
        self.lat: list[float] = []
        self.errors = 0
        self.first_errors: list[str] = []

    def err(self, exc: BaseException) -> None:
        self.errors += 1
        if len(self.first_errors) < 3:
            self.first_errors.append(f"{type(exc).__name__}: {str(exc)[:300]}")


def _progress_writer(path: str | None):
    if not path:
        return lambda s: None
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)

    def write(step: int) -> None:
        os.pwrite(fd, f"{step:>20d}\n".encode(), 0)

    return write


def _lat_summary(lat: list[float]) -> dict[str, Any]:
    if not lat:
        return {}
    v = sorted(lat)
    return {"p50_ms": v[len(v) // 2] * 1e3, "p99_ms": v[int(len(v) * 0.99)] * 1e3,
            "max_ms": v[-1] * 1e3, "over_100ms": sum(1 for x in v if x > 0.1),
            "blocked_s": sum(x for x in v if x > 0.1)}


# ------------------------------------------------------------------ cairn

def run_cairn(a: dict[str, Any]) -> dict[str, Any]:
    import cairn

    rec = Rec()
    M, S, start = a.get("metrics", 10), a.get("steps", 1000), a.get("start_step", 0)
    prefix = a.get("prefix", "m")
    media_every, px, seed = a.get("media_every", 0), a.get("media_px", 256), a.get("seed", 0)
    rate, deadline = a.get("rate", 0), a.get("deadline", 600)
    catch = a.get("catch", True)
    prog = _progress_writer(a.get("progress"))
    kw: dict[str, Any] = dict(capture_source=False, capture_stdout=False, capture_env=False,
                              capture_system_metrics=False, repo=a["target"])
    t0 = time.perf_counter()
    if a.get("run_id"):
        run = cairn.Run(a.get("project"), run_id=a["run_id"], label=a.get("label"),
                        primary=a.get("primary", False), **kw)
    else:
        run = cairn.Run(a["project"], name=a.get("name"), **kw)
        run.config(params_for(a.get("seed", 0), a.get("params", 20)))
    t_init = time.perf_counter() - t0
    names = [f"{prefix}{j}" for j in range(M)]
    points = media = media_bytes = 0
    last = start - 1
    t1 = time.perf_counter()
    for s in range(start, start + S):
        if rate:
            delay = t1 + (s - start) / rate - time.perf_counter()
            if delay > 0:
                time.sleep(delay)
        ts = time.perf_counter()
        try:
            for j, n in enumerate(names):
                run.track(value(s, j), name=n, step=s)
            points += M
            if a.get("lag"):
                run.track(time.time(), name="t_log", step=s)
            if media_every and s % media_every == 0:
                img = image(seed, s, px)
                run.track(cairn.Image(img), name="img", step=s)
                media += 1
                media_bytes += img.nbytes
        except Exception as exc:  # noqa: BLE001
            if not catch:
                raise
            rec.err(exc)
        rec.lat.append(time.perf_counter() - ts)
        last = s
        prog(s)
        if time.perf_counter() - t1 > deadline:
            break
    t_loop = time.perf_counter() - t1
    t2 = time.perf_counter()
    fin_err = None
    if a.get("finish", True):
        try:
            run.finish()
        except Exception as exc:  # noqa: BLE001
            fin_err = f"{type(exc).__name__}: {exc}"
    t_finish = time.perf_counter() - t2
    return {"run_id": run.id, "points": points, "media": media, "media_raw_bytes": media_bytes,
            "last_step": last, "t_init": t_init, "t_loop": t_loop, "t_finish": t_finish,
            "errors": rec.errors, "first_errors": rec.first_errors, "finish_error": fin_err,
            "step_latency": _lat_summary(rec.lat)}


# ------------------------------------------------------------------ mlflow

def run_mlflow(a: dict[str, Any]) -> dict[str, Any]:
    import mlflow

    rec = Rec()
    M, S, start = a.get("metrics", 10), a.get("steps", 1000), a.get("start_step", 0)
    prefix = a.get("prefix", "m")
    media_every, px, seed = a.get("media_every", 0), a.get("media_px", 256), a.get("seed", 0)
    rate, deadline = a.get("rate", 0), a.get("deadline", 600)
    catch = a.get("catch", True)
    sync = not a.get("mlflow_async", False)
    prog = _progress_writer(a.get("progress"))
    mlflow.set_tracking_uri(a["target"])
    t0 = time.perf_counter()
    client = mlflow.MlflowClient()
    if a.get("run_id"):
        run = mlflow.start_run(run_id=a["run_id"])
    else:
        exp = client.get_experiment_by_name(a["project"])
        exp_id = exp.experiment_id if exp else None
        if exp_id is None:
            try:
                exp_id = client.create_experiment(a["project"])
            except Exception:  # noqa: BLE001  (another worker created it)
                exp_id = client.get_experiment_by_name(a["project"]).experiment_id
        run = mlflow.start_run(experiment_id=exp_id, run_name=a.get("name"))
        mlflow.log_params(params_for(a.get("seed", 0), a.get("params", 20)))
    run_id = run.info.run_id
    t_init = time.perf_counter() - t0
    names = [f"{prefix}{j}" for j in range(M)]
    points = media = media_bytes = 0
    last = start - 1
    t1 = time.perf_counter()
    for s in range(start, start + S):
        if rate:
            delay = t1 + (s - start) / rate - time.perf_counter()
            if delay > 0:
                time.sleep(delay)
        ts = time.perf_counter()
        try:
            d = {n: value(s, j) for j, n in enumerate(names)}
            if a.get("lag"):
                d["t_log"] = time.time()
            mlflow.log_metrics(d, step=s, synchronous=sync)
            points += M
            if media_every and s % media_every == 0:
                img = image(seed, s, px)
                mlflow.log_image(img, key="img", step=s)
                media += 1
                media_bytes += img.nbytes
        except Exception as exc:  # noqa: BLE001
            if not catch:
                raise
            rec.err(exc)
        rec.lat.append(time.perf_counter() - ts)
        last = s
        prog(s)
        if time.perf_counter() - t1 > deadline:
            break
    t_loop = time.perf_counter() - t1
    t2 = time.perf_counter()
    fin_err = None
    if a.get("finish", True):
        try:
            mlflow.end_run()
        except Exception as exc:  # noqa: BLE001
            fin_err = f"{type(exc).__name__}: {exc}"
    t_finish = time.perf_counter() - t2
    return {"run_id": run_id, "points": points, "media": media, "media_raw_bytes": media_bytes,
            "last_step": last, "t_init": t_init, "t_loop": t_loop, "t_finish": t_finish,
            "errors": rec.errors, "first_errors": rec.first_errors, "finish_error": fin_err,
            "step_latency": _lat_summary(rec.lat)}


# ------------------------------------------------------------------ populate

def populate(a: dict[str, Any]) -> dict[str, Any]:
    """Create ``runs`` finished runs (``metrics`` x ``steps`` points, params)."""
    n, M, S = a["runs"], a.get("metrics", 10), a.get("steps", 100)
    base = a.get("seed", 0)
    ids = []
    t0 = time.perf_counter()
    if a["backend"].startswith("cairn"):
        import cairn

        kw = dict(capture_source=False, capture_stdout=False, capture_env=False,
                  capture_system_metrics=False, repo=a["target"])
        for i in range(n):
            run = cairn.Run(a["project"], name=f"run-{base + i}", **kw)
            run.config(params_for(base + i, a.get("params", 20)))
            for s in range(S):
                for j in range(M):
                    run.track(_curve(base + i, j, s, S), name=f"m{j}", step=s)
            run.finish()
            ids.append(run.id)
    else:
        import mlflow
        from mlflow.entities import Metric, Param

        mlflow.set_tracking_uri(a["target"])
        c = mlflow.MlflowClient()
        exp = c.get_experiment_by_name(a["project"])
        exp_id = exp.experiment_id if exp else c.create_experiment(a["project"])
        for i in range(n):
            r = c.create_run(exp_id, run_name=f"run-{base + i}")
            rid = r.info.run_id
            ts = int(time.time() * 1000)
            c.log_batch(rid, params=[Param(k, str(v)) for k, v in params_for(base + i, a.get("params", 20)).items()])
            batch = []
            for s in range(S):
                for j in range(M):
                    batch.append(Metric(f"m{j}", _curve(base + i, j, s, S), ts + s, s))
                    if len(batch) == 1000:
                        c.log_batch(rid, metrics=batch)
                        batch = []
            if batch:
                c.log_batch(rid, metrics=batch)
            c.set_terminated(rid)
            ids.append(rid)
    return {"ids": ids, "t": time.perf_counter() - t0}


def _curve(i: int, j: int, s: int, S: int) -> float:
    import math

    return round(math.exp(-3.0 * s / max(1, S)) * (1 + (i % 97) / 97) + j * 0.01, 6)


def main() -> None:
    a = json.loads(sys.argv[1])
    try:
        if a.get("runs"):
            out = populate(a)
        elif a["backend"].startswith("cairn"):
            out = run_cairn(a)
        else:
            out = run_mlflow(a)
    except Exception as exc:  # noqa: BLE001
        out = {"error": f"{type(exc).__name__}: {exc}", "traceback": traceback.format_exc()[-3000:]}
    ru = resource.getrusage(resource.RUSAGE_SELF)
    out["rss_peak_bytes"] = ru.ru_maxrss if sys.platform == "darwin" else ru.ru_maxrss * 1024
    out["cpu_user_s"], out["cpu_sys_s"] = ru.ru_utime, ru.ru_stime
    print(json.dumps(out), flush=True)


if __name__ == "__main__":
    main()
