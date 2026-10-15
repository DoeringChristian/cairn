# Getting started

This page walks you through installing cairn, logging a first run and opening it in the UI. It
then covers where runs go (a local repo or a server), how cairn picks a destination,
and how to turn tracking off.

## Install

cairn is distributed as the `cairn-track` package and installed from its git repository. It
needs Python 3.10 or newer.

```bash
pip install "cairn-track[ui] @ git+https://github.com/DoeringChristian/cairn-track"
```

The base package (without `[ui]`) holds the tracker, the reader, the CLI and the HTTP API. It
contains no browser assets and needs no Node, which is what you want on a compute node that only
logs. The browser viewer comes with the `ui` extra, and `cairn ui` and `cairn server --ui` tell
you when it is missing.

Optional extras:

| Extra | Adds | Needed for |
|---|---|---|
| `ui` | the browser viewer (cairn-ui) | `cairn ui`, `cairn server --ui`, `cairn.ui` notebook embeds |
| `media` | matplotlib, plotly, kaleido, imageio, imageio-ffmpeg, soundfile | figures, video encoding, better audio and figure rasterizing |
| `export` | pandas, pyarrow | `cairn export` to Parquet/CSV, `Run.history()` DataFrames |
| `tb` | tensorboard | `cairn import-tb` |
| `lightning` | lightning | `cairn.integrations.lightning` |
| `keras` | keras (not a backend: add tensorflow, jax or torch) | `cairn.integrations.keras` |
| `xgboost` | xgboost | `cairn.integrations.xgboost` |
| `hf` | transformers, datasets | `cairn.integrations.huggingface` |
| `sweep` | optuna | Bayesian sweeps (`method: bayes`); grid and random need nothing |
| `discovery` | zeroconf | `cairn server --advertise` (mDNS on the LAN) |

Combine extras as usual: `"cairn-track[ui,media,export] @ git+…"`.

## Log your first run

Create a repo in your project directory. This step is optional, because a run creates
`./.cairn/` on first use, but it makes the location explicit:

```bash
cairn init            # creates ./.cairn/
```

Then log a run:

```python
import math
import cairn

run = cairn.Run("quickstart", name="first-run")
run.config(lr=1e-3, epochs=10)

for step in range(100):
    loss = math.exp(-step / 30)
    run.track(loss, "train.loss", step, summary="min")
    run.track(step // 10, "epoch", step)

run.summary(final_loss=loss)
run.finish()
```

- `cairn.Run(project, ...)` starts a run. The project is created on first use.
- `run.config(...)` records inputs such as hyperparameters.
- `run.track(value, name, step)` records one point of a series. `step` is required.
- `run.finish()` marks the run completed. If you forget it, cairn finishes the run when the
  process exits. An unhandled exception marks it `failed`, and Ctrl+C marks it `killed`. You can
  also use the run as a context manager (`with cairn.Run(...) as run:`).

[Logging metrics](guides/logging.md) covers all of this in detail.

## Open the UI

```bash
cairn ui
```

`cairn ui` serves the viewer for `./.cairn` on `http://localhost:4301` and opens a browser tab.
Pass `--repo PATH` for another repo, `--port` for another port, or `--no-open-browser` to skip the
tab.

Authentication is on by default. On startup `cairn ui` prints a reusable access token (kept in
`<repo>/auth/local.token`) and a one-time login link. When it opens the browser for you, it uses
that link, so you are already logged in. For throwaway local work you can pass `--no-auth`.

If a server already serves the repo (for example the one your run started in the background),
`cairn ui` opens its viewer instead of starting another. Runs, `cairn.Reader` and CLI commands on
that repo use the same server and authenticate with `auth/local.token`, so you don't have to
configure anything.

## Local repo and server

Wherever a run's data ends up, the run itself only writes its own run directory,
`./.cairn/runs/<run_id>/` (set `CAIRN_DIR` to move it). A background uploader sends that
directory to a server, which is the only process that writes the repo's database. Logging never
waits on the network, and a run that cannot reach its server keeps its directory until it can.
See [Run directories, syncing and backup](guides/run-directories.md).

