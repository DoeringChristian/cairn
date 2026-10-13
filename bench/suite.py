"""The whole Phase 0 measurement in one command: benchmarks, fault suite, tables.

    uv run python -m bench.suite --cairn /path/to/cairn-checkout --postgres

runs ``python -m bench all`` (``--scale``, default ``lab`` with the
``DEFAULT_SET`` overrides that keep it to tens of minutes), then
``python -m faults all``, then renders ``tables.md`` from both result files
into ``--out-dir`` (default ``bench/results/<cairn commit>-<date>/``).
The harness is this checkout's ``bench/``+``faults/``; the cairn under test is
``--cairn``'s ``.venv`` (created with ``uv sync --extra ui`` if missing), or
``--cairn-python``, or by default this checkout.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

from . import common as c

# The sizes REPORT.md was measured at: lab scale, except the storage run
# (MLflow logs 10 points per REST call: 1M points would take ~12 min per
# MLflow backend; bytes/point is linear in the count) and a 30 s lag probe.
DEFAULT_SET = ["storage_points=200000", "lag_secs=30"]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m bench.suite", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cairn", metavar="CHECKOUT", help="cairn checkout under test (default: this one)")
    ap.add_argument("--cairn-python", metavar="PY", help="interpreter with the cairn under test installed")
    ap.add_argument("--postgres", action="store_true", help="also MLflow on Postgres 16 (podman)")
    ap.add_argument("--scale", choices=["quick", "lab"], default="lab")
    ap.add_argument("--set", action="append", default=None, metavar="KEY=JSON",
                    help=f"scale overrides (default: {' '.join(DEFAULT_SET)})")
    ap.add_argument("--backends", help="bench backends (default: python -m bench's)")
    ap.add_argument("--out-dir", help="results directory (default bench/results/<commit>-<date>)")
    ap.add_argument("--skip-bench", action="store_true")
    ap.add_argument("--skip-faults", action="store_true")
    ap.add_argument("--fault-duration", type=float, help="seconds of logging per fault case (default 40)")
    args = ap.parse_args(argv)
    c.configure_cairn(args.cairn, args.cairn_python)  # validates, creates the venv, exports BENCH_CAIRN*
    commit = c._git(c.CAIRN_CHECKOUT, "rev-parse", "--short", "HEAD") or "cairn"
    out = Path(args.out_dir or c.REPO_ROOT / "bench" / "results" / f"{commit}-{time.strftime('%Y%m%d')}")
    out.mkdir(parents=True, exist_ok=True)
    who = ["--cairn-python", c.CAIRN_PY]
    files = []
    rc = 0
    if not args.skip_bench:
        cmd = [sys.executable, "-m", "bench", "all", "--scale", args.scale, "--out", str(out / "bench.json"), *who]
        for kv in (DEFAULT_SET if args.set is None else args.set):
            cmd += ["--set", kv]
        if args.postgres:
            cmd.append("--postgres")
        if args.backends:
            cmd += ["--backends", args.backends]
        print("+", " ".join(cmd), flush=True)
        rc |= subprocess.run(cmd, cwd=c.REPO_ROOT).returncode
        files.append(out / "bench.json")
    if not args.skip_faults:
        cmd = [sys.executable, "-m", "faults", "all", "--out", str(out / "faults.json"), *who]
        if args.fault_duration:
            cmd += ["--duration", str(args.fault_duration)]
        print("+", " ".join(cmd), flush=True)
        rc |= subprocess.run(cmd, cwd=c.REPO_ROOT).returncode
        files.append(out / "faults.json")
    files = [f for f in files if f.exists()]
    if files:
        r = subprocess.run([sys.executable, "-m", "bench.report", *map(str, files)], cwd=c.REPO_ROOT,
                           capture_output=True, text=True)
        (out / "tables.md").write_text(r.stdout)
        print(f"wrote {out / 'tables.md'}", flush=True)
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
