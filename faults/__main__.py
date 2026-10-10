"""``python -m faults <scenario|all> [--systems cairn-http,mlflow,cairn-local] --out results/x.json``."""

from __future__ import annotations

import argparse
import shutil
import sys
import time

from bench import common as c

from .scenarios import SCENARIOS, SYSTEMS


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m faults", description=__doc__)
    ap.add_argument("scenario", choices=[*SCENARIOS, "all"])
    ap.add_argument("--systems", default=",".join(SYSTEMS))
    ap.add_argument("--out", required=True)
    ap.add_argument("--duration", type=float, default=None, help="seconds of logging per case (default 40)")
    ap.add_argument("--keep", action="store_true", help="keep the scenario data under BENCH_ROOT")
    args = ap.parse_args(argv)
    if args.duration:
        from . import scenarios as sc

        sc.DURATION = args.duration
    systems = [s for s in args.systems.split(",") if s]
    names = list(SCENARIOS) if args.scenario == "all" else [args.scenario]
    work = c.bench_root() / "faults" / time.strftime("%Y%m%d-%H%M%S")
    result = {"machine": c.machine_info(), "systems": systems, "argv": sys.argv, "scenarios": {}}
    for name in names:
        rows = []
        for system in systems:
            print(f"[{name}] {system}", flush=True)
            t0 = time.monotonic()
            row = SCENARIOS[name](system, work / name / system)
            row["wall_s"] = time.monotonic() - t0
            rows.append(row)
            brief = {k: row.get(k) for k in ("lost", "lost_accepted", "duplicated", "corrupted", "reordered",
                                              "recovery_s", "client_raised", "loop_blocked_s", "final_status",
                                              "na", "error", "summary", "eight_runs", "same_run_two_processes")
                     if row.get(k) is not None}
            print("   ->", brief, flush=True)
            result["scenarios"][name] = rows
            c.write_json(__import__("pathlib").Path(args.out), result)
        if not args.keep:
            shutil.rmtree(work / name, ignore_errors=True)
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
