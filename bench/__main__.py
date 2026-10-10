"""``python -m bench <scenario> [--scale quick|lab] [--backends ...] --out results/x.json``.

Scenarios: throughput, lag, storage, api (API latencies + UI timings),
profile (yappi: server/ingester/client while logging), api_profile, all.
"""

from __future__ import annotations

import argparse
import shutil
import sys
import time
from pathlib import Path

from . import common as c
from .scenarios import SCENARIOS
from .systems import BACKENDS, close_postgres, postgres

DEFAULT_BACKENDS = ["cairn-local", "cairn-http", "mlflow-sqlite", "mlflow-sqlite-async"]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m bench", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("scenario", choices=[*SCENARIOS, "all"])
    ap.add_argument("--scale", choices=["quick", "lab"], default="quick")
    ap.add_argument("--backends", default=",".join(DEFAULT_BACKENDS),
                    help=f"comma-separated subset of {BACKENDS} (mlflow-postgres needs podman)")
    ap.add_argument("--postgres", action="store_true", help="add mlflow-postgres (podman)")
    ap.add_argument("--no-ui", action="store_true", help="api: skip the headless UI timings")
    ap.add_argument("--out", required=True, help="results JSON path")
    ap.add_argument("--keep", action="store_true", help="keep the scenario's data under BENCH_ROOT")
    args = ap.parse_args(argv)

    backends = [b for b in args.backends.split(",") if b]
    if args.postgres and "mlflow-postgres" not in backends:
        backends.append("mlflow-postgres")
    unknown = set(backends) - set(BACKENDS)
    if unknown:
        ap.error(f"unknown backends {sorted(unknown)}")
    notes = []
    if "mlflow-postgres" in backends and postgres() is None:
        from . import systems

        notes.append(f"mlflow-postgres skipped: {systems._PG.note if systems._PG else 'unavailable'}")
        backends.remove("mlflow-postgres")

    names = list(SCENARIOS) if args.scenario == "all" else [args.scenario]
    work = c.bench_root() / "runs" / time.strftime("%Y%m%d-%H%M%S")
    result = {"machine": c.machine_info(), "scale": args.scale, "backends": backends, "notes": notes,
              "argv": sys.argv, "scenarios": {}}
    out = Path(args.out)
    try:
        for name in names:
            t0 = time.monotonic()
            fn = SCENARIOS[name]
            kw = {"ui": not args.no_ui} if name == "api" else {}
            res = fn(args.scale, backends, work / name, **kw)
            res["wall_s"] = time.monotonic() - t0
            result["scenarios"][name] = res
            c.write_json(out, result)
            if not args.keep:
                shutil.rmtree(work / name, ignore_errors=True)
    finally:
        close_postgres()
        c.write_json(out, result)
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
