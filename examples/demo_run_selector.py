"""Demo script for dynamic run selectors (WS-RX, `cairn/ui/src/lib/run-selector.ts`).

Logs ONE short, fast run (a handful of scalar steps, no sleep) under a
*fixed* run name so it's easy to simulate "a new run just landed" for a
report's cards block or a comparison bound to a `RunSelector` — e.g. a
"newest-per-name" or "latest N" selector watching for runs named
``training-run``.

Run it once to seed a run, build a report/comparison with an "auto (query)"
cards block/run set (name pattern ``training-run``, mode "newest-per-name"
or "latest-n"), then run this script again — the newly logged run should
appear after clicking "refresh" (or a page reload, since the resolution
query also refetches on window focus).

Usage::

    uv run cairn server --repo /tmp/cairn-demo/.cairn
    CAIRN_SERVER=http://localhost:4300 uv run python examples/demo_run_selector.py
    # ...run it again to simulate a new run appearing...
    CAIRN_SERVER=http://localhost:4300 uv run python examples/demo_run_selector.py

    # browse http://localhost:4301/ — open a report/comparison with an
    # "auto (query)" run selector on project "run-selector-demo" and click
    # "refresh" after each invocation.

Override the project/run name/tag via env vars if you want several
independently-tracked "families" of runs:
    CAIRN_RUN_SELECTOR_PROJECT, CAIRN_RUN_SELECTOR_NAME, CAIRN_RUN_SELECTOR_TAG
"""

from __future__ import annotations

import math
import os
import random

import cairn


def main() -> None:
    from cairn.config import resolve_target

    target = resolve_target()
    print(f"Logging to {target.kind} at {target.location}")

    project = os.environ.get("CAIRN_RUN_SELECTOR_PROJECT", "run-selector-demo")
    name = os.environ.get("CAIRN_RUN_SELECTOR_NAME", "training-run")
    tag = os.environ.get("CAIRN_RUN_SELECTOR_TAG", "run-selector-demo")

    run = cairn.Run(project=project, name=name, tags=[tag])
    run["hparams"] = {"lr": round(random.uniform(1e-4, 1e-2), 5), "seed": random.randint(0, 9999)}

    for step in range(10):
        loss = 2.0 * math.exp(-step / 4.0) + random.uniform(0, 0.05)
        run.track(loss, name="train.loss", step=step)
        run.track(min(0.99, 0.2 + step * 0.08), name="train.accuracy", step=step)

    run.add_note("Logged by examples/demo_run_selector.py — simulates a new run for RunSelector demos.")
    print(f"Logged run {run.id!r} (name={name!r}, project={project!r}, tag={tag!r}). Run: {run.url}")
    # No run.finish() required — the atexit hook handles it on interpreter exit.


if __name__ == "__main__":
    main()
