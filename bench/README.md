# cairn benchmarks (`bench/`)

Phase 0 of the 0.6.0 integrity + performance plan: measure cairn as it is
today, side by side with MLflow, without changing cairn. The fault-injection
suite lives in [`faults/`](../faults/README.md); the findings are in
[`REPORT.md`](REPORT.md).

## Re-running against another cairn checkout (one command)

```bash
export BENCH_ROOT=/some/scratch/dir      # optional; default $TMPDIR/cairn-bench
uv run python -m bench.suite --cairn /path/to/cairn-checkout --postgres
```

This runs every benchmark (`python -m bench all`, lab scale with the
overrides in `bench/suite.py::DEFAULT_SET`, i.e. the sizes `REPORT.md` was
measured at), then the whole fault suite (`python -m faults all`), and writes
`bench.json`, `faults.json` and `tables.md` (the report's tables) to
`bench/results/<cairn commit>-<date>/` (`--out-dir` to choose). Run it from
*this* checkout (the harness); `--cairn` only selects the cairn under test:
its `.venv/bin/python` runs the clients, `cairn server`/`cairn ui` and
`cairn sync` (the venv is created with `uv sync --extra ui` if missing).
`--cairn-python PY` names an interpreter instead. Spawned processes see the
harness through a directory holding only `bench/` and `faults/` and run in a
scratch cwd, so the harness checkout's own `cairn/` never shadows the one under
test. The checkout, its commit and cairn's version are recorded under
`machine` in every result file. Other flags: `--skip-bench`, `--skip-faults`,
`--scale quick`, `--set KEY=JSON` (replaces the defaults), `--backends`,
`--fault-duration`.

Both `python -m bench` and `python -m faults` take the same `--cairn` /
`--cairn-python` flags for single scenarios.

The harness targets the 0.6 architecture (run directories under
`CAIRN_DIR=<work>/cairn-runs`, the uploader daemon under
`CAIRN_AGENT_DIR=<work>/cairn-agent`, stopped at the end of every case).

## Running single scenarios

```bash
export BENCH_ROOT=/some/scratch/dir      # data, servers, helper venvs (default: $TMPDIR/cairn-bench)
uv run python -m bench throughput --scale quick --out bench/results/throughput-quick.json
uv run python -m bench all --scale quick --postgres --out bench/results/quick.json
uv run python -m bench api --scale lab --backends cairn-http,mlflow-sqlite --out bench/results/api-lab.json
uv run python -m bench.report bench/results/*.json faults/results/*.json   # markdown tables
```

Options: `--backends` (comma list), `--postgres` (adds `mlflow-postgres`;
needs podman — the suite starts `podman machine` if it is stopped and runs
`postgres:16-alpine` on port 4590), `--no-ui`, `--set KEY=JSON` to override one
size of the scale (`--set lag_secs=5 --set 'api_runs=[100]'`), `--keep` to keep
the data under `$BENCH_ROOT/runs/`.

Isolation: every process gets `HOME=$BENCH_ROOT/home` (and `XDG_*` under it), its own
`CAIRN_CACHE_DIR`/`CAIRN_WAL_DIR`/`CAIRN_AGENT_DIR`/`CAIRN_DIR`, no inherited `CAIRN_*`/`MLFLOW_*` variables
and `BROWSER=true`; servers bind 127.0.0.1 on ports 4500–4599 (cairn 4510–4539,
MLflow 4540–4569, fault proxy 4580–4589, Postgres 4590). cairn servers run with
`--no-auth` (and `cairn ui --no-open-browser`); the UI is driven by headless
Chromium only. Nothing touches `~/.cairn` or the user's cairn config.

Interpreters: cairn's (the `uv run` environment), MLflow's (`$BENCH_ROOT/venv-mlflow`,
created with `uv` on first use: `mlflow psutil httpx psycopg2-binary pillow
numpy`; or point `BENCH_MLFLOW_PYTHON` at one), Playwright's
(`$BENCH_ROOT/venv-pw` + `chromium-headless-shell` in `$BENCH_ROOT/pw-browsers`)
and a profiling one (`$BENCH_ROOT/venv-prof`: yappi + cairn's site-packages).

## Systems

| backend | what it is |
|---|---|
| `cairn-local` | 0.6: `cairn.Run(repo=<dir>)`: the run writes `$CAIRN_DIR/runs/<id>/`, the uploader daemon sends it to the repo's auto-started local server (`cairn server --daemon`, auth on; the harness triggers the auto-start like a client and reads `<repo>/server.json`) |
| `cairn-http` | 0.6: `cairn.Run(repo="cairn://…")`: the same run directory and uploader, to a `cairn server` the harness starts |
| `mlflow-sqlite` | `mlflow server` (SQLite backend store, `--artifacts-destination`, proxied artifacts); client `mlflow.log_metrics(dict, step)` per step (one REST call), `mlflow.log_image` |
| `mlflow-sqlite-async` | same server; the client logs with `synchronous=False` (MLflow's async logging queue) |
| `mlflow-postgres` | `mlflow server` over Postgres 16 in podman |

All clients have cairn's capture features off (no stdout/system metrics/source/env)
so point counts are exact.

## Scenarios

| scenario | measures |
|---|---|
| `throughput` | N = 1/4/16 clients (one run each) logging as fast as possible; scalar-only and with a 256² image every k steps. `client pts/s` = points / slowest client's loop+finish; `e2e pts/s` adds the time until every point is readable through the API. Per-step `track()` latency (max, time blocked in steps > 100 ms), client/server peak RSS |
| `lag` | one client logs 10 metrics + `t_log=time.time()` at 20 steps/s; a poller reads the run every 50 ms (cairn `/updates`, MLflow `get-history`); lag = first-visible − `t_log`; idle and with 4 flat-out clients |
| `storage` | bytes on disk per 1M scalar points (1 run × 10 metrics) and per GB of image pixels (seeded noise: incompressible, the worst case) after a clean server stop |
| `api` | p50/p95 of each request (after a warm-up) over projects of 1k / 10k runs (10 metrics × 100 steps, 20 params each), a 1M-point series and a 1000-metric run; then headless UI timings on the same data (runs table, workspace/charts): first content, settled (no request for 500 ms), requests, bytes, JS heap |
| `profile` | yappi (CPU, all threads) of the cairn server while 4 HTTP clients log, of the server's ingester while 4 local clients log, and of one HTTP client process |
| `api_profile` | yappi of the cairn server serving the slowest read endpoints at the largest size |

Scales (`bench/scenarios.py::SCALES`): `quick` (minutes) and `lab` (one
lab-scale run per scenario: 1 client × 1000 metrics × 1000 steps = 1M points,
16 × 100 × 1000, 10k-run projects, 1M-point series; tens of minutes). The
deterministic values (`bench/worker.py::value`) and seeded images make every
run reproducible; timing varies with the machine.

## Fair-comparison notes

* cairn-local and cairn-http share the read path (the same server code on the
  same SQLite schema), so `api` measures cairn once.
* MLflow's REST API has no "N runs' series" endpoint; `batch_series_*` uses
  `get-history-bulk-interval` (≤100 runs per call, **downsampled** to
  `max_results`), cairn's `POST /api/runs/series` returns full series.
  `series_downsampled_1000` is MLflow-only (cairn removed server-side
  downsampling).
* `filter_metric_and_param_50`: cairn `predicates [[metrics lt m0 0.5],
  [config exact optimizer adam]]` vs MLflow `metrics.m0 < 0.5 and
  params.optimizer = 'adam'` — same semantics.
* MLflow's `list_1000_params_stats` is `runs/search` with 1000 results (latest
  metrics + params per run), cairn's is `GET /api/runs?limit=1000&include=params,stats`.
