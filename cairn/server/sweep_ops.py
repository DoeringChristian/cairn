"""Hyperparameter sweeps, independent of HTTP (like ``ingest_ops``).

The sweep routes and the direct-mode ``LocalTransport`` both call these.
User errors raise ``ValueError`` (bad space / body) or ``LookupError``
(unknown sweep / trial); callers map them to status codes.

A sweep is a search ``space`` (wandb's ``parameters`` block), a ``method``
and an optional ``metric`` + ``goal``. Workers ask :func:`next_trial` for
params, run them, and :func:`report_trial` the outcome. The space::

    lr:     {values: [0.1, 0.01]}                           # categorical
    wd:     {min: 0.0, max: 0.1}                            # uniform float
    lr2:    {min: 1e-5, max: 1e-1, distribution: log_uniform}
    layers: {min: 1, max: 4}                                # ints → int_uniform
    bs:     {value: 32}                                     # constant
    seed:   7                                               # constant (shorthand)

* ``grid`` walks the product of every ``values`` list (ranges are an error)
  and finishes the sweep when exhausted.
* ``random`` samples every parameter independently, forever.
* ``bayes`` asks Optuna's TPE sampler, rebuilding the study from the
  completed trials on every call (the ``[sweep]`` extra).
"""

from __future__ import annotations

import itertools
import json
import math
import random
import secrets
import sqlite3
from typing import Any

from .routes._common import slugify, utc_now
from .storage.db import Database

METHODS = ("grid", "random", "bayes")
GOALS = ("minimize", "maximize")
#: Sweep lifecycle. Only ``running`` hands out trials.
STATUSES = ("running", "paused", "cancelled", "finished")
#: The pause/resume/cancel actions and the status each sets.
ACTIONS = {"pause": "paused", "resume": "running", "cancel": "cancelled"}
DISTRIBUTIONS = ("uniform", "log_uniform", "int_uniform", "categorical", "constant")


class SweepNotFound(LookupError):
    pass


class TrialNotFound(LookupError):
    pass


def _now() -> str:
    return utc_now().isoformat()


# ---- the space ---------------------------------------------------------------


def _normalize_param(name: str, spec: Any) -> dict[str, Any]:
    """One parameter as ``{distribution, ...}``; raises ValueError."""
    if not isinstance(spec, dict):
        return {"distribution": "constant", "value": spec}
    if "value" in spec:
        return {"distribution": "constant", "value": spec["value"]}
    if "values" in spec:
        values = spec["values"]
        if not isinstance(values, list) or not values:
            raise ValueError(f"parameter {name!r}: 'values' must be a non-empty list")
        return {"distribution": "categorical", "values": values}
    if "min" in spec and "max" in spec:
        lo, hi = spec["min"], spec["max"]
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in (lo, hi)):
            raise ValueError(f"parameter {name!r}: min/max must be numbers")
        if lo > hi:
            raise ValueError(f"parameter {name!r}: min > max")
        both_int = isinstance(lo, int) and isinstance(hi, int)
        dist = spec.get("distribution") or ("int_uniform" if both_int else "uniform")
        if dist not in ("uniform", "log_uniform", "int_uniform"):
            raise ValueError(f"parameter {name!r}: unknown distribution {dist!r}")
        if dist == "log_uniform" and lo <= 0:
            raise ValueError(f"parameter {name!r}: log_uniform needs min > 0")
        if dist == "int_uniform":
            lo, hi = int(lo), int(hi)
        return {"distribution": dist, "min": lo, "max": hi}
    raise ValueError(f"parameter {name!r}: give 'value', 'values', or 'min' and 'max'")


def normalize_space(space: Any) -> dict[str, dict[str, Any]]:
    """Validate a search space and spell every parameter out."""
    if not isinstance(space, dict) or not space:
        raise ValueError("space must be a non-empty mapping of parameter name → spec")
    return {str(k): _normalize_param(str(k), v) for k, v in space.items()}


