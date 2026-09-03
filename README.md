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
cairn ui                      # serves and opens http://localhost:4301/
cairn ui --no-open-browser    # serve without opening a browser tab
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
cairn server                  # ingest API only; defaults to ./.cairn
cairn server --ui             # optionally add the paired UI on port 4301
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

To render with the browser and GPU on your workstation while the data stays on
that server, run a local same-origin UI proxy:

```bash
# Uses CAIRN_TOKEN server-side when configured:
CAIRN_TOKEN=... cairn ui --repo cairn://192.168.1.42:4300

# Or omit CAIRN_TOKEN and paste the remote token into the local browser login:
cairn ui --repo cairn://192.168.1.42:4300
```

Open `http://localhost:4301`. The JavaScript is served from loopback (a browser
secure context), while `/api/*`, artifacts, uploads, and range requests stream
through to the remote server. The token is never placed in a URL or browser
configuration.

Or set the training destination globally:

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

## Live query URLs

A **live query URL** is a stable server URL that always resolves to "the
`<tag>` artifact of the latest (optionally filtered) run". It lets a
[cairn-plot](https://github.com/doeringchristian/cairn-plot) report show the
freshest data *every time it opens* — the HTML never changes, only what the URL
resolves to does.

```python
import cairn
import cairn.plot as cp

# "the train/render image of the most recent run in project 'demo'"
url = cairn.query_url("train/render", project="demo", server="cairn://localhost:4300")

# Embed it in a report — the browser fetches it fresh on every open.
cp.Report(title="live dashboard").add(cp.Image(url=url)).save("dashboard.html")
```

Under the hood `GET /api/query?run=latest&project=demo&tag=train/render`
**302-redirects** to the immutable, content-addressed
`/api/artifacts/{digest}` endpoint. The query response is `Cache-Control:
no-store` (re-resolved on every open); the digest it points at is cached
forever.

Selector grammar (query params):

| Param | Meaning |
|-------|---------|
| `run` | `latest` (default) · `latest:N` (N-th newest) · `id:<run_id>` (pin) · `newest-per-name` |
| `project` | restrict to a project id |
| `name` | display-name glob (`exp*`) or case-insensitive substring |
| `status` | exact run status (`completed`, …) |
| `<param>__<op>` | run-param / metric predicate — `lr__gt=1e-4`, `metrics.loss__lt=0.1`, `tags__contains=best` (ops: `gt`/`lt`/`gte`/`lte`/`in`/`contains`/`startswith`/…) |
| `tag` | **required** — the artifact / sequence name to resolve |
| `step` | `latest` (default, highest step) or an explicit `<N>` |
| `at` | ISO-8601 pin — "latest run created ≤ this instant" |
| `format` | `raw` (default → 302) or `json` (`{run_id, digest, step, mime_type, size, url}`) |

`cairn.query_url(..., live=False)` resolves once now and returns the baked
immutable digest URL (fully pinned). `reader.runs("demo").filter(lr__gt=1e-4).latest_url("render")`
and `run["render"].url` are equivalent sugar. Query URLs need a **server** when
fetched; offline reports keep using baked, self-contained HTML.
See `examples/report_query_url.py`.

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

### Notebook / marimo

`examples/marimo_cairn_demo.py` shows cairn's read API and `cairn.plot`
helpers rendered inline in a [marimo](https://marimo.io) notebook. marimo
and plotly are optional dependencies, installed via the `examples` +
`media` extras:

```bash
uv run --extra examples --extra media marimo edit examples/marimo_cairn_demo.py
```

## Development

This project uses [uv](https://docs.astral.sh/uv/) for Python and npm for the UI.

The [cairn-plot](https://github.com/doeringchristian/cairn-plot) rendering
library is vendored as a git submodule at `vendor/cairn-plot` (both the Python
package, via a uv path source, and the TS renderer source the app build bundles
come from there). Clone with submodules:

```bash
git clone --recurse-submodules https://github.com/anthropics/cairn
# already cloned? pull the submodule in:
git submodule update --init --recursive
```

```bash
uv sync --extra dev
cd cairn/ui && npm install && npm run build
uv run pytest
```

For UI development with HMR:

```bash
# terminal 1
uv run cairn server --repo ./.cairn

# terminal 2
cd cairn/ui && npm run dev   # http://localhost:5173, proxies /api to :4300
```

## License

Apache 2.0
