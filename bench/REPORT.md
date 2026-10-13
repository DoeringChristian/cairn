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

## 0.6 vs 0.5 vs MLflow (quick scale, 20 s fault cases)

* cairn under test: 0.6 architecture, commit `5e4fb6be` (dev/0.6, `cairn/` clean): run directories with
  group commit every 100 ms, the uploader daemon (`cairn sync --daemon`), the server as the only writer.
* `cairn-http`: run → uploader → a `cairn server` the harness starts. `cairn-local`: run → uploader → the
  repo's auto-started local server (the harness triggers the auto-start like a client; after a server
  `kill -9` the uploader starts it again by itself).
* "no sync" = what arrived through the uploader daemon alone (waiting up to 90 s for its backoff);
  "after sync" = after a manual `cairn sync` of the run directories.
* MLflow (SQLite) numbers for `server_kill9`, `unreachable_30s` and `client_kill9` are reused from the
  section above; the other five scenarios were run now (they ran in parallel with the cairn fault cases,
  so MLflow's timings are slightly pessimistic; point counts are unaffected).
* Raw data: `bench/results/quick-0.6/` (`faults-*.json`, `throughput*.json`, `fault-tables.md`).

### Faults: lost / duplicated points

| fault | 0.5 cairn-http | 0.6 cairn-http | 0.6 cairn-local | MLflow |
|---|---|---|---|---|
| server kill -9, restart after 5 s | 0 lost, loop blocked 9.0 s, recovery 4.6 s | **0 lost**, blocked 0.5 s*, recovery 2.7 s | **0 lost**, blocked 0.6 s*, recovery 0.6 s (uploader restarted the server) | 0 lost, blocked 13.0 s, recovery 2.3 s |
| server unreachable 30 s (RST) | 5160 lost until `cairn sync` | **0 lost without sync**, blocked 0.6 s*, recovery 0.6 s | n/a (no network) | 0 lost, blocked 30.9 s |
| partition 30 s (black hole) | not run | **0 lost without sync**, blocked 0.6 s*, recovery 2.2 s | n/a | 0 lost, blocked **34.8 s** |
| slow server (+250 ms/chunk) | not run | **0 lost**, 2000/2000 steps at full rate, blocked 0.7 s* | n/a | 0 lost, but only 27 of 2000 steps logged in 20 s (blocked 20.6 s) |
| client kill -9 at t=10 s | **60 lost after ack** (sync: nothing to sync) | 0 lost, no sync needed (726a9cde; 30 lost before it) | 0 lost (726a9cde; 30 before) | 0 lost |

**Fixed in 726a9cde:** the run log now hands every record to the OS before `track()` returns (fsync stays
batched every 100 ms), so a killed process loses nothing it logged; a power loss still loses at most the
last ~100 ms. Re-run of `client_kill9` (cairn-http and cairn-local): 0 lost, 0 duplicated, complete 0.04 s
after the kill without `cairn sync` (`bench/results/quick-0.6/client_kill9-726a9cde.json`). Cost: `track()`
of a scalar 5.7 µs → 11.4 µs (176k → 88k points/s in one process, no upload). The first `track()` of a
scalar no longer imports every handler's dependencies (0.55 s → 0.1 ms).
| server disk full (64 MB volume, released at t=25 s) | not run | **0 lost without sync**, blocked 0.9 s*, recovery 8.9 s, server stayed up | **0 lost**, recovery 8.7 s | 0 lost, blocked **31.8 s** |
| 8 clients × 8 runs, flat out | not run | 0 lost / 0 dup of 80,000, max blocked 0.9 s* | 0 / 0 of 80,000, 0.9 s* | 0 / 0 of 80,000, max blocked **20.3 s** |
| 2 processes, 1 run | not run | 0 lost / 0 dup (2 × 10,000) | 0 / 0 | 0 / 0 |

No scenario duplicated, corrupted or reordered a point on any system. Every cairn run ended `completed`
except the killed ones (`running`, see below).

\* The 0.5–0.9 s "loop blocked" on every cairn row is a single step: the **first** `track()` of a float
takes ~0.55 s because the type-handler lookup imports matplotlib, plotly, imageio-ffmpeg, multiprocessing
and ~1,000 other modules (see the findings). It is not network blocking: no other step exceeded 100 ms.

### Torn writes (truncate at 8 seeded random offsets, on copies)

| system | truncated file | trials | server failed to start | trials with loss | points lost | corrupt | dup |
|---|---|---|---|---|---|---|---|
| 0.6 cairn-http | run directory log segment (unacked tail; then `cairn sync`) | 8 | 0 | 8 | 52,305 | 0 | 0 |
| 0.6 cairn-http | same, untruncated (control) | 1 | 0 | 0 | 0 | 0 | 0 |
| 0.6 cairn-http | server `cairn.db` | 8 | **8** | – | – | – | – |
| MLflow | `mlflow.db` | 8 | **8** | – | – | – | – |

The run log behaves as specified: the reader keeps the valid prefix, `cairn sync` uploads it, nothing is
corrupted or duplicated, and the loss is exactly the unacked records past the cut (the server had acked 2,335
of the 10,000 points; a cut before the acked offset loses all 7,665 unacked, a later cut fewer). A truncated
SQLite database is unrecoverable for both systems (`database disk image is malformed`, the server does not
start); that is what `cairn backup` is for. (`cairn-local` uses the same two files; not measured twice.)

### Throughput (scalar and media)

| variant | clients | 0.5 cairn-http e2e pts/s | 0.6 cairn-http e2e pts/s | 0.5 cairn-local e2e | 0.6 cairn-local e2e | MLflow (SQLite) e2e |
|---|---|---|---|---|---|---|
| scalar | 1 | 24,469 | 20,580 | 12,499 | 20,233 | 1,164 |
| scalar | 4 | 43,148 | 30,991 | 24,699 | 29,223 | 2,804 |
| scalar | 16 | 80,577 | 55,827 | 82,632 | 49,927 | 3,228 |
| media | 1 | 2,287 | 1,898 | 1,905 | 1,924 | 1,067 |
| media | 4 | 6,827 | 2,908 | 7,845 | 2,937 | 2,010 |

`e2e` = points ÷ (slowest client's loop + `finish()` + time until every point is readable). In 0.6
`finish()` waits for the uploader's ack, so client and e2e rates are equal (visible 0.01–0.03 s after
finish): the 0.5 cairn-local ingest lag is gone. Caveats: at quick scale a client's whole loop is
0.7–2.5 s, of which ~0.55 s is the first-`track()` import above, so these numbers mostly measure fixed
costs. The steady-state `track()` cost is 0.06–0.09 ms per step of 10 scalars (p50). With 4–16 clients
the `finish()` wait (0.5–1.7 s) is the one per-machine uploader draining every run; that is where 0.6 loses
to 0.5 at 16 clients and with media (4 clients: 2,900 vs 6,800 pts/s).

### What still loses data, and why

1. **Client `kill -9` still loses acknowledged points: 30 in 0.6 (60 in 0.5).** The acceptance target
   (0 lost after `track()` returned) is not met. The cause is the design in spec §2, not the uploader:
   `track()` appends to an in-process buffer and returns; the group-commit thread writes and fsyncs at most
   every 100 ms (`CAIRN_SYNC_INTERVAL_MS`). A `kill -9` loses whatever is still in that buffer: up to 100 ms
   of logging, here 6 steps × 5 metrics. Everything that reached the segment was uploaded with no sync
   needed. A reproducer (no server needed):

   ```bash
   CAIRN_DIR=$(mktemp -d) CAIRN_UPLOADER=off python -c "
   import cairn, os
   r = cairn.Run('p', repo='cairn://127.0.0.1:1', capture_source=False, capture_stdout=False,
                 capture_env=False, capture_system_metrics=False)
   for s in range(1000): r.track(float(s), name='x', step=s)
   os.kill(os.getpid(), 9)"
   # cairn.sdk.runlog.log.scan(<CAIRN_DIR>/runs/<id>/log) -> last_seq 1 (create_run only):
   # all 1000 returned track() calls are gone
   ```

   To get 0, the record has to reach the OS before `track()` returns: a `write()` of the frame per
   call (it survives `kill -9`; fsync can stay batched for power loss), or `track()` blocking until the next
   group commit. This is a product decision; it was not changed here.
2. **A killed run stays `running`.** No crash detection fired in either cairn system within the test
   window (about 70 s after the kill), same as 0.5 and MLflow.
3. Server-side faults (kill -9, outage, partition, slow link, disk full, concurrency) lose nothing in 0.6,
   with **no manual `cairn sync`**, and never block the training loop. MLflow also loses nothing but blocks
   the loop for the whole outage (31–35 s), or slows it 75× on a slow link.

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
