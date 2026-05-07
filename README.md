# Cairn

An open-source ML experiment tracker. Three ways to use it:

**Local mode** (default): log directly to `./.cairn/`. No server required. Run `cairn ui` later to browse results.

**WAL mode** (cluster-safe): `local_wal=True` writes per-run append-only log files instead of touching the database. Safe for NFS/Slurm/Ray with hundreds of concurrent writers. The UI server ingests WAL files in the background.

**Server mode** (cross-device): run `cairn server` on one machine, point SDK clients at it via `repo="cairn://host:port"`.

All modes share the same on-disk format — a repo created locally can later be served without any migration.

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

run = cairn.Run(
    project="image-classification",
    name="baseline-cnn",
    repo="./.cairn",          # or: export CAIRN_REPO=./.cairn
)
run["hparams"] = {"lr": 3e-4, "batch_size": 32}
for step, loss in training_loop():
    run.track(loss, name="loss", step=step)
```

Browse results:

```bash
cairn ui                      # serves http://localhost:4301/
```

## WAL mode — concurrent / distributed training

For Slurm clusters, Ray, Dask, or any setup with multiple concurrent writers on a shared filesystem:

```python
import cairn

run = cairn.Run(
    project="sweep",
    name="lr-search",
    repo="/shared/nfs/.cairn",
    local_wal=True,           # per-run WAL, no SQLite contention
)
```

Each run writes to its own `.cairn/wals/{run_id}.wal.jsonl` file. The UI server's background thread ingests WAL files every 2s for live preview. See `examples/` for integration with ProcessPoolExecutor, submitit, Ray Tune, Dask, Fabric, and Kubernetes.

## Server mode — cross-device logging

On the machine that will hold the data:

```bash
cairn server                  # defaults to ./.cairn; creates it if missing
```

From any training machine, use the `cairn://` URL scheme:

```python
import cairn

run = cairn.Run(
    project="image-classification",
    name="baseline-cnn",
    repo="cairn://192.168.1.42:4300",
)
run["hparams"] = {"lr": 3e-4, "batch_size": 32}
run.track(0.5, name="loss", step=0)
```

Or set it globally:

```python
cairn.configure(repo="cairn://gpu-server:4300")
```

Or via environment variable:

```bash
export CAIRN_REPO=cairn://gpu-server:4300
python train.py
```

## Resolution order

The SDK picks a destination in this order:

1. Explicit `repo=` kwarg
2. `cairn.configure(repo=...)`
3. `CAIRN_REPO` env var
4. TOML config file (`~/.config/cairn/config.toml`)
5. `./.cairn/` in the current working directory

The `repo=` parameter accepts:
- A filesystem path: `/path/to/.cairn` or `./.cairn` → local mode
- A URL: `cairn://host:port` → HTTP server mode

## Run IDs

Run IDs are 128-bit hex strings (32 characters), generated client-side. The UI shows the first 6 characters (git-style short hash) with click-to-copy for the full ID. Existing shorter IDs from earlier versions remain valid.

## Reading data back

```python
import cairn

reader = cairn.Reader(repo="./.cairn")
# or: cairn.Reader(repo="cairn://localhost:4300")

for run in reader.runs(project="sweep").list():
    loss = run.sequence("loss")
    print(f"{run.name}: final_loss={loss.values[-1]:.4f}")
```

## Examples

| Example | Framework | Multi-machine? |
|---------|-----------|---------------|
| `examples/multi_process.py` | ProcessPoolExecutor | No |
| `examples/multi_thread.py` | threading.Thread | No |
| `examples/multiprocessing_pool.py` | multiprocessing.Pool | No |
| `examples/fabric_remote.py` | Fabric/SSH | Yes |
| `examples/submitit_sweep.py` | submitit/Slurm | Yes |
| `examples/ray_tune.py` | Ray Tune | Yes |
| `examples/dask_sweep.py` | Dask SSHCluster | Yes |
| `examples/kubernetes_jobs.py` | Kubernetes Jobs | Yes |

## Development

This project uses [uv](https://docs.astral.sh/uv/) for Python and npm for the UI.

```bash
uv sync --extra dev
cd cairn/ui && npm install && npm run build
uv run pytest
```

For UI development with HMR:

```bash
# terminal 1
uv run cairn server --repo ./.cairn --no-ui

# terminal 2
cd cairn/ui && npm run dev   # http://localhost:5173, proxies /api to :4300
```

## License

Apache 2.0