def _grid(space: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    names = list(space)
    axes: list[list[Any]] = []
    for name in names:
        p = space[name]
        if p["distribution"] == "constant":
            axes.append([p["value"]])
        elif p["distribution"] == "categorical":
            axes.append(p["values"])
        else:
            raise ValueError(f"grid sweeps need 'values' for every parameter ({name!r} is a range)")
    return [dict(zip(names, combo)) for combo in itertools.product(*axes)]


def _sample(space: dict[str, dict[str, Any]], rng: random.Random) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for name, p in space.items():
        d = p["distribution"]
        if d == "constant":
            out[name] = p["value"]
        elif d == "categorical":
            out[name] = rng.choice(p["values"])
        elif d == "int_uniform":
            out[name] = rng.randint(p["min"], p["max"])
        elif d == "log_uniform":
            out[name] = math.exp(rng.uniform(math.log(p["min"]), math.log(p["max"])))
        else:
            out[name] = rng.uniform(p["min"], p["max"])
    return out


def _bayes(
    space: dict[str, dict[str, Any]], goal: str, finished: list[tuple[dict[str, Any], float]],
) -> dict[str, Any]:
    try:
        import optuna
    except ImportError as exc:  # pragma: no cover - depends on the extra
        raise ValueError("method 'bayes' needs Optuna: pip install 'cairn-track[sweep]'") from exc
    optuna.logging.set_verbosity(optuna.logging.WARNING)
    dists: dict[str, Any] = {}
    constants: dict[str, Any] = {}
    for name, p in space.items():
        d = p["distribution"]
        if d == "constant":
            constants[name] = p["value"]
        elif d == "categorical":
            dists[name] = optuna.distributions.CategoricalDistribution(p["values"])
        elif d == "int_uniform":
            dists[name] = optuna.distributions.IntDistribution(p["min"], p["max"])
        else:
            dists[name] = optuna.distributions.FloatDistribution(
                p["min"], p["max"], log=d == "log_uniform",
            )
    study = optuna.create_study(
        direction="maximize" if goal == "maximize" else "minimize",
        sampler=optuna.samplers.TPESampler(),
    )
    for params, value in finished:
        try:
            study.add_trial(optuna.trial.create_trial(
                params={k: params[k] for k in dists}, distributions=dists, value=value,
            ))
        except (KeyError, ValueError):
            continue  # a trial outside the (edited) space teaches nothing
    trial = study.ask(dists)
    return {**constants, **trial.params}


# ---- rows --------------------------------------------------------------------


def _sweep_row(row: dict[str, Any]) -> dict[str, Any]:
    return {**row, "space": json.loads(row["space"])}


def _trial_row(row: dict[str, Any]) -> dict[str, Any]:
    return {**row, "params": json.loads(row["params"])}


def _require_sweep(db: Database, sweep_id: str) -> dict[str, Any]:
    rows = db.read_columns("SELECT * FROM sweeps WHERE id = ?", [sweep_id])
    if not rows:
        raise SweepNotFound(f"sweep {sweep_id} not found")
    return rows[0]


def _summarize(sweep: dict[str, Any], trials: list[dict[str, Any]]) -> dict[str, Any]:
    """The sweep with trial counts by status and its best completed trial."""
    counts: dict[str, int] = {}
    for t in trials:
        counts[t["status"]] = counts.get(t["status"], 0) + 1
    scored = [t for t in trials if t["status"] == "completed" and t["value"] is not None]
    best = None
    if scored:
        pick = max if sweep["goal"] == "maximize" else min
        best = pick(scored, key=lambda t: t["value"])
    return {**_sweep_row(sweep), "trial_count": len(trials), "counts": counts, "best": best}


# ---- operations ----------------------------------------------------------------


def create_sweep(
    db: Database,
    *,
    project: str,
    space: Any,
    method: str = "random",
    metric: str | None = None,
    goal: str | None = None,
    command: str | list[str] | None = None,
    name: str | None = None,
    sweep_id: str | None = None,
) -> dict[str, Any]:
    if method not in METHODS:
        raise ValueError(f"method must be one of {', '.join(METHODS)}")
    goal = goal or "minimize"
    if goal not in GOALS:
        raise ValueError(f"goal must be one of {', '.join(GOALS)}")
    normalized = normalize_space(space)
    if method == "grid":
        _grid(normalized)  # rejects ranges up front
    if method == "bayes" and not metric:
        raise ValueError("method 'bayes' needs a metric to optimize")
    if isinstance(command, list):
        import shlex
        command = shlex.join(str(c) for c in command)
    project_id = slugify(project)
    sweep_id = sweep_id or secrets.token_hex(8)
    now = _now()
    with db.transaction() as con:
        con.execute(
            "INSERT INTO projects (id, name, created_at, description, tags) "
            "VALUES (?, ?, ?, NULL, NULL) ON CONFLICT (id) DO NOTHING",
            [project_id, project, now],
        )
        con.execute(
            """INSERT INTO sweeps (id, project_id, name, method, space, metric, goal,
                                   command, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)""",
            [sweep_id, project_id, name, method, json.dumps(space), metric, goal, command, now],
        )
    return get_sweep(db, sweep_id)


def list_sweeps(db: Database, project_id: str | None = None) -> list[dict[str, Any]]:
    where, params = ("WHERE project_id = ?", [project_id]) if project_id else ("", [])
    sweeps = db.read_columns(f"SELECT * FROM sweeps {where} ORDER BY created_at DESC", params)
    if not sweeps:
        return []
    holes = ",".join("?" * len(sweeps))
    by_sweep: dict[str, list[dict[str, Any]]] = {s["id"]: [] for s in sweeps}
    for t in db.read_columns(
        f"SELECT * FROM sweep_trials WHERE sweep_id IN ({holes})", [s["id"] for s in sweeps],
    ):
        by_sweep[t["sweep_id"]].append(_trial_row(t))
    return [_summarize(s, by_sweep[s["id"]]) for s in sweeps]


def get_sweep(db: Database, sweep_id: str) -> dict[str, Any]:
    """The sweep (as :func:`list_sweeps` shows it) plus its ``trials``, oldest first."""
    sweep = _require_sweep(db, sweep_id)
    trials = [
        _trial_row(t) for t in db.read_columns(
            "SELECT * FROM sweep_trials WHERE sweep_id = ? ORDER BY created_at, rowid", [sweep_id],
        )
    ]
    return {**_summarize(sweep, trials), "trials": trials}


def set_status(db: Database, sweep_id: str, action: str) -> dict[str, Any]:
    """Apply ``pause`` / ``resume`` / ``cancel``. A cancelled or finished sweep stays so."""
    if action not in ACTIONS:
        raise ValueError(f"action must be one of {', '.join(ACTIONS)}")
    sweep = _require_sweep(db, sweep_id)
    if sweep["status"] in ("cancelled", "finished") and action != "cancel":
        raise ValueError(f"sweep is {sweep['status']}")
    if sweep["status"] != "finished":
        db.write("UPDATE sweeps SET status = ? WHERE id = ?", [ACTIONS[action], sweep_id])
    return get_sweep(db, sweep_id)


def next_trial(db: Database, sweep_id: str) -> dict[str, Any]:
    """Claim the next trial atomically: ``{"status", "trial"}``, where
    ``trial`` is None once the sweep is not running (paused, cancelled, or a
    grid that just ran out — which marks it finished)."""
    with db.transaction(immediate=True) as con:
        con.row_factory = sqlite3.Row
        try:
            row = con.execute("SELECT * FROM sweeps WHERE id = ?", [sweep_id]).fetchone()
            if row is None:
                raise SweepNotFound(f"sweep {sweep_id} not found")
            sweep = dict(row)
            if sweep["status"] != "running":
                return {"status": sweep["status"], "trial": None}
            space = normalize_space(json.loads(sweep["space"]))
            method = sweep["method"]
            if method == "grid":
                (claimed,) = con.execute(
                    "SELECT COUNT(*) FROM sweep_trials WHERE sweep_id = ?", [sweep_id],
                ).fetchone()
                grid = _grid(space)
                if claimed >= len(grid):
                    con.execute("UPDATE sweeps SET status = 'finished' WHERE id = ?", [sweep_id])
                    return {"status": "finished", "trial": None}
                params = grid[claimed]
            elif method == "random":
                params = _sample(space, random.Random(secrets.randbits(64)))
            else:
                finished = [
                    (json.loads(r["params"]), r["value"]) for r in con.execute(
                        "SELECT params, value FROM sweep_trials WHERE sweep_id = ? "
                        "AND status = 'completed' AND value IS NOT NULL", [sweep_id],
                    )
                ]
                params = _bayes(space, sweep["goal"], finished)
            trial = {
                "id": secrets.token_hex(8), "sweep_id": sweep_id, "run_id": None,
                "params": params, "status": "running", "value": None, "created_at": _now(),
            }
            con.execute(
                """INSERT INTO sweep_trials (id, sweep_id, run_id, params, status, value, created_at)
                   VALUES (?, ?, NULL, ?, 'running', NULL, ?)""",
                [trial["id"], sweep_id, json.dumps(params), trial["created_at"]],
            )
        finally:
            con.row_factory = None
    return {"status": "running", "trial": trial}


def run_metric_value(db: Database, run_id: str, metric: str) -> float | None:
    """What the runs table shows for ``metric``: its summary, else its last point."""
    from .routes.runs import _resolved_values

    value = _resolved_values(db, [run_id]).get(run_id, {}).get(metric)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def report_trial(
    db: Database,
    sweep_id: str,
    trial_id: str,
    *,
    run_id: str | None = None,
    value: float | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    """Record a trial's run, outcome and value; returns the trial.

    A trial keeps the FIRST run linked to it (a script that opens a second
    run doesn't steal the trial). With no ``value``, a finished trial's value
    is read from its run's ``metric`` (summary, else last point).
    """
    sweep = _require_sweep(db, sweep_id)
    rows = db.read_columns(
        "SELECT * FROM sweep_trials WHERE id = ? AND sweep_id = ?", [trial_id, sweep_id],
    )
    if not rows:
        raise TrialNotFound(f"trial {trial_id} not found in sweep {sweep_id}")
    trial = rows[0]
    linked = trial["run_id"] or run_id
    if value is None and status not in (None, "running") and linked and sweep["metric"]:
        value = run_metric_value(db, linked, sweep["metric"])
    db.write(
        """UPDATE sweep_trials SET run_id = COALESCE(run_id, ?),
                                   status = COALESCE(?, status),
                                   value = COALESCE(?, value)
           WHERE id = ?""",
        [run_id, status, value, trial_id],
    )
    return _trial_row(db.read_columns("SELECT * FROM sweep_trials WHERE id = ?", [trial_id])[0])
