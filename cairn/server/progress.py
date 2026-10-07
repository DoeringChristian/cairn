"""Run progress: how far a run is through its declared total, and its ETA.

Two sources, both stored on the ``runs`` row:

* step-based: ``total_steps`` (``cairn.Run(total_steps=N)`` /
  ``run.total_steps = N``) against ``max_step``, the highest step the run
  logged in any series except ``system.*`` (whose steps are the sampler's own
  counters). ``max_step`` is folded in with every point write and recomputed
  whenever history is rewritten (rewind, fork, import).
* explicit: ``run.progress(i, total=None)`` stores ``progress_value`` and
  ``progress_total`` (None: the run's ``total_steps`` at read time). Once a
  run called it, the explicit value wins over the step-based one.

ETA rule (``eta_seconds``). Each source keeps a short list of samples
``[unix_time, value]``: for steps, ``(latest wall_time of the batch's
non-system points, max_step after the batch)``; for explicit progress,
``(the client's wall time of the call, i)``. A new sample replaces the newest
one while it is less than ``SAMPLE_SPACING`` seconds after the one before it,
so samples sit about that far apart; samples older than ``WINDOW`` seconds
before the newest are dropped, except the newest of them (so a run whose
steps are minutes apart still has two). A sample older than the newest is
ignored (a re-sent batch). Then, for a ``running`` run only:

    rate = (v_last - v_first) / (t_last - t_first)    # first/last kept sample
    eta  = max(0, (total - current) / rate)

and None while there are fewer than two samples, they span less than
``MIN_SPAN`` seconds, or the value did not increase over them. The ETA is
as of the newest sample (no correction for time since then), from client
wall times only, so server clock skew does not enter.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from typing import Any

#: Seconds of history the rate is measured over.
WINDOW = 300.0
#: Seconds between kept samples.
SAMPLE_SPACING = 5.0
#: Fewer seconds between the first and last sample than this: no ETA yet.
MIN_SPAN = 10.0

#: The ``runs`` columns this module owns; ``api_run_row`` replaces them with
#: the one ``progress`` field.
COLUMNS = (
    "total_steps", "max_step", "step_samples",
    "progress_value", "progress_total", "progress_samples",
)


def _epoch(ts: str | datetime | None) -> float | None:
    if ts is None:
        return None
    try:
        dt = ts if isinstance(ts, datetime) else datetime.fromisoformat(
            str(ts).replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


def _load(samples: str | None) -> list[list[float]]:
    if not samples:
        return []
    try:
        out = json.loads(samples)
    except (TypeError, ValueError):
        return []
    return out if isinstance(out, list) else []


def fold_sample(samples: list[list[float]], t: float, v: float) -> list[list[float]]:
    """``samples`` with ``(t, v)`` added (see the module docstring)."""
    samples = [list(s) for s in samples]
    if samples and t < samples[-1][0]:
        return samples
    if samples and t == samples[-1][0]:
        samples[-1][1] = max(samples[-1][1], v)
        return samples
    if len(samples) >= 2 and t - samples[-2][0] < SAMPLE_SPACING:
        samples[-1] = [t, v]
    else:
        samples.append([t, v])
    cutoff = t - WINDOW
    while len(samples) > 2 and samples[1][0] <= cutoff:
        samples.pop(0)
    return samples


def eta_seconds(samples: list[list[float]], current: float, total: float) -> float | None:
    """Seconds left at the rate over ``samples``; None without enough of them."""
    if len(samples) < 2:
        return None
    (t0, v0), (t1, v1) = samples[0][:2], samples[-1][:2]
    span = t1 - t0
    if span < MIN_SPAN or v1 <= v0:
        return None
    rate = (v1 - v0) / span
    return max(0.0, (total - current) / rate)


# ---- writes (inside the caller's transaction where noted) -------------------


def fold_points(con: Any, run_id: str, rows: list[Any]) -> None:
    """Fold point rows ``(name, step, wall_time, ...)`` into ``max_step`` and
    the step samples. Runs inside the point write's transaction."""
    top: int | None = None
    t: float | None = None
    for r in rows:
        name, step, wall = r[0], r[1], r[2]
        if name.startswith("system."):
            continue
        top = step if top is None else max(top, step)
        e = _epoch(wall)
        if e is not None and (t is None or e > t):
            t = e
    if top is None:
        return
    row = con.execute(
        "SELECT max_step, step_samples FROM runs WHERE id = ?", [run_id],
    ).fetchone()
    if row is None:
        return
    new_max = top if row[0] is None else max(row[0], top)
    samples = _load(row[1])
    if t is not None:
        samples = fold_sample(samples, t, new_max)
    con.execute(
        "UPDATE runs SET max_step = ?, step_samples = ? WHERE id = ?",
        [new_max, json.dumps(samples), run_id],
    )


