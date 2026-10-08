# Server, auth and deployment

cairn stores everything in one repo directory, `.cairn/`. You can write to it
directly, or run a server in front of it so that other machines can log runs
and browse them. This page covers the server commands, the ways a run reaches
the repo, authentication, and running cairn for a team.

## Where runs are written

| Mode | How you select it | What happens | Use it for |
|---|---|---|---|
| Local | `repo="./.cairn"` (or any path), or nothing: `./.cairn` is the default | Each run appends to its own log in `.cairn/wals/`; the repo's one ingester applies the logs to the database | One machine, or many processes and nodes on a shared filesystem (Slurm, Ray, NFS) |
| Server | `repo="cairn://host:4300"` | The SDK sends everything over HTTP to a `cairn server` | Logging from other machines |

Both share one on-disk format, so a repo written locally can be served
later without migration. How `repo` is resolved when you don't pass it
(`cairn.configure`, `CAIRN_REPO`, the config file) is described in
[Configuration](../reference/configuration.md).

### Local repos: run logs and the ingest lease

```python
run = cairn.Run(project="sweep", repo="/shared/nfs/.cairn")
```

A run on a local repo never touches SQLite. It appends every write to its
own log, `.cairn/wals/<run_id>.wal.jsonl` (one JSON record per line, synced
to disk), and stores images, files and other blobs in the repo's
content-addressed store. Hundreds of processes can log to one repo at once
without contending for the database.

Exactly one process at a time writes the database: the holder of the repo's
**ingest lease**, the file `.cairn/ingest.lease`. It applies the logs and
makes every other write (edits from the UI or the CLI, sweep claims, garbage
collection):

- `cairn ui` and `cairn server` hold the lease for as long as they run, and
  ingest the logs every 2 seconds. The lease names their URL, so readers and
  CLI commands on the repo send their writes to them.
- Without a server, a `cairn.Reader`, a CLI command, a sweep agent or a run
  that needs an answer takes the lease for a moment, ingests what is
  pending, does its writes and releases it.

A record is applied exactly once: each log's read position is stored in the
database in the same transaction as the records it covers, so a crash or a
restart of the ingester continues where it stopped. Once a run's final
record (its finish) is ingested, its log file is deleted.

A run whose log gets no new record (heartbeats included, every 10 seconds)
for 5 minutes without having finished is marked `crashed`, and an alert is
raised. If records arrive later (the process was only paused, or a node's
filesystem caught up), it is `running` again.

The lease is a plain file, so it works on NFS: it is created atomically,
renewed every few seconds, and taken over when its holder stops renewing it
(at once when the holder was a process on the same machine that died).

### Clusters / SLURM

Point every job at the same repo on the shared filesystem:

```python
run = cairn.Run(project="sweep", repo="/shared/nfs/.cairn")
```

- Each process writes its own run log; nothing is locked while training.
- For a live view while jobs run, start `cairn ui --repo /shared/nfs/.cairn`
  (or `cairn server --ui`) on one machine, e.g. the login node. It holds the
  lease and ingests the logs every 2 seconds.
- Sweeps need someone to hand out trials: with a server, every
  `cairn agent` claims trials from it. Without one, agents take the lease in
  turn for each claim, which is fine on one machine; across nodes, prefer a
  server (`repo="cairn://login-node:4300"`).
- Without any server, `cairn.Reader` or a CLI command catches up on the logs
  when you read.
