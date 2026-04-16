# Cairn

An open-source ML experiment tracker. Two ways to use it:

**Local mode** (Aim-style, single machine): `cairn init` in your project, then log directly to the `.cairn/` directory. No server required; open a viewer later with `cairn server --data-dir ./.cairn`.

**Server mode** (W&B-style, cross-device): run `cairn server` on one machine, point the SDK at its URL from any other machine on the network. Same process serves the UI.

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

Open a viewer on the same repo:

```bash
cairn server --data-dir ./.cairn
# browse http://localhost:4300/
```

The SDK and the server share a single write-lock — the server refuses to start while a `Run` is active, and vice versa. Reads from other processes (e.g. ad-hoc DuckDB queries) are fine.

## Quick start — server mode

On the machine that will hold the data:

```bash
cairn server
```

You'll see a banner with the local and network URLs. From any training machine:

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

Open `http://<lan-ip>:4300/` in any browser to view runs.

## Resolution order

If you don't pass `repo=` or `server=` explicitly, the SDK picks a destination in this order:

1. `cairn.configure(repo=...)` or `cairn.configure(server=...)`
2. `CAIRN_REPO` env var
3. `CAIRN_SERVER` env var
4. TOML config file (`~/.config/cairn/config.toml`)
5. `./.cairn/` in the current working directory (auto-discovery)
6. Fallback: `http://localhost:4300`

## Development

This project uses [uv](https://docs.astral.sh/uv/) for dependency management.

```bash
uv sync --extra dev
uv run pytest
```

## License

Apache 2.0
