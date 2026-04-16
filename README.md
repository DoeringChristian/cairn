# Cairn

An open-source ML experiment tracker with a client/server architecture designed for easy cross-device use on a local network.

One machine on your network runs `cairn server` (typically a workstation, home server, or shared GPU box). Training scripts on any machine — laptop, training box, cluster node — point the SDK at that server's address and log to it over HTTP. A browser on any device on the network opens the UI served by the same process.

## Install

```bash
pip install cairn-track
```

Optional extras:

- `cairn-track[media]` — matplotlib, plotly, imageio, soundfile for richer media handlers
- `cairn-track[hf]` — HuggingFace Trainer integration
- `cairn-track[discovery]` — zeroconf/mDNS server discovery on the LAN

## Quick start

On the machine that will hold the data:

```bash
cairn server
```

You'll see a banner with the local and network URLs. On any training machine:

```python
import cairn

run = cairn.Run(
    project="image-classification",
    task="baseline-cnn",
    server="http://<lan-ip>:4300",
)
run["hparams"] = {"lr": 3e-4, "batch_size": 32}
run.track(0.5, name="loss", step=0)
run.finish()
```

Open `http://<lan-ip>:4300/` in any browser to view runs.

## Development

This project uses [uv](https://docs.astral.sh/uv/) for dependency management.

```bash
uv sync --extra dev
uv run pytest
```

## License

Apache 2.0