- For one run across many processes (every rank of a distributed job), give
  them all the same `CAIRN_RUN_ID` and use `label="auto"`: rank 0 creates
  the run, the other ranks join it and write logs of their own. See
  [Several processes, one run](runs.md#several-processes-one-run).

### Distributed runners

Recipes for common launchers, in the repository's
[`examples/`](https://github.com/DoeringChristian/cairn/tree/main/examples)
(see [Examples](../examples.md#distributed-runners)). Each logs every process
of a job into one run: the processes share a run id (`CAIRN_RUN_ID`, or one
broadcast by rank 0), and each gets a label from its rank. **Shared FS**
means a local repo on a filesystem every node mounts (NFS, Lustre); **HTTP**
means `CAIRN_REPO=cairn://host:4300` plus `CAIRN_TOKEN`, for machines that
share no filesystem with the repo. Most recipes work either way; the column
says what the example sets up.

| Runner | Recipe | Mode | How ranks map to cairn |
|---|---|---|---|
| torchrun | [`torchrun_ddp.py`](https://github.com/DoeringChristian/cairn/blob/main/examples/torchrun_ddp.py) | Shared FS or HTTP | `label="auto"` reads `RANK`; the id from `CAIRN_RUN_ID` |
| torchrun, no launch variable | [`torchrun_attach.py`](https://github.com/DoeringChristian/cairn/blob/main/examples/torchrun_attach.py) | Shared FS or HTTP | rank 0 creates the run and broadcasts `run.id`; the others `cairn.attach(run_id, label=f"rank{rank}")` |
| Accelerate | [`accelerate_ddp.py`](https://github.com/DoeringChristian/cairn/blob/main/examples/accelerate_ddp.py) | Shared FS or HTTP | `label="auto"` reads `RANK` (set by `accelerate launch`) |
| DeepSpeed | [`deepspeed_ddp.py`](https://github.com/DoeringChristian/cairn/blob/main/examples/deepspeed_ddp.py) | Shared FS or HTTP | `label="auto"` reads `RANK` (set by `deepspeed`); multi-node: `CAIRN_*` in `.deepspeed_env` |
| SLURM (`srun`) | [Several processes, one run](runs.md#several-processes-one-run) | Shared FS | `label="auto"` reads `SLURM_PROCID` |
| SkyPilot | [`skypilot/`](https://github.com/DoeringChristian/cairn/tree/main/examples/skypilot) | HTTP | `label="auto"` reads `SKYPILOT_NODE_RANK`; a managed spot job resumes its run after a recovery |
| Modal | [`modal_app.py`](https://github.com/DoeringChristian/cairn/blob/main/examples/modal_app.py) | HTTP (a Modal Secret holds `CAIRN_REPO`/`CAIRN_TOKEN`) | one run per function call |
| SageMaker | [`sagemaker_job.py`](https://github.com/DoeringChristian/cairn/blob/main/examples/sagemaker_job.py) | HTTP (the estimator's `environment=`) | the host's index in `SM_HOSTS`: `label=f"rank{rank}"`, `primary=(rank == 0)` |
| Azure ML | [`azureml_job.yml`](https://github.com/DoeringChristian/cairn/blob/main/examples/azureml_job.yml) | HTTP (`environment_variables`) | `distribution: pytorch` sets `RANK`; runs `torchrun_ddp.py` |
| A later job | [`cluster_eval_attach.py`](https://github.com/DoeringChristian/cairn/blob/main/examples/cluster_eval_attach.py) | Shared FS or HTTP | `cairn.attach(run_id, label="eval")` on the finished run; its status stays |

On clouds (SkyPilot, Modal, SageMaker, Azure ML) the nodes share no POSIX
filesystem with the repo, so they log over HTTP to a server they can reach.
Object-store bucket mounts (gcsfuse, s3fs, SkyPilot's `MOUNT` mode) cannot
hold a local repo: its run logs are appended and synced line by line and its
lease needs an atomic file create. Keep checkpoints and datasets there.

### Server mode and connection loss

```python
run = cairn.Run(project="mnist", repo="cairn://192.168.1.42:4300")
```

When a run starts, the SDK checks `http://host:port/api/health` and logs a
warning if the server does not answer. Every write is first appended to a local
log (by default in the user cache directory, `…/cairn/wal/`; set
`CAIRN_WAL_DIR` to move it, e.g. to node-local scratch). Each write is sent
once. If the server times out, is unreachable or answers with a 5xx error, the
SDK stops sending for a while (1 second at first, doubling up to 30), keeps
appending to the log, and then replays the backlog in order. Training never
waits on a slow or unreachable server: metrics go out in batches of at most
5000 points, and a backlog beyond 100,000 points waits in the log on disk,
not in memory.

`run.finish()` sends what is left, riding out a short outage, and is bounded
by `timeout` (the `Run` argument, 10 seconds by default). It sends buffered
metrics for up to `timeout` seconds, then the backlog and the final status
for up to `timeout` more. Whatever is still unsent then stays in the log, and
a warning says so. A write the server
rejects for good (a 4xx error other than 401, 403, 408, 425 or 429) is not
retried. It is moved to `<run_id>.dead.jsonl` next to the log, so the writes
behind it still go through, and it is kept there.

Replay what a run could not send (and list rejected writes) later:

```bash
cairn sync     # replays every pending run log to the server it was meant for
```

A log that names no server goes to the one you pass
(`cairn sync --server URL`). For a local repo, `cairn sync --repo PATH`
also ingests its pending run logs (see
[Local repos](#local-repos-run-logs-and-the-ingest-lease)) when no server is
serving the repo to do it.

## `cairn ui` and `cairn server`

There are two server commands:

| | `cairn ui` | `cairn server` |
|---|---|---|
| Serves | The web UI and the full HTTP API | The HTTP API; add `--ui` for the web UI on a second port |
| Default address | `127.0.0.1:4301` (this machine only) | `0.0.0.0:4300` (all interfaces); UI on `--ui-port`, default port + 1 |
| Opens a browser | Yes (`--no-open-browser` to skip) | No (`--open-browser` to open one) |
| Remote repo | `--repo cairn://host:port` runs a [local proxy](#using-the-ui-from-another-machine) | — |
| Needs `cairn-track[ui]` | Yes | Only with `--ui` |

Both default to `--repo ./.cairn` and create the repo if it is missing. If a
port is taken, they try the next one up (up to 20 ports) and print the one they
bound. The UI port also serves the full API, including ingest, so SDK clients
can log to either port.

```bash
cairn ui                                  # browse ./.cairn on http://localhost:4301
cairn server                              # accept runs from the network on :4300
cairn server --ui                         # ...and serve the UI on :4301
cairn server --repo /data/.cairn --port 5000 --ui --ui-port 8080
```

Both hold the repo's ingest lease while they run, so one repo has one
server: a second `cairn ui` or `cairn server` on it refuses to start and
names the one that runs (open that one's URL instead).

While running, the server:

- ingests the runs' logs every 2 seconds, and marks a local run `crashed`
  when its log has had no new record for 5 minutes;
- marks a run logged over HTTP as `killed` when it has sent no heartbeat
  for 120 seconds (the SDK sends one every 10 seconds);
- raises an alert for each, and delivers alerts to the webhook, if one is set;
- collects unreferenced blobs in the background after runs are deleted
  (see [Garbage collection](#garbage-collection)).

The runs table reads each metric's count, min, max, mean and first/last
value from a per-metric index that ingest keeps up to date, so a page of runs
costs the same however long their histories are. A repo written by a cairn
version without that index gets it built once, the first time it is opened
(about a second per million points); the log line
`built the metric_stats index ...` reports the time.

Pass `--verbose` to see uvicorn's info and access logs. By default only
warnings are shown, so the startup banner with the URLs and token stays
visible.

### Alerts

`run.alert(title, text, level)` and runs that end `failed` or `killed` create
alerts, which the UI shows. To also push them somewhere, start the server with
a webhook:

```bash
cairn server --alert-webhook https://ntfy.sh/my-training-alerts
# or: export CAIRN_ALERT_WEBHOOK=...
```

| URL | Payload |
|---|---|
| host contains `ntfy.` | Text body, with `Title` and `Priority` headers |
| Slack incoming webhook | `{"text": ...}` |
| Discord webhook | `{"content": ...}` |
| anything else | The alert as JSON |

Alerts written while no server was running are delivered at the next start.
`cairn ui` accepts `--alert-webhook` for local repos only.

## Authentication

Authentication is on by default for both `cairn ui` and `cairn server`. Every
`/api/*` request needs a token, except `/api/health` and the login endpoints
under `/api/auth/`.

### The startup token

On every start, the server prints a reusable access token and, when it serves
the UI, a one-time login link:

```text
  Auth is ON. Reusable local access token:
    -QSOdOIAGj0yBaqE0GKlHar3Ppp9bBh_fT9tW2E7900

  SDK/CLI:  cairn login http://localhost:4301  (paste the token), or CAIRN_TOKEN=<token>
  Browser (one-time login link, single-use, expires in 15 min):
    http://localhost:4301/login?otp=uir5ljIt6K1iz0qX2uFMKcncAozK9xOT
```

- The token is stored in `.cairn/auth/local.token` (file mode 0600) and reused
  across restarts. It has the `write` role. SDK runs on the same machine, under
  the same user, pick it up on their own (see the tip above).
- The login link works once and expires after 15 minutes. You can also open the
  UI and paste a token into the login form.
- The browser keeps its credential in an HttpOnly `cairn_token_<server id>`
  cookie. Logging in through a link mints a separate per-browser token derived
  from the original (named `<token name>-browser-<hex>`).

### Several servers on one host

Browsers keep cookies per host, not per port, so every server names its
cookies after its *server id*: 8 random hex characters created in
`.cairn/auth/server_id` on first start. The id belongs to the repo, so it
survives restarts and port changes, and every server process on the same repo
shares one login. One browser can be logged into any number of servers on the
same host, on different ports or behind one reverse proxy under different
paths. Logging out of one leaves the others logged in. `GET /api/health`
reports the id as `server_id`.

The SDK and CLI keep one token per server too; see [Logging in from the SDK
and CLI](#logging-in-from-the-sdk-and-cli).

### Tokens and roles

| Role | Can |
|---|---|
| `read` | Read everything: runs, metrics, artifacts, reports |
| `write` | Also log runs, edit runs, reports and workspaces, import and export archives, manage sweeps |
| `admin` | Also edit and delete other people's report comments |

Manage tokens on the machine that hosts the repo. The commands open the
database directly; there is no remote token API.

```bash
cairn token create --name laptop                        # role write, never expires
cairn token create --name dashboard --role read --expires 30d
cairn token list                                        # name, role, status, parent, created, expires
cairn token revoke laptop                               # by name or id
```

Add `--repo PATH` when the repo is not `./.cairn`. A new token's plaintext is
printed once; only its hash is stored. `--expires` takes `30d`, `12h`, `90m`,
`60s` or an ISO 8601 timestamp. Revoking a token also revokes every per-browser
token derived from it.

Give the token to SDK and CLI clients with `cairn login` (below) or the
`CAIRN_TOKEN` environment variable.

### Logging in from the SDK and CLI

`cairn login URL` saves a token for the server at `URL`; every SDK and CLI
call to that server then sends it. Each server keeps its own token, so you can
be logged into several at once:

```bash
cairn login cairn://tracking-host:4300          # prompts for the token
cairn login http://localhost:4301 --token ...   # or pass it
cairn login --list                              # saved logins, and who each is
cairn logout cairn://tracking-host:4300         # forget one server's token
```

`URL` defaults to the configured server. `cairn://host:port`,
`http://host:port/` and `host:port` name the same server (see
[the config file](../reference/configuration.md#the-config-file)). `cairn login`
checks the token against the server before saving it. The first login also
sets the default `server` when none is configured. `cairn logout` only
deletes the local copy; the token stays valid until `cairn token revoke`.

`CAIRN_TOKEN`, when set, is sent to every server and overrides the saved
tokens.

### Logging in with an SSH key

If you have SSH keys, `cairn login --ssh` gets a token without copying secrets:

1. On the server host, add the public key to `.cairn/auth/authorized_keys`, in
   the usual `authorized_keys` format. Put `role=read`, `role=write` or
   `role=admin` in the comment; the default is `write`. Options before the key
   type (`command=…`, `no-pty`) are not supported.

    ```text
    ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA... alice@laptop role=write
    ```

2. On the client:

    ```bash
    cairn login --ssh cairn://tracking-host:4300
    ```

The client signs a one-time challenge with `ssh-keygen -Y sign`, so both
machines need the OpenSSH `ssh-keygen` tool. By default it uses the first of
`~/.ssh/id_ed25519.pub`, `id_ecdsa.pub` and `id_rsa.pub`; pass `--key` to choose
one and `--name` to name the new token. The token is saved to your config file
for that server.

### Turning authentication off

`--no-auth` disables authentication. Use it only on a machine you alone can
reach, or for debugging. With `--no-auth`, the API also accepts cross-origin
requests from any site.

### Share links

A report can be shared with people who have no token, through a link that
grants read access to that one report. See [Sharing](../ui/sharing.md).

## Using the UI from another machine

You can open a server's UI port directly (`http://tracking-host:4301`). To keep
the data on the server but run the UI from your own machine, start a local
proxy:

```bash
# authenticate server-side with the token `cairn login` saved for it:
cairn login cairn://tracking-host:4300
cairn ui --repo cairn://tracking-host:4300

# or with CAIRN_TOKEN:
CAIRN_TOKEN=... cairn ui --repo cairn://tracking-host:4300
```

Then open `http://localhost:4301`. The page is served from your machine, and
`/api/*` requests, artifact downloads and uploads are streamed to the remote
server. With a token (`CAIRN_TOKEN`, else the server's saved login), the
proxy adds it to every request, so the browser needs no login and never sees
the token. Without one, you log in through the browser; the proxy relays only
the remote server's own cookies, never the cookies of other servers on
`localhost`. Proxies to different servers can run side by side on different
ports. The proxy must bind to
loopback (the default `--host 127.0.0.1`), and `--no-auth` is not accepted
for it.

## Finding servers on the LAN

```bash
pip install 'cairn-track[discovery]'
cairn server --advertise
```

`--advertise` announces the ingest port over mDNS/zeroconf as
`_cairn._tcp.local.`. Without the extra, the flag is ignored with a warning.
The SDK does not look for servers on its own. To find them from Python:

```python
from cairn.sdk.discovery import discover_servers

discover_servers(timeout=3.0)   # [(host, port), ...]
```

!!! warning
    `--advertise` together with `--no-auth` announces an unauthenticated server
    to everyone on the network. cairn prints a warning when you combine them.

## HTTPS and secure contexts

The UI does not need HTTPS: it renders everything, including images and 3D
views, over plain HTTP on a LAN address. The only exception is the
copy-to-clipboard buttons (run ids, share links), which browsers allow only on
`https://` or `localhost` pages. The local proxy above gives you a `localhost`
page for a remote server.

cairn does not terminate TLS, and its login cookies are not marked `Secure`.
For access over the internet, put cairn behind a reverse proxy that terminates
TLS.

## Running behind a reverse proxy

- **Serve cairn at the root of a host name** (`https://cairn.example.com/`).
  The UI requests absolute paths such as `/api/...`, so a sub-path such as
  `/cairn/` does not work.
- **Proxy the UI port** (`cairn ui`, or the `--ui-port` of `cairn server`). It
  serves the UI and the full API, so SDK clients can use the same address.
- **Pass the `Authorization` header and cookies through unchanged**, and allow
  request bodies as large as your artifacts (run archives and media are
  uploaded in single requests).
- Bind cairn to loopback (`--host 127.0.0.1`) so only the proxy can reach it.

A minimal nginx site, as a starting point:

```nginx
server {
    listen 443 ssl;
    server_name cairn.example.com;
    # ssl_certificate ...; ssl_certificate_key ...;

    client_max_body_size 0;          # no upload limit
    location / {
        proxy_pass http://127.0.0.1:4301;
        proxy_set_header Host $host;
        proxy_buffering off;         # stream large downloads
    }
}
```

Clients then log with `repo="https://cairn.example.com"`. An `https://` URL is
always treated as a server.

## Backups

A repo is one directory:

| Path | Holds |
|---|---|
| `cairn.db` (+ `cairn.db-wal`, `cairn.db-shm`) | The SQLite database: runs, metrics, config, reports, tokens |
| `artifacts/` | Artifact bytes, stored by content hash |
| `sources/`, `logs/` | Source snapshots and captured output, per run |
| `wals/` | Logs of local runs not fully ingested yet (a finished run's log is deleted once ingested) |
| `auth/` | `local.token` and `authorized_keys` |
| `cache/` | Artifacts a `cairn.Reader` downloaded from a server; safe to delete |
| `version`, `ingest.lease`, `servers.json` | Layout version, the [ingest lease](#local-repos-run-logs-and-the-ingest-lease) and running viewers |

The database runs in SQLite's WAL journal mode, so copying `cairn.db` while
something writes to it can give you an inconsistent copy. Either:

- stop `cairn server`/`cairn ui` and any running jobs, then copy the whole
  directory; or
- keep them running, take a consistent copy of the database with the `sqlite3`
  command-line tool (`sqlite3 .cairn/cairn.db ".backup backup/cairn.db"`), and
  copy the other directories next to it.

To back up or move individual runs, export them as [run
archives](import-export.md#run-archives).

## Garbage collection

Images, files and artifact entries are stored once per content hash and
shared, so deleting a run, a report or an artifact version never deletes
their bytes on the spot. `cairn gc` does:

```bash
cairn gc --dry-run      # what would be freed
cairn gc                # delete it
cairn gc --server cairn://host:4300
```

It runs as the repo's ingest-lease holder (on the server serving the repo,
or in the command itself). It deletes a blob only when nothing names it — no
run's series, artifact version or entry, report image, source snapshot diff,
nor a run log record not ingested yet, also not through a gallery, table,
figure or artifact manifest that is itself kept — and its file is older than
24 hours, so blobs a running job just stored are never touched. It prints
the number of blobs and bytes freed. A server also runs it in the background
after runs are deleted.

## Client commands

Every command that reads or changes data works on a local repo as well as on
a server, and finds its target the way `cairn.Run` does: `--repo PATH|URL` or
`--server URL`, then `CAIRN_REPO`/`CAIRN_SERVER`, then the config file, then
`./.cairn` (see [Configuration](../reference/configuration.md#resolution-order)).
A local repo needs no server: the command takes the repo's ingest lease,
catches up on pending run logs and runs the server's own code over it
in-process. When a `cairn server` or `cairn ui` is serving that repo (it
holds the lease), the command goes through that server instead.

```bash
cairn list                                   # ./.cairn, or whatever is configured
cairn list --repo /shared/nfs/.cairn         # a local repo, no server needed
cairn list --server cairn://gpubox:4300      # a server
```

| Command | Does |
|---|---|
| `cairn ping` | A server: its `/api/health` response. A local repo: its path, layout and schema versions, its project, run, series, point, artifact and report counts, its size, run logs not fully ingested yet, and the server serving it |
| `cairn list` | Lists runs, newest first (see below); also reads a `.zip` run archive (`--repo runs.zip`) |
| `cairn open RUN_ID [--no-browser]` | Prints the run's UI URL and opens it. Against the ingest port of `cairn server --ui` the URL uses the UI port. For a local repo it is the URL of the `cairn ui` serving it; with none running, it prints the URL the run will have and the `cairn ui --repo …` command to start one |
| `cairn rm RUN_ID...` | Deletes runs and their data |
| `cairn archive RUN_ID...`, `cairn unarchive RUN_ID...` | Archives runs (they leave the default run lists but keep their data), or brings them back |
| `cairn export-runs RUN_ID... -o runs.zip`, `cairn import-runs runs.zip` | Moves whole runs between repos as [run archives](import-export.md#run-archives) |
| `cairn export` | Writes metrics to JSON, CSV or Parquet ([Import and export](import-export.md#exporting-metrics)) |
| `cairn artifact ...` | The [artifact registry](artifacts.md#from-the-command-line) |
| `cairn report ...` | [Reports](../ui/reports.md#from-the-command-line) and their share links |
| `cairn sync` | Replays run logs (see [above](#server-mode-and-connection-loss)) |
| `cairn gc [--dry-run]` | Deletes stored blobs nothing references (see [Garbage collection](#garbage-collection)) |
| `cairn configure --server URL` or `--repo PATH` | Saves the default target to the config file (setting one removes the other) |

A failed request prints one line, `Error: <server or repo>: <reason>`, and
exits 1; a 401 says which `cairn login` to run.

### Listing runs

`cairn list` selects runs with the same evaluator as the UI's runs table and
`Reader.runs()`, so a filter or sort means the same in all three:

```bash
cairn list                                             # newest 50 runs, archived ones left out
cairn list --project mnist --status completed --limit 10
cairn list --project mnist -c config.optim.lr -c metrics.val.acc --sort metrics.val.acc
cairn list --filter tags__contains=best --where "config.optim.lr < 0.01"
cairn list --archived all --format json                # or csv
```

| Option | Does |
|---|---|
| `--project`, `--status` | Only runs of that project / with that status |
| `--filter KEY=VALUE` | A [`filter()`](reading.md#filtering-with-filter) keyword; `VALUE` is parsed as JSON when it can be. Repeatable |
| `--where EXPR` | A [`where()`](reading.md#filtering-with-expressions-where) expression. Repeatable |
| `--archived hide\|only\|all` | Leave archived runs out (default), list only them, or both (adds an `ARCHIVED` column) |
| `--sort KEY`, `--asc`/`--desc` | `created_at` (default), `ended_at`, `duration`, `name`, `version`, `status`, `id`, `config.<path>`, `summary.<path>` or `metrics.<name>`; descending by default. Runs missing the key come last |
| `-c KEY` | Add a column: `config.<path>` (nested config), `summary.<path>`, `metrics.<name>` (the final value the runs table shows) or a run field (`group`, `job_type`, `hostname`, `user`, `notes`, `ended_at`, `archived`). Repeatable |
| `--format table\|json\|csv` | `json` and `csv` give ISO 8601 times and durations in seconds |

The default columns are `ID`, `NAME`, `VERSION` (the run's [version](organising-runs.md#versions)),
`PROJECT` (left out with `--project`),
`STATUS`, `CREATED` (local time), `DURATION` and `TAGS`.

See the [CLI reference](../reference/cli.md) for all commands.
