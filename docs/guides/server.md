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
`CAIRN_WAL_DIR` to move it, e.g. to node-local scratch). If the server goes
away, writes queue up there and are replayed in order when it comes back or
when the run finishes.

If a process dies before its log is sent, replay it later:

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

  SDK/CLI:  CAIRN_TOKEN=<token above>  (or `cairn configure` + config.toml)
  Browser (one-time login link, single-use, expires in 15 min):
    http://localhost:4301/login?otp=uir5ljIt6K1iz0qX2uFMKcncAozK9xOT
```

- The token is stored in `.cairn/auth/local.token` (file mode 0600) and reused
  across restarts. It has the `write` role. SDK runs on the same machine, under
  the same user, pick it up on their own (see the tip above).
- The login link works once and expires after 15 minutes. You can also open the
  UI and paste a token into the login form.
- The browser keeps its credential in an HttpOnly `cairn_token` cookie. Logging
  in through a link mints a separate per-browser token derived from the
  original (named `<token name>-browser-<hex>`).

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
cairn token list                                        # name, role, status, parent, created
cairn token revoke laptop                               # by name or id
```

Add `--repo PATH` when the repo is not `./.cairn`. A new token's plaintext is
printed once; only its hash is stored. `--expires` takes `30d`, `12h`, `90m`,
`60s` or an ISO 8601 timestamp. Revoking a token also revokes every per-browser
token derived from it.

Give the token to SDK and CLI clients with the `CAIRN_TOKEN` environment
variable or a `token` key in the [config file](../reference/configuration.md).

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
    cairn login --ssh --server cairn://tracking-host:4300
    ```

The client signs a one-time challenge with `ssh-keygen -Y sign`, so both
machines need the OpenSSH `ssh-keygen` tool. By default it uses the first of
`~/.ssh/id_ed25519.pub`, `id_ecdsa.pub` and `id_rsa.pub`; pass `--key` to choose
one and `--name` to name the new token. The server URL and the token are saved
to your config file.

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
# authenticate server-side with a token:
CAIRN_TOKEN=... cairn ui --repo cairn://tracking-host:4300

# or leave CAIRN_TOKEN unset and log in through the browser:
cairn ui --repo cairn://tracking-host:4300
```

Then open `http://localhost:4301`. The page is served from your machine, and
`/api/*` requests, artifact downloads and uploads are streamed to the remote
server. With `CAIRN_TOKEN` set, the proxy adds the token to every request, so
the browser needs no login and never sees the token. The proxy must bind to
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
| `cairn list [--project P] [--status S] [--limit N]` | Lists recent runs |
| `cairn open RUN_ID [--no-browser]` | Prints the run's UI URL and opens it |
| `cairn rm RUN_ID` | Deletes a run |
| `cairn configure [--server URL]` | Saves the server URL to the config file |

See the [CLI reference](../reference/cli.md) for all commands.
