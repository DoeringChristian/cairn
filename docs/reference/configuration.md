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
replace earlier ones, and `None` values are ignored. It reads these keys:

| Key | Meaning |
|---|---|
| `repo` | A local path or a server URL; see [the repo value](#the-repo-value) |
| `server` | A server URL (`cairn://…` or `http(s)://…`). Used when `repo` is not set. |
| `mode` | `"enabled"` (default) or `"disabled"` |

A token cannot be set through `configure`; use `CAIRN_TOKEN` or `cairn login`.

## Environment variables

| Variable | Used by | Meaning |
|---|---|---|
| `CAIRN_REPO` | SDK, `Reader`, CLI | Where runs are written and read: a path or a server URL |
| `CAIRN_SERVER` | SDK, `Reader`, CLI | A server URL, used when `CAIRN_REPO` is not set |
| `CAIRN_TOKEN` | SDK, `Reader`, CLI, `cairn ui` proxy | The bearer token sent to every server; overrides the per-server tokens `cairn login` saves |
| `CAIRN_MODE` | SDK | `enabled` or `disabled` |
| `CAIRN_ARTIFACT_DIR` | SDK, `Reader` | Where `ArtifactVersion.download()` and `.file()` write by default: `<dir>/<name>-v<N>/`. Default: `./artifacts`. |
| `CAIRN_WAL_DIR` | SDK | Where server-mode runs keep their local write-ahead log. Default: `<CAIRN_CACHE_DIR>/wal`, i.e. `<user cache dir>/cairn/wal` (e.g. `~/.cache/cairn/wal` on Linux, `~/Library/Caches/cairn/wal` on macOS). Point it at node-local scratch on a cluster. |
| `CAIRN_CACHE_DIR` | SDK | Root of cairn's per-user caches: server-mode runs' local logs (`wal/`, unless `CAIRN_WAL_DIR` is set), unsent data (`pending/`) and the Reader's blob cache (`reader/`). Default: `<user cache dir>/cairn`. |
| `CAIRN_ALERT_WEBHOOK` | `cairn server`, `cairn ui` | Same as `--alert-webhook`: the URL alerts are posted to |
| `CAIRN_UI_DIST` | `cairn ui`, `cairn server --ui` | Serve the web UI from this build directory instead of the installed `cairn-ui` package. It must contain `index.html` and `assets/`; if it doesn't, no UI is served (there is no fallback). |
| `CAIRN_SWEEP_ID`, `CAIRN_TRIAL_ID` | SDK | Set by `cairn agent` for each trial's command. A `cairn.Run()` that sees them joins that sweep trial (see [Sweeps](../guides/sweeps.md)). You don't set these yourself. |
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
repo = "cairn://gpu-server:4300"   # or a path, e.g. "/shared/nfs/.cairn"
server = "http://gpu-server:4300"
mode = "enabled"

[tokens]                           # one token per server
"http://gpu-server:4300" = "D1uFBMpdjRTxYPO1XBpji_..."
"http://localhost:4301" = "-QSOdOIAGj0yBaqE0GKlHar3..."
```

Commands that write it:

- `cairn configure --server URL` sets `server`, and `cairn configure --repo
  PATH` sets `repo`; each removes the other key (it prompts for a server when
  you give neither).
- `cairn login [URL]` (with `--token`, `--ssh` or a prompt) adds the server's
  entry to `[tokens]`, and sets `server` if neither `server` nor `repo` is set
  yet. `cairn logout [URL]` removes the entry.

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

A local directory that a running `cairn server` or `cairn ui` holds is reached
through that server; see [Server, auth and
deployment](../guides/server.md#where-runs-are-written).

## Resolution order

### Where runs are written and read

`cairn.Run`, `cairn.Reader`, `cairn.sweep`, `cairn.log_artifact` and every
CLI command that reads or changes data (`list`, `ping`, `open`, `rm`,
`archive`, `export`, `export-runs`, `import-runs`, `sync`, `diff`,
`import-tb`, `artifact …`, `report …`, `sweep …`, `agent`) pick their target
in this order. The first one that is set wins:

1. the explicit `repo=` argument (or `--repo`, or `--server`)
2. `cairn.configure(repo=...)`
3. `cairn.configure(server=...)`
4. `CAIRN_REPO`
5. `CAIRN_SERVER`
6. `repo` in the config file
7. `server` in the config file
8. `./.cairn` in the current directory

A local target must be an existing repo for the CLI (`cairn init` creates
one); `cairn.Run` creates it on first use.

`cairn login` and `cairn logout` without a URL use the configured server:
`CAIRN_SERVER`, a server URL in `CAIRN_REPO`, `server` (or a server URL in
`repo`) in the config file, else `http://localhost:4300`.

### The token

Every request carries the token for the server it goes to:

1. an explicit `token=` argument (for example `cairn.query_url(..., token=...)`)
2. `CAIRN_TOKEN` (for every server)
3. that server's entry in the config file's `[tokens]` table

With none of them set, requests carry no token, which works against a server
started with `--no-auth`. On the same machine as a server, a run that logs to
that server's repo path uses `.cairn/auth/local.token` instead (see
[Server, auth and deployment](../guides/server.md#the-startup-token)).

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
