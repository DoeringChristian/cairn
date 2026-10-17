"""A run's series: the key its server-assigned version is numbered in."""

from __future__ import annotations

from typing import Any, Mapping


def run_series_key(run: Mapping[str, Any]) -> tuple[str | None, str | None, str]:
    """A run's series: ``(group, job_type, name)``, the key its version is
    numbered in. ``exp-44 · train`` and ``exp-43 · train`` are different
    series, and so are the same name under two job types; a missing group or
    job type is part of the key. A run without a name is its own (keyed by
    its id). Mirror of cairn-ui's ``runSeriesKey`` (src/lib/run-series.ts).
    Takes an API row (``group``) or a ``runs`` row (``run_group``)."""
    group = run["group"] if "group" in run else run.get("run_group")
    return (group, run.get("job_type"), run.get("display_name") or run["id"])
