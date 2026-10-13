# Phase 0 report: cairn 0.5 vs MLflow (partial)

**Status: partial.** The session was cut short, so only the `throughput`
benchmark (most of it) and three of the eight fault scenarios ran. Everything
marked *not run* below still needs a run. The command in the last section re-runs
all of it.

* cairn under test: 0.5.0 (the 0.5 architecture), commit `335bdc7d` (dev/0.6, `cairn/` clean)
* MLflow 3 server on SQLite, and on Postgres 16 (podman `postgres:16-alpine`)
* Machine: Apple M5 Pro (18 cores), 64 GB, macOS 26.6, Python 3.13
* **Scale: `quick`**
  * throughput: 1 client × 10 metrics × 2000 steps; 4 and 16 clients × 10 metrics × 1000 steps each
  * media: 10 metrics × 300 steps with a 256² image every 3 steps
  * fault cases: `--duration 20`, i.e. 20 s of logging at 100 steps/s × 5 metrics (500 points/s)
* Raw data is in `bench/results/quick/`:
  * `throughput-partial.log`: the run log; the throughput scenario never finished, so no `bench.json`
  * `faults-*.json` and `fault-tables.md`
* Caveat: the fault runs overlapped the MLflow/media part of the throughput run on the same machine. The throughput numbers for those rows are a little pessimistic. The fault outcomes (point counts) are not affected.

## Throughput (scalar and media)

`client pts/s` = points ÷ the slowest client's loop + finish time. `e2e pts/s`
also counts the time until every point is readable through the API.
`max blocked s` = the longest single `track()` / `log_metrics()` call.

| variant | backend | clients | client pts/s | e2e pts/s | max blocked s |
|---|---|---|---|---|---|
| scalar | cairn-local | 1 | 22,360 | 12,499 | 0.74 |
| scalar | cairn-local | 4 | 53,940 | 24,699 | 0.66 |
| scalar | cairn-local | 16 | 147,278 | 82,632 | 0.97 |
| scalar | cairn-http | 1 | 24,644 | 24,469 | 0.55 |
| scalar | cairn-http | 4 | 43,447 | 43,148 | 0.66 |
| scalar | cairn-http | 16 | 80,834 | 80,577 | 0.94 |
| scalar | mlflow-sqlite | 1 | 1,166 | 1,164 | 0.58 |
| scalar | mlflow-sqlite | 4 | 2,815 | 2,804 | 3.44 |
| scalar | mlflow-sqlite | 16 | 3,248 | 3,228 | **35.66** |
| scalar | mlflow-sqlite-async | 1 | 2,502 | 2,491 | 0.00 |
| scalar | mlflow-sqlite-async | 4 | 1,563 | 1,556 | 0.00 |
| scalar | mlflow-sqlite-async | 16 | failed (no client finished) | – | – |
| scalar | mlflow-postgres | 1 | 1,106 | 1,093 | 0.00 |
| scalar | mlflow-postgres | 4 | 3,213 | 3,183 | 0.00 |
| scalar | mlflow-postgres | 16 | 3,510 | 3,484 | 0.29 |
| media | cairn-local | 1 | 3,015 | 1,905 | 0.58 |
| media | cairn-local | 4 | 10,413 | 7,845 | 0.68 |
| media | cairn-http | 1 | 2,298 | 2,287 | 0.56 |
| media | cairn-http | 4 | 6,854 | 6,827 | 0.68 |
| media | mlflow-sqlite | 1 | 1,071 | 1,067 | 0.12 |
| media | mlflow-sqlite | 4 | 2,046 | 2,010 | 1.52 |
| media | mlflow-sqlite-async | 1 | 2,238 | 2,222 | 0.00 |
| media | mlflow-sqlite-async | 4 | hung for over 10 minutes and was stopped | – | – |
| media | mlflow-postgres | 1, 4 | not run | | |

Not run: `lag`, `storage`, `api` (with the UI timings), `profile`, `api_profile`.

## Fault injection (cairn-http vs MLflow on SQLite, 20 s cases)