### Local repo (default)

```python
run = cairn.Run("my-project")                     # ./.cairn
run = cairn.Run("my-project", repo="~/exp/.cairn")
```

With a local repo, the receiving server is the repo's own, on this machine. If none is running,
the uploader (or a `cairn.Reader` or a CLI command) starts one in the background; it listens on
loopback only and exits after 30 minutes without requests. `cairn ui` with no server running
serves the repo itself, in the foreground.

`log_artifact` returns right away; the version number is assigned when the server applies the
record, and `.wait()` blocks until it has.

The repo must be on a local disk: the server refuses one on a network filesystem such as NFS. To
log from several machines, use a server.

### Server mode: log across machines

Start a tracking server on the machine that holds the data:

```bash
cairn server              # ingest API on 0.0.0.0:4300, repo ./.cairn
cairn server --ui         # also serve the UI on port 4301
```

Then point runs on other machines at it with a `cairn://` URL:

```python
run = cairn.Run("my-project", repo="cairn://192.168.1.42:4300")
```

The server prints a reusable access token on startup. Save it on a client with
`cairn login cairn://192.168.1.42:4300` (one token per server, so you can be logged into several),
or set the `CAIRN_TOKEN` environment variable. See [Server, auth and
deployment](guides/server.md) for tokens, roles, `cairn login --ssh` and running behind other
hosts.

If the server is unreachable, the run goes on and the uploader keeps retrying in the background,
also after the training process has exited. `cairn sync` uploads run directories in the
foreground, and `cairn sync --server URL` sends them to a server of your choice.

### Viewing a remote server locally

To use the UI in your local browser while the data stays on a remote server, run a local UI
proxy:

```bash
cairn ui --repo cairn://192.168.1.42:4300   # saved login or CAIRN_TOKEN used server-side;
                                            # without one, log in from the browser
```

Then open `http://localhost:4301`. The page is served from loopback, and API calls, artifacts and
range requests go through the proxy to the remote server. The proxy only binds to loopback, and
the token is never placed in a URL.

## How cairn picks a destination

`cairn.Run`, `cairn.Reader` and `cairn.log_artifact` resolve the destination in this order:

1. The `repo=` argument.
2. `cairn.configure(repo=...)` (or `cairn.configure(server=...)`).
3. The `CAIRN_REPO` environment variable (then `CAIRN_SERVER`).
4. The `repo` key (then `server`) in the config file.
5. `./.cairn` in the current working directory.

A value starting with `cairn://` or `http(s)://` names a server. Anything else is a filesystem
path and names a local repo.

The config file is `config.toml` in your user config directory: `~/.config/cairn/` on Linux,
`~/Library/Application Support/cairn/` on macOS. `cairn configure --server URL` writes it. See
[Configuration](reference/configuration.md) for every key and environment variable.

```python
cairn.configure(repo="cairn://gpu-server:4300")   # every run in this process goes there
```

## Turning tracking off

`mode="disabled"` turns every `Run` method into a no-op. Nothing is written, no server is
contacted and no threads start. The returned object is still a `cairn.Run`, so your code runs
unchanged:

```python
run = cairn.Run("my-project", mode="disabled")
run.track(0.1, "loss", 0)   # does nothing
```

You can also set it with `cairn.configure(mode="disabled")`, the `CAIRN_MODE=disabled`
environment variable, or `mode = "disabled"` in the config file (in that priority order). The
default is `"enabled"`.

## Next steps

- [Logging metrics](guides/logging.md): steps, names, configs, summaries and tags.
- [Media and rich types](guides/media.md): images, audio, tables, 3D.
- [Run lifecycle](guides/runs.md): resume, fork, stop and alerts.
- [Web UI](ui/index.md): the runs table, workspaces and reports.
