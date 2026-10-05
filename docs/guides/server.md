# Server, auth and deployment

cairn stores everything in one repo directory, `.cairn/`. You can write to it
directly, or run a server in front of it so that other machines can log runs
and browse them. This page covers the server commands, the ways a run reaches
the repo, authentication, and running cairn for a team.

## Where runs are written

| Mode | How you select it | What happens | Use it for |
|---|---|---|---|
| Local | `repo="./.cairn"` (or any path), or nothing: `./.cairn` is the default | The SDK writes to the repo's SQLite database directly | One machine |
| WAL | a local path plus `cairn.Run(..., local_wal=True)` | Each run appends to its own log file in `.cairn/wals/`; a server or reader ingests it later | Many concurrent writers on a shared filesystem (NFS, Slurm, Ray) |
| Server | `repo="cairn://host:4300"` | The SDK sends everything over HTTP to a `cairn server` | Logging from other machines |

All three share one on-disk format, so a repo written locally can be served
later without migration. How `repo` is resolved when you don't pass it
(`cairn.configure`, `CAIRN_REPO`, the config file) is described in
[Configuration](../reference/configuration.md).

!!! tip "Logging while the viewer is open"
    If a `cairn server` or `cairn ui` is serving a local repo, a
    `cairn.Run(repo=<that path>)` on the same machine notices and sends its
    data to that server over HTTP instead of opening the database. It
    authenticates with the token the server leaves in `.cairn/auth/local.token`.
    You don't need to change anything.

### WAL mode

```python
run = cairn.Run(project="sweep", repo="/shared/nfs/.cairn", local_wal=True)
```

With `local_wal=True`, the run never touches SQLite. It writes
`.cairn/wals/<run_id>.wal.jsonl`, so hundreds of processes can log to one repo
on a shared filesystem without contending for the database. The logs are
ingested into the database:

- every 2 seconds by a running `cairn server` or `cairn ui` on that repo
  (which gives you a live view while jobs run), and
- whenever a `cairn.Reader` opens the repo.

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

`cairn server` needs the repo to itself: it refuses to start while another
`cairn server` or a `cairn ui` is running on it. `cairn ui` refuses to start on
a repo that a `cairn server` holds (open that server's UI URL instead), but
several `cairn ui` processes can share a repo.

While running, the server:

- ingests WAL files every 2 seconds;
- marks a `running` run as `killed` when it has sent no heartbeat for 120
  seconds (the SDK sends one every 10 seconds), and raises an alert for it;
- delivers alerts to the webhook, if one is set.

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
| `wals/` | WAL-mode run logs not yet ingested |
| `auth/` | `local.token` and `authorized_keys` |
| `cache/` | Artifacts a `cairn.Reader` downloaded from a server; safe to delete |
| `version`, `repo.lock`, `servers.json` | Layout version and bookkeeping for running processes |

The database runs in SQLite's WAL journal mode, so copying `cairn.db` while
something writes to it can give you an inconsistent copy. Either:

- stop `cairn server`/`cairn ui` and any running jobs, then copy the whole
  directory; or
- keep them running, take a consistent copy of the database with the `sqlite3`
  command-line tool (`sqlite3 .cairn/cairn.db ".backup backup/cairn.db"`), and
  copy the other directories next to it.

To back up or move individual runs, export them as [run
archives](import-export.md#run-archives).

## Other client commands

These commands talk to a server over HTTP. They use `cairn configure --server`,
`CAIRN_SERVER`, a `cairn://` value of `CAIRN_REPO` or the config file, and fall
back to `http://localhost:4300`:

| Command | Does |
|---|---|
| `cairn ping` | Prints the server's `/api/health` response |
| `cairn list` | Lists runs, newest first (see below) |
| `cairn open RUN_ID [--no-browser]` | Prints the run's UI URL and opens it; against the ingest port of `cairn server --ui` the URL uses the UI port |
| `cairn rm RUN_ID` | Deletes a run and its data |
| `cairn configure [--server URL]` | Saves the server URL to the config file |

A failed request prints one line, `Error: <server>: <reason>`, and exits 1; a
401 says which `cairn login` to run.

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
| `--sort KEY`, `--asc`/`--desc` | `created_at` (default), `ended_at`, `duration`, `name`, `status`, `id`, `config.<path>`, `summary.<path>` or `metrics.<name>`; descending by default. Runs missing the key come last |
| `-c KEY` | Add a column: `config.<path>` (nested config), `summary.<path>`, `metrics.<name>` (the final value the runs table shows) or a run field (`group`, `job_type`, `hostname`, `user`, `notes`, `ended_at`, `archived`). Repeatable |
| `--format table\|json\|csv` | `json` and `csv` give ISO 8601 times and durations in seconds |

The default columns are `ID`, `NAME`, `PROJECT` (left out with `--project`),
`STATUS`, `CREATED` (local time), `DURATION` and `TAGS`.

See the [CLI reference](../reference/cli.md) for all commands.