| fault | system | expected | lost | lost after ack | dup | corrupt | reordered | raised | loop blocked s | recovery s | final status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| server kill -9, restart after 5 s | cairn-http | 10000 | 0 | 0 | 0 | 0 | 0 | 0 | 9.0 | 4.6 | completed |
| server kill -9, restart after 5 s | mlflow | 10000 | 0 | 0 | 0 | 0 | 0 | 0 | 13.0 | 2.3 | FINISHED |
| server unreachable 30 s (RST) | cairn-http | 10000 | 0 (5160 before `cairn sync`) | 0 | 0 | 0 | 0 | 0 | 0.5 | needs `cairn sync` | completed |
| server unreachable 30 s (RST) | mlflow | 10000 | 0 | 0 | 0 | 0 | 0 | 0 | **30.9** | 0.2 | FINISHED |
| client kill -9 at t=10 s | cairn-http | 4885 | **60** | **60** | 0 | 0 | 0 | – | – | – (`cairn sync`: "nothing to sync") | running |
| client kill -9 at t=10 s | mlflow | 4600 | 0 | 0 | 0 | 0 | 0 | – | – | – | RUNNING |

Not run: `partition_30s`, `slow_server`, `disk_full`, `torn_writes`,
`concurrent`; the `cairn-local` column; MLflow on Postgres in the fault suite.

## Conclusions for 0.6 (from the data so far)

1. **Raw ingest speed is not cairn's problem.**
   * cairn takes 20–150k points/s from 1–16 clients.
   * MLflow manages 1–3.5k points/s with one REST call per step (Postgres scales no better than SQLite at 16 clients).
   * Phase 2 should spend its effort on the read and storage side, once those numbers exist, not on ingest.
2. **cairn-local has ingest lag; cairn-http does not.**
   * cairn-local end-to-end throughput is about half its client throughput, because the ingester polls every 2 s.
   * For cairn-http the two are equal.
   * This supports 0.6's "synchronous apply on upload" (visible on ack) and dropping client-side DB writing.
3. **Data integrity bug: `kill -9` of a cairn-http client loses acknowledged points.**
   * 60 points (~0.1 s at 500 points/s) were lost after `track()` had returned.
   * The client WAL did not hold them, so `cairn sync` found nothing to sync.
   * MLflow (synchronous) lost nothing.
   * This is exactly the gap 0.6's run-owned record log plus the separate uploader process close: write the record durably before `track()` returns (group commit).
   * The 0.6 acceptance test is `client_kill9` with lost after ack = 0.
4. **Server outages: cairn's WAL keeps training running, but recovery is manual.**
   * With the server unreachable for 30 s, MLflow blocked the training loop for the whole outage (30.9 s).
   * cairn blocked for 0.5 s, but 5160 points stayed in the client WAL until a manual `cairn sync`.
   * 0.6's background uploader with retry and backoff must make this automatic: recovery time should be close to 0 with no `cairn sync` needed.
5. **Server `kill -9` loses nothing on either system.**
   * Both block the loop during the restart (cairn 9 s, MLflow 13 s).
   * 0.6's uploader should take that blocking off the training thread entirely.
6. **Neither system marks a killed run as crashed.** cairn shows `running`, MLflow `RUNNING`. The 0.4 crash detection did not trigger within the test window.
7. **MLflow's async logging is fragile under load.** With 16 clients it failed, and with media and 4 clients it hung. This argues against copying its unbounded in-memory queue design.

## Re-running everything (one command)

From this checkout (the harness), against any cairn checkout:

```bash
export BENCH_ROOT=/some/scratch/dir      # optional; default $TMPDIR/cairn-bench
BROWSER=true uv run python -m bench.suite --cairn /path/to/cairn-checkout --postgres
```

This runs all benchmarks at lab scale (with `DEFAULT_SET` overrides), the full
fault suite and the table rendering, into `bench/results/<commit>-<date>/`.

* For a minutes-scale run, add `--scale quick --fault-duration 20` (the scale used in this report).
* The full lab run takes hours. Plan for it, or use `--backends` / `--skip-bench` / `--skip-faults` to split it up.
* Postgres needs podman. If it is unavailable, the run records a skip note instead.

See [`README.md`](README.md) for details.
