# Cairn

An open-source ML experiment tracker. Two ways to use it:

**Local mode** (Aim-style, single machine): `cairn init` in your project, then log directly to `./.cairn/`. No server required. Run `cairn ui` later to browse results.

**Server mode** (W&B-style, cross-device): run `cairn server` on one machine and it starts both the tracking API **and** the viewer on two ports. Other machines on the network point the SDK at the tracking server's URL.

Both modes share the same on-disk format — a repo created locally can later be served without any migration.

## Install

```bash
pip install cairn-track
```

Optional extras:

- `cairn-track[media]` — matplotlib, plotly, imageio, soundfile for richer media handlers
- `cairn-track[hf]` — HuggingFace Trainer integration
- `cairn-track[discovery]` — zeroconf/mDNS server discovery on the LAN

## Quick start — local mode

```bash
cairn init                    # creates ./.cairn/
```

```python
import cairn

with cairn.Run(
    project="image-classification",
    task="baseline-cnn",
    repo="./.cairn",          # or: export CAIRN_REPO=./.cairn
) as run:
    run["hparams"] = {"lr": 3e-4, "batch_size": 32}
    for step, loss in training_loop():
        run.track(loss, name="loss", step=step)
```

When you're ready to browse results, start the UI:

```bash
cairn ui                      # reads ./.cairn/ and opens http://localhost:4301/
```

If you're logging live and also want the UI open simultaneously, use `cairn server` instead (see below) — it runs the tracking API and the UI together.

## Quick start — server mode

On the machine that will hold the data (typically a workstation or shared GPU box):

```bash
cairn server                  # defaults to ./.cairn; creates it if missing
```

You'll see a banner with both URLs:

```
Cairn tracking server:
  Ingest API local:   http://localhost:4300
  Ingest API network: http://192.168.1.42:4300
  UI local:           http://localhost:4301
  UI network:         http://192.168.1.42:4301
Repo: /home/you/project/.cairn
```

From any training machine:

```python
import cairn

with cairn.Run(
    project="image-classification",
    task="baseline-cnn",
    server="http://<lan-ip>:4300",
) as run:
    run["hparams"] = {"lr": 3e-4, "batch_size": 32}
    run.track(0.5, name="loss", step=0)
```

Open the UI URL in any browser on the network.

### Why two ports?

`cairn server` runs the **ingest API** (where clients POST metrics) and the **UI viewer** (what browsers load) on separate ports, in the same process. This lets you, e.g., expose only the UI port publicly while keeping the ingest port firewalled, or serve the UI from a different path. Both ports also expose the full `/api/*` surface — the UI talks to its own port.

Flags:

- `cairn server --port 4300 --ui-port 4301 --repo ./.cairn` — all defaults shown explicitly.
- `cairn server --no-ui` — skip spawning the UI.
- `cairn server --open-browser` — auto-open a browser tab (off by default).
- `cairn server --host 127.0.0.1` — LAN-restrict.
- `cairn server --advertise` — broadcast on mDNS (requires `cairn-track[discovery]`).

### `cairn server` vs `cairn ui`

| | `cairn server` | `cairn ui` |
|---|---|---|
| Starts tracking API? | ✅ (port 4300) | ❌ |
| Starts UI server? | ✅ (port 4301) | ✅ (port 4301) |
| Acquires repo write-lock? | ✅ (mode `server`) | ✅ (mode `ui`) |
| Use when | you want to log from other machines, or log + view simultaneously | you only want to browse an existing `./.cairn/` repo |

They can't run on the same repo simultaneously (single-writer DuckDB rule). If a tracking server is already running, just open its UI URL in a browser.

## Resolution order

If you don't pass `repo=` or `server=` explicitly, the SDK picks a destination in this order:

1. `cairn.configure(repo=...)` or `cairn.configure(server=...)`
2. `CAIRN_REPO` env var
3. `CAIRN_SERVER` env var
4. TOML config file (`~/.config/cairn/config.toml`)
5. `./.cairn/` in the current working directory (auto-discovery)
6. Fallback: `http://localhost:4300`

## Development

This project uses [uv](https://docs.astral.sh/uv/) for Python and npm for the UI.

```bash
uv sync --extra dev
cd ui-src && npm install && npm run build   # build the React bundle once
uv run pytest
```

For UI development, run Vite's dev server with HMR against a local tracking server:

```bash
# terminal 1
uv run cairn server --repo ./.cairn --no-ui

# terminal 2
cd ui-src && npm run dev   # http://localhost:5173, proxies /api to :4300
```

The wheel's build hook (`hatch_build.py`) automatically invokes `npm run build` when you run `uv build`, so published wheels ship with the UI prebuilt — end users don't need Node.

## License

Apache 2.0
