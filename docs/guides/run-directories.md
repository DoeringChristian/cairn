# Run directories, syncing and backup

Since 0.6, a training process never writes the repo's database. A run writes
only its own **run directory** on the machine it runs on. A separate
**uploader** process sends that directory to a **server**, and the server is
the only process that writes the database and the blob store. This page
covers each part, working without a reachable server, `cairn sync`, backups,
`cairn fsck`, and upgrading a repo from 0.5.

```
cairn.Run ──writes──▶ ./.cairn/runs/<run_id>/ ──uploader (HTTP)──▶ server ──▶ cairn.db + artifacts/
                                                                     ▲
                         cairn.Reader, CLI, cairn ui ──── HTTP ──────┘
```

## The run directory

Every run gets a directory under `$CAIRN_DIR/runs/<run_id>/`. `CAIRN_DIR`
defaults to `./.cairn` in the current working directory, much like wandb's
`./wandb`:

| Path | Holds |
|---|---|
| `run.json` | Run id, project, where the run uploads to (a server URL, or a local repo), creation time, SDK version |
| `log/000000.seg`, ... | The primary process's record log (log name `main`) |
| `blobs/<sha256>` | Images, files and artifact payloads this run logged, by content hash |
| `procs/<label>/log/` | The log of an attached process ([several processes, one run](runs.md#several-processes-one-run)) |
| `acked` | The highest record number the server confirmed, per log (written only by the uploader) |
| `FINISHED` | Written when the primary finishes (status, exit code, time); `procs/<label>/FINISHED` when a worker detaches |

Each log has exactly one writer, guarded by a file lock (`log/.lock`); a
second live process with the same label raises `ValueError`.

### The record log

Everything a run records (points, config, summary, tags, artifact versions,
the finish) is a record in its log. Each record is framed with its length
and CRC checksums, so a log cut off by a crash is read up to the last
complete record, and nothing after a damaged record is trusted.

Every record is written to the file (handed to the OS) before `track()`
returns; a flusher `fsync`s the file at most every 100 ms
(`CAIRN_SYNC_INTERVAL_MS`), and at once on `finish()`, at interpreter exit
and on SIGTERM/SIGINT. A blob is written and synced before the record that
names it. `track()` never waits on the network or the disk's fsync.

So a `kill -9` (or any crash) of the training process loses nothing it
logged, and the uploader still uploads all of it. A power loss or OS crash
loses at most the last ~100 ms. If the disk is full, records stay in memory
and are written once there is space again; `track()` does not raise.

## The uploader

When a run starts, it registers its directory with the uploader daemon of
this user and machine and starts the daemon if none is running (as
`python -m cairn sync --daemon`, detached). Training never waits for it.

- It uploads every registered directory: the records after `acked`, with
  the blobs they name first.
- **Exactly once.** The server keeps, per run and log, the last record
  number it applied, and applies a batch in the same database transaction
  that advances that number. A record sent twice (after a lost reply, a
  restart, or `cairn sync` running next to the daemon) is ignored.
- **It outlives the run.** When the training process is killed, the daemon
  keeps uploading what reached the log.
- **Retries.** On failure it backs off per server, from 1 s doubling up to
  60 s (a `Retry-After` from the server wins), and keeps trying as long as
  the directory exists.
- It forgets a directory once the server has confirmed all of it and no
  process writes it any more, and exits after 10 minutes with nothing left
  to do (`CAIRN_AGENT_IDLE_EXIT`, in seconds).
- Its state (lock, pid, `agent.log`, the list of registered directories)
  is in `$CAIRN_AGENT_DIR`, by default `~/.local/state/cairn/agent`
  (`$XDG_STATE_HOME/cairn/agent`).

`run.finish()` writes the finish record, then waits up to
`CAIRN_FINISH_TIMEOUT` seconds (default 30) for the server to confirm
everything. If it does not, the run prints how many records are still
pending; the uploader goes on sending them in the background.

`CAIRN_UPLOADER=off` (or `0`, `false`, `no`) keeps runs from registering
with the uploader: they only write their directories, and `finish()` does
not wait. Upload them later with `cairn sync`.

## Where runs upload to

A run uploads to the target it resolves like every client
([Configuration](../reference/configuration.md#resolution-order)):

- **A server URL** (`repo="cairn://host:4300"`, `server=`, `CAIRN_SERVER`,
  ...): the uploader sends the directory there.
- **A local repo** (`repo="./.cairn"`, or nothing): the repo's own server on
  this machine receives it. If none is running, one is started in the
  background (see below).

Both end in the same place: a server that applies the records to the
database. The run directory itself is never a repo; with the defaults,
`./.cairn/runs/` simply sits next to the repo's `cairn.db`.

### The local server

A `cairn.Reader`, a CLI command, `cairn ui` and the uploader all talk HTTP.
For a local repo they use the server registered in `<repo>/server.json`
when it is alive and answers. Otherwise `cairn ui` serves the repo itself in
the foreground, and the others start one in the background:
`cairn server --repo <repo> --daemon`. It listens on loopback only, on a
free port, with auth on (it uses the repo's same-user token
`auth/local.token`), writes its output to `<repo>/server.log`, and exits
after 30 minutes without requests (`CAIRN_SERVER_IDLE_TIMEOUT`, in seconds;
`cairn server --daemon --idle-timeout`).

One repo has one server: it holds `<repo>/server.lock` while it runs, and a
second `cairn server` on the same repo refuses to start. `cairn ui` on a repo
that is already served opens that server's viewer and returns.

The server refuses a repo on a network filesystem (NFS, SMB, sshfs,
Lustre, GPFS, Ceph, ...), because SQLite's locking and `fsync` are not
reliable there. Keep the repo on a local disk and let runs on other machines
upload to its server over HTTP. `CAIRN_ALLOW_NETWORK_DB=1` overrides the
check at your own risk.

## Working without a server

A run does not need a reachable server. If the server is down, unreachable
or the machine is offline, the run keeps logging to its directory and the
uploader keeps retrying in the background. When the run finishes, it waits
`CAIRN_FINISH_TIMEOUT` seconds and prints a notice; nothing is lost, the
directory stays.

To upload later, in the foreground:

```bash
cairn sync                              # every run directory in $CAIRN_DIR (./.cairn)
cairn sync path/to/.cairn/runs/<id>     # one run directory
cairn sync --server https://cairn.example.com   # upload to this server instead
```

`PATHS` are run directories or directories holding them (a `.cairn`
directory or its `runs/`). Without `--server`, each directory goes to the
server recorded in its `run.json`. `cairn sync` uses the same exactly-once
protocol as the daemon, so running it while the daemon also uploads is safe.
A directory that could not be uploaded is reported and kept, and the command
exits with an error.

This also covers a machine with no network at all: log with
`CAIRN_UPLOADER=off`, copy the `.cairn/runs/` directory to a machine that
reaches the server, and run `cairn sync --server URL` there.

### Cleaning up

Run directories are kept after upload. `cairn sync --clean` deletes the
ones that are fully confirmed: the run finished and the server acknowledged
every record of every log. It never deletes anything unconfirmed, and says
why it kept a directory (`still being written`, `not finished`,
`not fully confirmed by the server`).

```bash
cairn sync --clean
```

## Clusters

Run the server on a machine with a local disk that the compute nodes can
reach (a login node, a workstation), and point the jobs at it:

```bash
cairn server --repo /local/disk/.cairn --ui     # on the login node
```

```python
run = cairn.Run("sweep", repo="cairn://login-node:4300")   # in each job
```

Each job writes its run directory under its working directory (or
`CAIRN_DIR`, e.g. node-local scratch) and the uploader on each node sends
it. Nothing on the training path waits for the network. If the nodes cannot
reach any server, log with `CAIRN_UPLOADER=off` and run `cairn sync --server
URL` from a machine that can see both the run directories and the server.

## Backups

The server makes consistent copies of the database while it runs (SQLite's
online backup):

```bash
cairn backup                       # <repo>/backups/cairn-<UTC time>.db
cairn backup --to ~/cairn-backups  # ...and download it here
cairn backup --server cairn://host:4300
```

Blobs (`<repo>/artifacts/`) are immutable, content-addressed files: copy
them with any file tool (`rsync`). A database backup names only blobs that
existed when it was taken, so copying the blobs after the database is safe.

## Checking a repo: `cairn fsck`

```bash
cairn fsck            # report
cairn fsck --repair   # apply the safe repairs
```

`cairn fsck` asks the server to check:

- the database (`PRAGMA integrity_check`);
- blobs the database names that are missing, and stored blobs whose bytes
  no longer match their hash (corrupt);
- blobs nothing references (`cairn gc` deletes them after a day), artifact
  rows whose blob is gone, upload progress of deleted runs, and 0.5 run logs
  not imported yet.

It also compares the run directories on this machine (`--runs-dir`, default
`$CAIRN_DIR/runs`) with what the server applied. A directory whose `acked`
is ahead of the server means the server lost acknowledged records, for
example after restoring an older backup.

`--repair` moves corrupt blobs to `<repo>/quarantine/` (kept, never deleted),
drops artifact rows of blobs that are gone, and rewinds `acked` in the run
directories that are ahead, so the uploader (or `cairn sync`) sends those
records again. The command exits with status 1 when a problem remains.

## Upload protocol

The uploader, `cairn sync` and anything else that wants to upload use these
routes (writer role):

| Route | Does |
|---|---|
| `GET /api/ingest/runs/{run_id}/logs/{log}` | `{"applied_seq": n}`: the last record of that log the server applied (0 if none) |
| `POST /api/ingest/runs/{run_id}/logs/{log}` | Body `{"from_seq": n, "records": [...]}` (gzip allowed, at most 8 MiB). Applies the records after `applied_seq` in one transaction and returns the new `applied_seq` |
| `HEAD /api/blobs/{sha256}` | 200 when the blob is stored, else 404 |
| `PUT /api/blobs/{sha256}` | Stores a blob; the server checks the hash. 201 stored, 200 already there, 400 hash mismatch |

`log` is `main` for the primary, or a worker's label. A `POST` answers 409
with `applied_seq` when records are missing before `from_seq` (resend from
`applied_seq + 1`), 409 with `missing_blobs` when a record names a blob the
server does not have (`PUT` them, then resend; nothing was applied), 503
with `Retry-After` when the server is busy or the run a log belongs to does
not exist yet, 413 for a body that is too large, and 422 for a malformed
batch.

A run whose primary log has no record applied for 5 minutes (heartbeats
every 10 seconds count) becomes `crashed`; a later record makes it
`running` again.

The server also offers a downsampled view of a scalar series,
`GET /api/runs/{id}/series/{name}?x=step&buckets=N&from=&to=` (up to 10,000
buckets), which returns per bucket the first and last step, the min, max and
last value, and the number of points.

## Upgrading from 0.5

Upgrading a 0.5 repo needs no manual step and drops no data. The first time
a 0.6 server opens the repo (a `cairn server`, `cairn ui`, or the server a
Reader or the uploader starts), it:

1. backs the database up to `<repo>/backups/cairn-<UTC time>-pre-0.6.db`;
2. migrates the schema (additively);
3. imports the 0.5 run logs still pending in `<repo>/wals/` with the 0.5
   ingester, exactly once, and renames each imported log `*.imported`
   (never deleting it). A worker's log whose run does not exist yet stays
   for the next start.

Clients wait for a server that is still upgrading (up to 15 minutes) instead
of starting a second one. A database written by a newer cairn is refused.

What changes for you:

- **Runs write `./.cairn/runs/<id>/`**, not `<repo>/wals/`. Set `CAIRN_DIR`
  to put run directories elsewhere.
- **The repo must be on a local disk.** A repo on NFS used to work through
  the ingest lease; 0.6 refuses to serve it. Move the repo to a local disk,
  run `cairn server` there and log to it over HTTP (see [Clusters](#clusters)).
- **`CAIRN_WAL_DIR` is gone**, and so is the client log in the user cache
  directory (`…/cairn/wal/`). Logs a 0.5 server-mode run left there are not
  imported: replay them with cairn 0.5's `cairn sync` before upgrading.
- **`cairn sync`** now uploads run directories (`cairn sync [PATHS] [--clean]
  [--server URL]`); it no longer takes `--repo`.
- **`cairn.Reader` and CLI commands** on a local repo go through the repo's
  server (started when needed) instead of opening the database.