def recompute_max_step(con: Any, run_id: str) -> None:
    """``max_step`` from the stored points, step samples cleared: after the
    run's history was rewritten (rewind, fork, import)."""
    (top,) = con.execute(
        "SELECT MAX(step) FROM sequences WHERE run_id = ? "
        "AND substr(name, 1, 7) != 'system.'",
        [run_id],
    ).fetchone()
    con.execute(
        "UPDATE runs SET max_step = ?, step_samples = NULL WHERE id = ?", [top, run_id],
    )


def _check_number(name: str, v: Any, *, positive: bool) -> None:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise ValueError(f"{name} must be a finite number, got {v!r}")
    if positive and v <= 0:
        raise ValueError(f"{name} must be > 0, got {v!r}")
    if not positive and v < 0:
        raise ValueError(f"{name} must be >= 0, got {v!r}")


def check_total_steps(total: Any) -> None:
    if total is None:
        return
    if isinstance(total, bool) or not isinstance(total, int) or total <= 0:
        raise ValueError(f"total_steps must be a positive int or None, got {total!r}")


def check_progress(value: Any, total: Any) -> None:
    _check_number("progress", value, positive=False)
    if total is not None:
        _check_number("total", total, positive=True)


def set_total_steps(con: Any, run_id: str, total: int | None) -> None:
    """Set (None: clear) the run's ``total_steps``. A run whose ``max_step``
    predates the column gets it computed from its points once, here."""
    check_total_steps(total)
    row = con.execute("SELECT max_step FROM runs WHERE id = ?", [run_id]).fetchone()
    if row is None:
        from .ingest_ops import RunNotFound

        raise RunNotFound(f"run {run_id} not found")
    if row[0] is None and total is not None:
        (top,) = con.execute(
            "SELECT MAX(step) FROM sequences WHERE run_id = ? "
            "AND substr(name, 1, 7) != 'system.'",
            [run_id],
        ).fetchone()
        if top is not None:
            con.execute("UPDATE runs SET max_step = ? WHERE id = ?", [top, run_id])
    con.execute("UPDATE runs SET total_steps = ? WHERE id = ?", [total, run_id])


def set_progress(
    con: Any, run_id: str, value: float, total: float | None, wall_time: str | None,
) -> None:
    """Record ``run.progress(value, total)`` made at ``wall_time`` (client clock)."""
    check_progress(value, total)
    row = con.execute(
        "SELECT progress_samples FROM runs WHERE id = ?", [run_id],
    ).fetchone()
    if row is None:
        from .ingest_ops import RunNotFound

        raise RunNotFound(f"run {run_id} not found")
    samples = _load(row[0])
    t = _epoch(wall_time)
    if t is not None:
        samples = fold_sample(samples, t, float(value))
    con.execute(
        "UPDATE runs SET progress_value = ?, progress_total = ?, progress_samples = ? "
        "WHERE id = ?",
        [value, total, json.dumps(samples), run_id],
    )


# ---- reads ------------------------------------------------------------------


def _num(v: Any) -> Any:
    """A stored REAL that holds a whole number reads back as an int."""
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return v


def run_progress(row: dict[str, Any]) -> dict[str, Any] | None:
    """The API ``progress`` of a runs row: ``{fraction, current, total, unit,
    eta_seconds}``, or None when the run has no total."""
    total_steps = row.get("total_steps")
    if row.get("progress_value") is not None:
        unit = "progress"
        current = _num(row["progress_value"])
        total = row.get("progress_total")
        total = _num(total) if total is not None else total_steps
        samples = _load(row.get("progress_samples"))
    else:
        unit = "step"
        current = row.get("max_step") or 0
        total = total_steps
        samples = _load(row.get("step_samples"))
    if total is None or total <= 0:
        return None
    eta = eta_seconds(samples, current, total) if row.get("status") == "running" else None
    return {
        "fraction": min(1.0, max(0.0, current / total)),
        "current": current,
        "total": total,
        "unit": unit,
        "eta_seconds": eta,
    }
