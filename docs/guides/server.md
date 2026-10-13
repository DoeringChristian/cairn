# Server, auth and deployment

cairn stores everything in one repo directory, `.cairn/`, and one server
process at a time owns it. On your own machine that server starts by itself
in the background; run one explicitly so that other machines can log runs
and browse them. This page covers the server commands, the ways a run reaches
the repo, authentication, and running cairn for a team.

## Where runs are written

A run never writes the repo itself. It writes its own run directory,
`./.cairn/runs/<run_id>/` (`CAIRN_DIR`), and a background uploader sends it
to a server over HTTP. The server is the only process that writes the
repo's database and blob store. See
[Run directories, syncing and backup](run-directories.md) for the details.

| Target | How you select it | Which server receives the run | Use it for |
|---|---|---|---|
| Local repo | `repo="./.cairn"` (or any path), or nothing: `./.cairn` is the default | The repo's own server on this machine, started in the background when none runs | One machine |
| Server | `repo="cairn://host:4300"` | That server | Logging from other machines and clusters |

Both store the same repo format, so a repo written locally can be served to
the network later without migration. How `repo` is resolved when you don't
pass it (`cairn.configure`, `CAIRN_REPO`, the config file) is described in
[Configuration](../reference/configuration.md).

### Local repos

```python
run = cairn.Run(project="mnist", repo="./.cairn")
```

A `cairn.Run` (through its uploader), `cairn.Reader`, CLI command or
`cairn ui` on a local repo uses the server registered in `<repo>/server.json`
when one is running. Otherwise `cairn ui` serves the repo itself, and the
others start a server in the background (`cairn server --repo <repo>
--daemon`: loopback only, a free port, exits after 30 minutes without
requests). You don't start anything yourself.

The server keeps its database on a local disk: it refuses a repo on a
network filesystem (NFS, SMB, sshfs, Lustre, GPFS, ...), where SQLite's
locking and `fsync` are not reliable (`CAIRN_ALLOW_NETWORK_DB=1` overrides
this at your own risk). Machines that share no local disk with the repo log
to its server over HTTP.

### Clusters / SLURM

Run a server on a machine the compute nodes can reach and whose disk holds
the repo, e.g. the login node, and point every job at it:

```bash
cairn server --repo /local/disk/.cairn --ui     # on the login node
```

```python
run = cairn.Run(project="sweep", repo="cairn://login-node:4300")
```

- Each job writes its own run directory (under its working directory, or
  `CAIRN_DIR`, e.g. node-local scratch); nothing is locked while training,
  and `track()` never waits on the network.
- The uploader on each node sends the run directories to the server, and
  keeps doing so if a job is killed.
