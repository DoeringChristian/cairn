# Configuration

cairn reads its settings from four places. From highest to lowest priority:

1. **Arguments** in your code, such as `cairn.Run(repo=...)` or `cairn.Reader(...)`.
2. **`cairn.configure(...)`**, which sets defaults for the rest of the process.
3. **Environment variables**, such as `CAIRN_REPO`.
4. **The config file**, `config.toml` in your user config directory.

If none of them names a repo, cairn uses `./.cairn` in the current directory.

## `cairn.configure`

```python
import cairn

cairn.configure(repo="cairn://gpu-server:4300")   # where runs are written and read
cairn.configure(mode="disabled")                  # turn every Run into a no-op
```

`configure` stores its keywords for the current process; later calls add to or
replace earlier ones, and `None` values are ignored. `repo` and `server` are
mutually exclusive: setting one clears the other; passing both raises an error.
It reads these keys:

| Key | Meaning |
|---|---|
| `repo` | A local path or a server URL; see [the repo value](#the-repo-value) |
| `server` | A server URL (`cairn://…` or `http(s)://…`). Used when `repo` is not set. |
| `mode` | `"enabled"` (default) or `"disabled"` |

A token cannot be set through `configure`; use a token file, `CAIRN_TOKEN` or
`cairn login URL`. See [The token](#the-token) for precedence.

## Environment variables

| Variable | Used by | Meaning |
|---|---|---|
| `CAIRN_REPO` | SDK, `Reader`, CLI | Where runs are written and read: a path or a server URL |
| `CAIRN_SERVER` | SDK, `Reader`, CLI | A server URL, used when `CAIRN_REPO` is not set |
| `CAIRN_TOKEN` | SDK, `Reader`, CLI, server, UI proxy | The server access token; overrides token files and per-server logins. |
| `CAIRN_TOKEN_FILE` | SDK, `Reader`, CLI, server, UI proxy | Path to a private file containing the server token. Clients require the file to exist; the server creates it when needed. |
| `CAIRN_MODE` | SDK | `enabled` or `disabled` |
| `CAIRN_RUN_ID` | SDK | The ID of the run a `cairn.Run()` creates (or, with `primary=False`, joins) when `run_id=` is not passed: give every process of a distributed job the same one (see [Several processes, one run](../guides/runs.md#several-processes-one-run)). Make one with `cairn.new_run_id()`. |
| `CAIRN_ARTIFACT_DIR` | SDK, `Reader` | Where `ArtifactVersion.download()` and `.file()` write by default: `<dir>/<name>-v<N>/`. Default: `./artifacts`. |
| `CAIRN_DIR` | SDK, `cairn sync` | Remote upload buffer directory (`<dir>/runs/<run_id>/`) and project token directory (`<dir>/token`). Default: `./.cairn`. Local journals always live in the selected repo. See [Run directories](../guides/run-directories.md). |
| `CAIRN_SYNC_INTERVAL_MS` | SDK | How often a run writes and `fsync`s its record log (group commit), in milliseconds. Default: `100`. |
| `CAIRN_FINISH_TIMEOUT` | SDK | Seconds `run.finish()` waits for the server to confirm every record before printing a notice and returning. Default: `30`. |
| `CAIRN_UPLOADER` | SDK | `off` (or `0`, `false`, `no`): runs do not start or use the background uploader; upload their directories with `cairn sync`. Default: `on`. |
| `CAIRN_AGENT_DIR` | SDK, uploader | The uploader daemon's state (lock, pid, log, registered run directories). Default: `$XDG_STATE_HOME/cairn/agent`, i.e. `~/.local/state/cairn/agent`. |
| `CAIRN_AGENT_IDLE_EXIT` | uploader | Seconds the uploader daemon stays up with nothing to upload. Default: `600`. |
| `CAIRN_ALLOW_NETWORK_DB` | `cairn server`, `cairn ui` | `1`: serve a repo on a network filesystem (NFS, SMB, ...) anyway, at your own risk. |
| `CAIRN_CACHE_DIR` | `Reader` | Root of cairn's per-user caches (the Reader's blob cache). Default: `<user cache dir>/cairn`. |
| `CAIRN_UI_DIST` | `cairn ui`, `cairn server --ui` | Serve the web UI from this build directory instead of the installed `cairn-ui` package. It must contain `index.html` and `assets/`; if it doesn't, no UI is served (there is no fallback). |
| `CAIRN_SWEEP_ID`, `CAIRN_TRIAL_ID` | SDK | Identify an existing sweep trial for a run created by an external launcher. The Python `Sweep.run()` API manages trial linkage itself. |
| `CAIRN_DATABASE_URL` | `cairn server`, report workers | Server database URL; default is SQLite in the repo. PostgreSQL is optional. |
| `CAIRN_BLOB_ROOT` | `cairn server`, report workers | Filesystem directory or `s3://bucket/prefix` for server blobs; default is the repo artifact directory. |
| `CAIRN_S3_ENDPOINT_URL` | S3 blob storage | Optional endpoint for an S3-compatible object store. |
| `CAIRN_DATA_DIR` | `cairn.server.app.create_app` | The repo used when `create_app()` is called without one. Default: `~/.cairn`. The CLI always passes its repo, so it does not read this. |

## The config file

The file is `config.toml` in the platform's user config directory:

| Platform | Path |
|---|---|
| Linux | `~/.config/cairn/config.toml` (or under `$XDG_CONFIG_HOME`) |
| macOS | `~/Library/Application Support/cairn/config.toml` |

To print the path on your machine:

```bash
python -c "from cairn.config import config_file_path; print(config_file_path())"
```

It is plain TOML with up to three keys and a `[tokens]` table:

```toml
repo = "cairn://gpu-server:4300"   # or a local-disk path, e.g. "/data/.cairn"
mode = "enabled"

[tokens]                           # one token per server
"http://gpu-server:4300" = "D1uFBMpdjRTxYPO1XBpji_..."
"http://localhost:4301" = "-QSOdOIAGj0yBaqE0GKlHar3..."
```

Edit `repo` (or `server`) and `mode` directly in this file. `cairn login URL`
adds or replaces that server's entry in `[tokens]`, using `--token` or a hidden
prompt. `cairn logout URL` removes the entry. These commands require a URL and
do not change the configured destination.

`[tokens]` keys are server URLs in a normal form, and a token is used for every
spelling of its server: `cairn://` becomes `http://`, `host:port` without a
scheme means `http://`, scheme and host are lowercased, the default port (80
for `http`, 443 for `https`) and trailing slashes are dropped, and `127.0.0.1`
and `[::1]` become `localhost`. A path (a server behind a reverse proxy under a
prefix) is kept. The same host on another port is another server.

cairn creates the file with mode 0600 and its directory with mode 0700,
because it can hold tokens. A missing or malformed file is treated as empty.

## The repo value

Wherever cairn takes a repo (`repo=`, `CAIRN_REPO`, `--repo`, the config file):

| Value | Meaning |
|---|---|
| `cairn://host:port` | A server, reached over plain HTTP (`http://host:port`) |
| `http://…`, `https://…` | A server at that URL |
| anything else | A local directory; `~` is expanded. A `cairn.Reader` also accepts a `.zip` run archive. |

A local path always opens the database and files directly, even when a UI or
server is serving the same repo. It never starts a tracking server. A URL always
uses HTTP. See [Storage architecture](../guides/storage-architecture.md).

## Resolution order

### Where runs are written and read

`cairn.Run`, `cairn.Reader`, `cairn.sweep`, `cairn.log_artifact` and client
commands such as `runs`, `show`, `artifact` and `report` resolve their target
in this order. The first one that is set wins:

1. the explicit `repo=` argument (or `--repo`, or `--server`)
2. `cairn.configure(repo=...)`
3. `cairn.configure(server=...)`
4. `CAIRN_REPO`
5. `CAIRN_SERVER`
6. `repo` in the config file
7. `server` in the config file
8. `./.cairn` in the current directory

`cairn init` explicitly creates a local repo; `cairn.Run` also creates one on
first use. `cairn server --repo` selects the local repository to serve and
defaults to `./.cairn`, independently of client destination settings.

### The token

Every request carries the token for the server it goes to:

1. an explicit `token=` argument (for example `cairn.query_url(..., token=...)`)
2. `CAIRN_TOKEN` (for every server)
3. the file named by `CAIRN_TOKEN_FILE`
4. `token` in `CAIRN_DIR`, when set; otherwise `.cairn/token` in the nearest
   parent directory containing `.cairn` (a nested repo does not inherit a parent token)
5. that server's entry in the config file's `[tokens]` table
6. `$XDG_CONFIG_HOME/cairn/token`, or `~/.config/cairn/token`

With none of them set, requests carry no token, which works against a server
started with `--no-auth`. Local database access does not use a token.
See [Server and authentication](../guides/server.md).

### The mode

1. `cairn.Run(mode=...)`
2. `cairn.configure(mode=...)`
3. `CAIRN_MODE`
4. `mode` in the config file
5. `"enabled"`

`"disabled"` makes `cairn.Run(...)` return a run whose every method does
nothing: nothing is written, no server is contacted and no thread is started.
Any other value raises `ValueError`.

## Per-run settings

Settings that apply to one run, such as source capture, system metrics
and stop behaviour, are keyword arguments of `cairn.Run`. See
[Run lifecycle](../guides/runs.md) and the [Python API
reference](python.md#run-and-scope).
