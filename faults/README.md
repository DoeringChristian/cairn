# cairn fault injection (`faults/`)

Phase 0 of the 0.6.0 integrity work: what each system does to logged data when
things break, measured, not assumed. Results are summarised in
[`bench/REPORT.md`](../bench/REPORT.md).

```bash
export BENCH_ROOT=/some/scratch/dir
uv run python -m faults all --out faults/results/faults.json
uv run python -m faults server_kill9 --systems cairn-http,mlflow --duration 20 --out /tmp/x.json
uv run python -m bench.report faults/results/faults.json
```

Same isolation as `bench/` (own `HOME`, `CAIRN_CACHE_DIR`, `CAIRN_WAL_DIR`,
`BROWSER=true`, ports 4500–4599, `--no-auth` servers). `disk_full` creates and
mounts a 64 MB sparse HFS+ image under `$BENCH_ROOT` with `hdiutil` (macOS)
and detaches it afterwards.

## Systems (columns)

* `cairn-http` — `cairn.Run(repo="cairn://…")` to a `cairn server`: the central-server deployment.
* `mlflow` — MLflow client (synchronous `log_metrics` per step, default retry
  settings) to `mlflow server` on SQLite.
* `cairn-local` — `cairn.Run` writing its log into a local repo, a `cairn
  server` on the repo ingesting it (the "server" of the server faults).

## The training loop

`bench.worker` logs `METRICS=5` metrics at `RATE=100` steps/s for
`DURATION=40` s (500 points/s), catching and counting exceptions per step
(a robust training script) and writing the last step whose log call returned to
a progress file. Values are deterministic (`m{j}` at step `s` = `s*1000 + j +
0.5`), so after the fault every point is read back through the API and counted:

* **lost** — expected (step, metric) pairs not stored; **lost after ack'd** —
  of those, at steps whose `track()`/`log_metrics()` call had returned;
* **dup** — a (step, metric) stored twice; **corrupt** — a wrong value or a
  step never logged; **reordered** — adjacent step inversions in insertion
  order (cairn: rowid; MLflow: timestamp);
* **raised** — calls that raised in the loop (+ crash if the process died);
  **loop blocked s** — time spent in steps that took > 100 ms;
* **recovery s** — from the end of the fault until every point up to the
  step being logged at that moment is readable;
* **final status** — the run's status afterwards.

For cairn-http, a run that ended with data still in its client WAL gets
`cairn sync` (the documented recovery); the row keeps the pre-sync loss in
`before_sync`.

## Scenarios

| scenario | fault |
|---|---|
| `server_kill9` | at t=10 s `kill -9` the server process group; restart it 5 s later on the same storage and port |
| `unreachable_30s` | a TCP proxy between client and server resets every connection and refuses new ones for 30 s |
| `partition_30s` | the proxy black-holes traffic for 30 s (connections hang; clients hit their timeouts) |
| `slow_server` | the proxy adds 250 ms per forwarded chunk, both directions, for the whole run |
| `client_kill9` | `kill -9` the training process at t=10 s (then `cairn sync` for cairn-http) |
| `disk_full` | the server's storage (cairn-local: the whole repo) on a 64 MB volume filled to ~1.5 MB free; scalars + a 128² image every 10 steps; the filler is deleted at t=25 s |
| `torn_writes` | on copies: truncate a file at 8 seeded random offsets, restart a server on the copy, read. cairn-local: the run's unapplied log and `cairn.db`; cairn-http: the client WAL with pending entries (then `cairn sync`) and `cairn.db`; mlflow: `mlflow.db`. Reports server start, reads, `PRAGMA quick_check`, lost/corrupt points |
| `concurrent` | 8 clients on 8 runs flat out; 2 processes on one run (cairn: second process `primary=False, label=`; MLflow: both `start_run(run_id=)`), different metric names |

Not covered (yet): packet loss/reordering on the link, disk full on the
*client* side, upgrade mid-life (no earlier on-disk version to upgrade from in
this harness), power loss (fsync/`F_FULLFSYNC` behaviour cannot be tested
without pulling power; see the report's notes on durability settings).