- Sweeps: every `cairn agent` claims trials from the server.
- If the nodes cannot reach a server, log with `CAIRN_UPLOADER=off` and
  upload later with `cairn sync --server URL` (see
  [Working without a server](run-directories.md#working-without-a-server)).
- For one run across many processes (every rank of a distributed job), give
  them all the same `CAIRN_RUN_ID` and use `label="auto"`: rank 0 creates
  the run, the other ranks join it and write logs of their own. See
  [Several processes, one run](runs.md#several-processes-one-run).

### Distributed runners

Recipes for common launchers, in the repository's
[`examples/`](https://github.com/DoeringChristian/cairn/tree/main/examples)
(see [Examples](../examples.md#distributed-runners)). Each logs every process
of a job into one run: the processes share a run id (`CAIRN_RUN_ID`, or one
broadcast by rank 0), and each gets a label from its rank. **Local repo**
means `CAIRN_REPO` is a path, which works for the processes of one machine;
**HTTP** means `CAIRN_REPO=cairn://host:4300` plus `CAIRN_TOKEN`, which is
what a job across several nodes needs (a repo on a filesystem every node
mounts, such as NFS or Lustre, cannot be served). The column says what the
example sets up.

| Runner | Recipe | Mode | How ranks map to cairn |
|---|---|---|---|
| torchrun | [`torchrun_ddp.py`](https://github.com/DoeringChristian/cairn/blob/main/examples/torchrun_ddp.py) | Local repo or HTTP | `label="auto"` reads `RANK`; the id from `CAIRN_RUN_ID` |
| torchrun, no launch variable | [`torchrun_attach.py`](https://github.com/DoeringChristian/cairn/blob/main/examples/torchrun_attach.py) | Local repo or HTTP | rank 0 creates the run and broadcasts `run.id`; the others `cairn.attach(run_id, label=f"rank{rank}")` |
| Accelerate | [`accelerate_ddp.py`](https://github.com/DoeringChristian/cairn/blob/main/examples/accelerate_ddp.py) | Local repo or HTTP | `label="auto"` reads `RANK` (set by `accelerate launch`) |
| DeepSpeed | [`deepspeed_ddp.py`](https://github.com/DoeringChristian/cairn/blob/main/examples/deepspeed_ddp.py) | Local repo or HTTP | `label="auto"` reads `RANK` (set by `deepspeed`); multi-node: `CAIRN_*` in `.deepspeed_env` |
| SLURM (`srun`) | [Several processes, one run](runs.md#several-processes-one-run) | HTTP | `label="auto"` reads `SLURM_PROCID` |
| SkyPilot | [`skypilot/`](https://github.com/DoeringChristian/cairn/tree/main/examples/skypilot) | HTTP | `label="auto"` reads `SKYPILOT_NODE_RANK`; a managed spot job resumes its run after a recovery |
| Modal | [`modal_app.py`](https://github.com/DoeringChristian/cairn/blob/main/examples/modal_app.py) | HTTP (a Modal Secret holds `CAIRN_REPO`/`CAIRN_TOKEN`) | one run per function call |
| SageMaker | [`sagemaker_job.py`](https://github.com/DoeringChristian/cairn/blob/main/examples/sagemaker_job.py) | HTTP (the estimator's `environment=`) | the host's index in `SM_HOSTS`: `label=f"rank{rank}"`, `primary=(rank == 0)` |
| Azure ML | [`azureml_job.yml`](https://github.com/DoeringChristian/cairn/blob/main/examples/azureml_job.yml) | HTTP (`environment_variables`) | `distribution: pytorch` sets `RANK`; runs `torchrun_ddp.py` |
| A later job | [`cluster_eval_attach.py`](https://github.com/DoeringChristian/cairn/blob/main/examples/cluster_eval_attach.py) | Local repo or HTTP | `cairn.attach(run_id, label="eval")` on the finished run; its status stays |

On clouds (SkyPilot, Modal, SageMaker, Azure ML) the nodes share no POSIX
filesystem with the repo, so they log over HTTP to a server they can reach.
Object-store bucket mounts (gcsfuse, s3fs, SkyPilot's `MOUNT` mode) cannot
hold a repo, since its server needs a local disk. Keep checkpoints and
datasets there.

### Server mode and connection loss

```python
run = cairn.Run(project="mnist", repo="cairn://192.168.1.42:4300")
```

A run on a server logs to its run directory like any other run, and the
uploader sends it. When the server is slow, unreachable or restarting,
training goes on: the uploader backs off (1 second at first, doubling up to
60, or what the server's `Retry-After` says) and retries as long as the run
directory exists. Every record is applied exactly once, however often it is
sent.

`run.finish()` waits up to `CAIRN_FINISH_TIMEOUT` seconds (default 30) for
the server to confirm everything, then prints a notice if records are still
pending; the uploader keeps sending them in the background. To upload in the
foreground (or to another server), use `cairn sync`:

```bash
cairn sync                   # every run directory in ./.cairn (CAIRN_DIR)
cairn sync --server URL      # upload them to this server instead
cairn sync --clean           # then delete the finished, fully confirmed ones
```

See [Run directories, syncing and backup](run-directories.md).

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

One repo has one server: the one serving it holds `<repo>/server.lock` and
registers its URL in `<repo>/server.json`. A second `cairn server` on the
repo refuses to start and names the one that runs. `cairn ui` on a repo that
is already served (by a `cairn server`, another `cairn ui`, or the
background server a Reader, CLI command or run started) opens that server's
viewer and returns.

While running, the server:

- applies uploaded run records as they arrive (a record is visible once the
  server has confirmed it);
- marks a run `crashed` when its primary's log has had no record applied for
  5 minutes (the SDK records a heartbeat every 10 seconds);
- raises an alert for it, and delivers alerts to the webhook, if one is set;
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

### Batched reads

The UI reads many runs at once (a workspace over a thousand runs) through
two read-only POST routes, instead of a request per run:

- `POST /api/runs/batch` with `{"ids": [...], "include": ["run",
  "sequences", "outputs"]}` (at most 1000 ids; `include` defaults to all
  three) returns `{"runs": {id: {"run": ..., "sequences": [...],
  "outputs": [...]}}, "missing": [...], "forbidden": [...]}`. Each part is
  exactly what `GET /api/runs/{id}`, `GET /api/runs/{id}/sequences` and
  `GET /api/runs/{id}/outputs?include=files` return for that run.
- `POST /api/runs/series` with `{"runs": {id: [name, ...]}}` (at most 200
  names per run and 5000 in all) returns `{"runs": {id: ...}, "missing":
  [...], "forbidden": [...]}`, each run's entry exactly what `GET
  /api/runs/{id}/series?name=...` returns.

`missing` lists ids of no run. Both need the read role; a share link may
call them too, and gets only its report's runs: any other id is listed in
`forbidden` and not read, as the per-run routes answer it 403.

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
| `runs/` | [Run directories](run-directories.md#the-run-directory) of runs whose `CAIRN_DIR` is this directory (the default `./.cairn` is both); the uploader's input, not part of the repo's data |
| `backups/`, `quarantine/` | Database backups (`cairn backup`, and the automatic one before an upgrade) and corrupt blobs moved aside by `cairn fsck --repair` |
| `wals/` | Only in a repo upgraded from 0.5: its run logs, renamed `*.imported` once imported |
| `auth/` | `local.token` and `authorized_keys` |
| `cache/` | Artifacts a `cairn.Reader` downloaded from a server; safe to delete |
| `version`, `server.json`, `server.lock`, `server.log`, `servers.json` | Layout version, the server serving the repo (its URL, lock and the background server's output) and running viewers |

Copying `cairn.db` while the server writes it can give you an inconsistent
copy. Use `cairn backup` instead: the server writes a consistent copy of the
database to `<repo>/backups/` while it keeps running (`--to PATH` also
downloads it). The blobs in `artifacts/` never change once written, so copy
them with any file tool. `cairn fsck` checks a repo's database against its
blobs. See [Backups](run-directories.md#backups) and
[`cairn fsck`](run-directories.md#checking-a-repo-cairn-fsck).

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

It runs on the server serving the repo. It deletes a blob only when nothing
names it — no run's series, artifact version or entry, report image, source
snapshot diff, nor a 0.5 run log not imported yet, also not through a gallery, table,
figure or artifact manifest that is itself kept — and its file is older than
24 hours, so blobs a running job just stored are never touched. It prints
the number of blobs and bytes freed. A server also runs it in the background
after runs are deleted.

## Client commands

Every command that reads or changes data works on a local repo as well as on
a server, and finds its target the way `cairn.Run` does: `--repo PATH|URL` or
`--server URL`, then `CAIRN_REPO`/`CAIRN_SERVER`, then the config file, then
`./.cairn` (see [Configuration](../reference/configuration.md#resolution-order)).
On a local repo the command talks to the server serving it, and starts one in
the background when none runs (see [Local repos](#local-repos)).

```bash
cairn list                                   # ./.cairn, or whatever is configured
cairn list --repo ~/exp/.cairn               # a local repo (its server starts if needed)
cairn list --server cairn://gpubox:4300      # a server
```

| Command | Does |
|---|---|
| `cairn ping` | A server: its `/api/health` response. A local repo: its path, layout and schema versions, its project, run, series, point, artifact and report counts, its size, 0.5 run logs not imported yet, and the server serving it (started if none is) |
| `cairn list` | Lists runs, newest first (see below); also reads a `.zip` run archive (`--repo runs.zip`) |
| `cairn open RUN_ID [--no-browser]` | Prints the run's UI URL and opens it. Against the ingest port of `cairn server --ui` the URL uses the UI port. For a local repo it is the URL of the `cairn ui` serving it; with none running, it prints the URL the run will have and the `cairn ui --repo …` command to start one |
| `cairn rm RUN_ID...` | Deletes runs and their data |
| `cairn archive RUN_ID...`, `cairn unarchive RUN_ID...` | Archives runs (they leave the default run lists but keep their data), or brings them back |
| `cairn export-runs RUN_ID... -o runs.zip`, `cairn import-runs runs.zip` | Moves whole runs between repos as [run archives](import-export.md#run-archives) |
| `cairn export` | Writes metrics to JSON, CSV or Parquet ([Import and export](import-export.md#exporting-metrics)) |
| `cairn artifact ...` | The [artifact registry](artifacts.md#from-the-command-line) |
| `cairn report ...` | [Reports](../ui/reports.md#from-the-command-line) and their share links |
| `cairn sync [PATHS] [--server URL] [--clean]` | Uploads run directories in the foreground, and deletes the confirmed ones with `--clean` (see [Run directories](run-directories.md#working-without-a-server)) |
| `cairn backup [--to PATH]` | Makes a consistent copy of the database in `<repo>/backups/` (see [Backups](run-directories.md#backups)) |
| `cairn fsck [--repair]` | Checks the database, the blobs and this machine's run directories (see [`cairn fsck`](run-directories.md#checking-a-repo-cairn-fsck)) |
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
