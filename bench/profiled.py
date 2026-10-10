"""Run a module under yappi (all threads) and dump its profile on SIGTERM/exit.

``python -m bench.profiled OUT.json [--clock cpu|wall] MODULE [ARGS...]`` —
e.g. ``bench.profiled out.json cairn.cli server --repo R`` or
``bench.profiled out.json bench.worker '<json>'``. OUT.json gets the top
functions by inclusive and by own time (cairn and library frames alike).
"""

from __future__ import annotations

import atexit
import json
import os
import runpy
import signal
import sys

import yappi


def _dump(out: str) -> None:
    yappi.stop()
    stats = yappi.get_func_stats()
    rows = [{"name": f"{s.module.split('site-packages/')[-1].split('workspace/cairn/')[-1]}:{s.lineno} {s.name}",
             "ncall": s.ncall, "ttot": s.ttot, "tsub": s.tsub} for s in stats]
    threads = [{"name": t.name, "ttot": t.ttot} for t in yappi.get_thread_stats()]
    body = {
        "clock": yappi.get_clock_type(),
        "by_inclusive": sorted(rows, key=lambda r: -r["ttot"])[:60],
        "by_own": sorted(rows, key=lambda r: -r["tsub"])[:60],
        "threads": sorted(threads, key=lambda t: -t["ttot"])[:20],
    }
    with open(out, "w") as fh:
        json.dump(body, fh, indent=1)


def main() -> None:
    out = sys.argv[1]
    args = sys.argv[2:]
    clock = "cpu"
    if args[:1] == ["--clock"]:
        clock, args = args[1], args[2:]
    module, rest = args[0], args[1:]
    yappi.set_clock_type(clock)
    yappi.start(builtins=False)
    done = []

    def finish(*_a) -> None:
        if not done:
            done.append(1)
            _dump(out)
        os._exit(0)

    signal.signal(signal.SIGTERM, finish)
    signal.signal(signal.SIGINT, finish)
    atexit.register(lambda: done or (_dump(out), done.append(1)))
    sys.argv = [module, *rest]
    runpy.run_module(module, run_name="__main__", alter_sys=True)


if __name__ == "__main__":
    main()
