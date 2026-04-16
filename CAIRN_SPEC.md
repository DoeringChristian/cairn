# Cairn — Implementation Specification

## Project overview

Cairn is an open-source ML experiment tracker with a client/server architecture designed for easy cross-device use on a local network. The name evokes a stack of stones marking a trail — each run is a cairn marking progress through the experimental landscape. The design goal is Aim-level ergonomic simplicity (one command to start the server, two lines of code to log from any client) with richer built-in capture (CLI output, source tree) and a clearer organizational hierarchy (Project > Task > Run).

The canonical deployment model: one machine on a user's network runs `cairn server` (typically a workstation, home server, or shared GPU box). Training scripts on any machine — laptop, training box, cluster node — point the SDK at that server's address and log to it over HTTP. A browser on any device on the network opens the UI served by the same process.

The implementation target is a v1 that a single user or small team can install with `pip install cairn-track`, run `cairn server` on one machine, and immediately start logging from others. No cloud account, no auth setup, no database provisioning — the server manages its own DuckDB and artifact store on the disk where it runs.

## Non-goals for v1

These are explicitly out of scope. Do not build them. If you find yourself tempted, stop and revisit this list.

- Authentication, authorization, RBAC — v1 assumes a trusted local network
- Public-internet deployment, TLS termination, reverse-proxy hardening
- Horizontal scaling — one server process, one disk
- Model registry
- Hyperparameter optimization / sweep orchestration
- Real-time WebSocket streaming (polling every 2s is fine)
- Cloud artifact storage (S3/GCS) — server's local disk only
- Multi-tenancy — one shared namespace per server
- Custom query language (we use SQL via DuckDB directly)
- Offline-first SDK with background sync (see "Future: offline mode" below; v1 requires server reachable during runs)

## Architecture summary

Cairn is a client/server system. All state lives on the server; clients are thin.

**Server** — A single Python process (`cairn server`) that:
- Manages the `.cairn/` storage directory (DuckDB + artifact blobs + source archives + log files).
- Exposes an HTTP API for SDK clients to log runs, params, metrics, and artifacts.
- Serves the React UI at the same HTTP endpoint.

**SDK (client)** — The Python library users import in their training scripts. It:
- Connects to a Cairn server via HTTP.
- Buffers `run.track()` calls in memory and flushes to the server in batches.
- Captures stdout/stderr, source tree, git metadata, and environment info, then ships them to the server.

**UI (client)** — A React SPA served by the server. Any device on the network opens `http://<server-host>:<port>/` in a browser.

### Why not local-first with sync?

An earlier design had the SDK write to a local `.cairn/` directory that a server could later read. That model has two problems for the cross-device use case: (1) a run written on laptop A isn't visible from laptop B without explicit sync, and (2) the UI can only show runs from its own disk. A single authoritative server eliminates both. The trade-off is that the server must be reachable during the run. For v1, that constraint is acceptable — the target user has machines on the same network as the server. An offline-buffering mode can be added later (see "Future: offline mode").

### Server-side storage layout

The server owns one storage directory. Default location is `~/.cairn/` on the server machine; configurable via `--data-dir` flag or `CAIRN_DATA_DIR` env var. Layout:

```
~/.cairn/
  cairn.db                    # DuckDB database (all structured data)
  artifacts/                  # Content-addressable blob store
    ab/
      abcd1234...ef/          # sha256 hash, first 2 chars as prefix dir
        blob                  # raw bytes
        meta.json             # mime_type, size, original filename
  sources/                    # Captured source trees per run
    <run_id>/
      tree.tar.zst            # compressed snapshot
      manifest.json           # file list + hashes
  logs/                       # Captured stdout/stderr per run
    <run_id>/
      stdout.log
      stderr.log
      combined.log            # interleaved with timestamps
  server.pid                  # PID file for running server instance
  version                     # Schema version marker
```

No file lock is needed for cross-process DB access because only the server writes to DuckDB. SDK clients never touch the disk — they always go through HTTP.

### Database schema (DuckDB)

Use DuckDB for everything structured. Create tables on first use via migrations.

```sql
CREATE TABLE projects (
    id            VARCHAR PRIMARY KEY,    -- slug, user-supplied
    name          VARCHAR NOT NULL,       -- display name
    created_at    TIMESTAMP NOT NULL,
    description   VARCHAR,
    tags          JSON                    -- array of strings
);

CREATE TABLE tasks (
    id            VARCHAR PRIMARY KEY,    -- project_id + '/' + task_slug
    project_id    VARCHAR NOT NULL REFERENCES projects(id),
    name          VARCHAR NOT NULL,
    created_at    TIMESTAMP NOT NULL,
    description   VARCHAR,
    tags          JSON
);

CREATE TABLE runs (
    id            VARCHAR PRIMARY KEY,    -- 12-char hex hash, globally unique
    project_id    VARCHAR NOT NULL REFERENCES projects(id),
    task_id       VARCHAR NOT NULL REFERENCES tasks(id),
    display_name  VARCHAR,                 -- optional human name
    created_at    TIMESTAMP NOT NULL,
    ended_at      TIMESTAMP,
    status        VARCHAR NOT NULL,       -- 'running' | 'completed' | 'failed' | 'killed'
    exit_code     INTEGER,
    git_sha       VARCHAR,                -- captured if in git repo
    git_dirty     BOOLEAN,
    git_branch    VARCHAR,
    cli_args      JSON,                   -- sys.argv captured
    env_snapshot  JSON,                   -- python version, platform, pip freeze hash
    hostname      VARCHAR,
    user          VARCHAR,
    tags          JSON,
    notes         VARCHAR
);

CREATE TABLE params (
    run_id        VARCHAR NOT NULL REFERENCES runs(id),
    key           VARCHAR NOT NULL,       -- dotted path, e.g. "model.layers"
    value         JSON NOT NULL,          -- any JSON-serializable value
    value_type    VARCHAR NOT NULL,       -- 'int'|'float'|'str'|'bool'|'list'|'dict'|'null'
    PRIMARY KEY (run_id, key)
);

CREATE TABLE sequences (
    run_id        VARCHAR NOT NULL REFERENCES runs(id),
    name          VARCHAR NOT NULL,       -- metric name, e.g. "loss"
    step          BIGINT NOT NULL,
    wall_time     TIMESTAMP NOT NULL,
    context       JSON,                   -- e.g. {"subset": "train"} — nullable
    object_type   VARCHAR NOT NULL,       -- 'scalar'|'image'|'audio'|'video'|'figure'|'histogram'|'text'|'tensor'
    scalar_value  DOUBLE,                 -- set if object_type='scalar'
    artifact_hash VARCHAR,                -- set if non-scalar; points to artifacts table
    PRIMARY KEY (run_id, name, step, context)
);

CREATE TABLE artifacts (
    hash          VARCHAR PRIMARY KEY,    -- sha256 of content
    mime_type     VARCHAR NOT NULL,
    size_bytes    BIGINT NOT NULL,
    metadata      JSON,                   -- type-specific: dims, sample_rate, etc.
    created_at    TIMESTAMP NOT NULL
);

CREATE TABLE run_artifacts (
    run_id        VARCHAR NOT NULL REFERENCES runs(id),
    name          VARCHAR NOT NULL,       -- user-supplied label
    hash          VARCHAR NOT NULL REFERENCES artifacts(hash),
    step          BIGINT,                 -- nullable, for non-sequence artifacts
    created_at    TIMESTAMP NOT NULL,
    PRIMARY KEY (run_id, name, step)
);

CREATE TABLE log_lines (
    run_id        VARCHAR NOT NULL REFERENCES runs(id),
    stream        VARCHAR NOT NULL,       -- 'stdout' | 'stderr'
    wall_time     TIMESTAMP NOT NULL,
    line_no       BIGINT NOT NULL,
    content       VARCHAR NOT NULL
);

CREATE INDEX idx_sequences_run_name ON sequences(run_id, name);
CREATE INDEX idx_sequences_step ON sequences(step);
CREATE INDEX idx_log_lines_run ON log_lines(run_id, line_no);
```

Design notes:
- `context` on `sequences` is the Aim trick — lets you log `loss` with `{"subset": "train"}` and `{"subset": "val"}` as separate series without namespace pollution.
- `scalar_value` is denormalized into the sequences table for speed. Non-scalars go through `artifact_hash`.
- `log_lines` stores CLI output row-per-line so the UI can paginate and search. The `combined.log` file on disk is the canonical source; this table is a queryable index.
- Run IDs are 12-char hex (48 bits of hash space) — short enough for URLs, long enough for no practical collisions at single-user scale.

## Hierarchy: Project > Task > Run

This is W&B-inspired but strict. Every run belongs to exactly one task; every task belongs to exactly one project.

### Rules

- **Project**: A long-lived research effort. User-supplied string, slugified (lowercase, `-`-separated). Example: `"image-classification"`, `"llm-finetuning"`.
- **Task**: A specific experimental configuration or objective within a project. Example: within `image-classification`, tasks might be `baseline-cnn`, `vit-variants`, `augmentation-ablation`.
- **Run**: A single execution. Auto-indexed by a 12-char hex hash. Display name is optional and user-supplied.

### SDK API

The SDK is a thin HTTP client. It needs to know which server to talk to. Resolution order:

1. Explicit `server=` kwarg to `Run()`.
2. `CAIRN_SERVER` environment variable.
3. A config file at `~/.config/cairn/config.toml` (or platform-equivalent via `platformdirs`) with a `server = "http://..."` key.
4. Default: `http://localhost:4300`.

```python
import cairn

# Minimal: reads CAIRN_SERVER env var or falls back to localhost
run = cairn.Run(
    project="image-classification",    # required
    task="baseline-cnn",               # required
    name="lr-3e-4-seed-42",            # optional display name
    tags=["baseline"],                 # optional
    notes="Testing new augmentation",  # optional
    server="http://gpubox.local:4300", # optional; see resolution above
    capture_source=True,               # default True
    capture_stdout=True,               # default True
    capture_env=True,                  # default True
    timeout=10.0,                      # HTTP timeout in seconds
)

run["hparams"] = {"lr": 3e-4, "batch_size": 32}  # flat or nested dict
run.track(0.5, name="loss", step=0)
run.track(0.6, name="loss", step=0, context={"subset": "val"})
run.track(pil_image, name="predictions", step=100)
run.finish()  # or use context manager: with cairn.Run(...) as run:
```

If `project` or `task` doesn't exist on the server, the server creates it on first `Run` POST. The SDK does not need to pre-create anything.

For convenience, also provide a module-level default that lets users configure once per script:

```python
cairn.configure(server="http://gpubox.local:4300")
# Subsequent Run() calls pick this up.
```

### Server discovery (quality-of-life)

To make the "just works" experience real, support optional zeroconf/mDNS advertising. When `cairn server` starts, it broadcasts `_cairn._tcp.local.` on the LAN. The SDK, when no server is configured, can discover servers via the same protocol. Use the `zeroconf` package; gate this behind a config flag since some networks block multicast.

If multiple servers are discovered, the SDK errors with a list and asks the user to pick one explicitly. Don't auto-select.

This is a nice-to-have for v1 — implement it last. Explicit `server=` or env var should always be the documented primary path.

## Tracking rich media — extensibility model

The core extensibility pattern is a **type registry**. Each registered handler knows how to serialize, deserialize, and preview one kind of object.

### Handler protocol

```python
class TypeHandler(Protocol):
    object_type: str           # e.g. "image", "audio"
    mime_type: str             # e.g. "image/png"

    def can_handle(self, obj: Any) -> bool: ...
    def serialize(self, obj: Any) -> tuple[bytes, dict]:
        """Returns (blob_bytes, metadata_dict)."""
    def deserialize(self, blob: bytes, metadata: dict) -> Any: ...
    def preview(self, obj: Any) -> dict:
        """Small dict for UI list views — thumbnail data URI, summary string, etc."""
```

### Built-in handlers (ship with v1)

| object_type | Input types | Storage | Preview |
|---|---|---|---|
| `scalar` | `int`, `float`, `bool` | inline in DB | value itself |
| `text` | `str` (when tracked as sequence) | inline or blob if >1KB | truncated |
| `image` | `PIL.Image`, `np.ndarray` (HWC/HW), `torch.Tensor` | PNG blob | 128px thumbnail as data URI |
| `audio` | `np.ndarray` + sample_rate kwarg, `torch.Tensor` | WAV or FLAC blob | duration + waveform peaks array |
| `video` | `np.ndarray` (TxHxWxC), path to video file | MP4 blob (use imageio-ffmpeg) | first frame thumbnail + duration |
| `figure` | `matplotlib.Figure`, Plotly `Figure` | dual: PNG + source (pickle for mpl, JSON for plotly) | PNG thumbnail |
| `histogram` | `np.ndarray` (1D) | Parquet file of bins/counts | 64-bucket summary |
| `tensor` | `np.ndarray`, `torch.Tensor` (small, <10MB) | `.npy` blob | shape + dtype + min/max/mean |

### Registration for user extensions

```python
from cairn import register_handler

@register_handler
class PointCloudHandler:
    object_type = "point_cloud"
    mime_type = "application/octet-stream"
    # ... implement protocol
```

Handlers are tried in LIFO registration order; first `can_handle` wins. Built-ins register at import time with a default priority; user handlers registered later take precedence.

### Explicit type wrappers (Aim-style)

Automatic type detection is convenient but ambiguous for polymorphic inputs. A matplotlib `Figure` could reasonably be tracked as either an `image` (flat PNG) or a `figure` (preserving interactivity via Plotly conversion). The user should be able to make this choice explicit at the call site.

Cairn exposes a set of wrapper classes in the top-level `cairn` namespace. Each wrapper forces a specific handler and may transform the underlying object:

```python
import cairn
import matplotlib.pyplot as plt

fig, ax = plt.subplots()
ax.plot([1, 2, 3])

# Automatic: whatever the registry decides (for matplotlib Figure, default is `figure`)
run.track(fig, name="loss_curve", step=100)

# Explicit: force image handler — stores a flat PNG, no interactivity
run.track(cairn.Image(fig), name="loss_curve", step=100)

# Explicit: force figure handler — converts matplotlib → Plotly for interactive rendering
run.track(cairn.Figure(fig), name="loss_curve", step=100)

# Also useful for disambiguating numpy arrays
run.track(cairn.Image(np_array), name="prediction", step=100)   # 2D/3D array → image
run.track(cairn.Histogram(np_array), name="weights", step=100)  # 1D array → histogram
run.track(cairn.Tensor(np_array), name="activations", step=100) # raw array, no interpretation
run.track(cairn.Audio(np_array, sample_rate=16000), name="sample", step=100)
run.track(cairn.Video(np_array, fps=30), name="rollout", step=100)
run.track(cairn.Text(long_string), name="generation", step=100) # forces blob storage even for short strings
```

Wrappers are lightweight dataclasses that carry the raw object plus any format-specific kwargs (sample_rate, fps, etc.) that would otherwise be passed to `run.track()`. The handler dispatch in `run.track()` first checks whether the argument is a wrapper; if so, it uses the wrapper's declared handler directly, bypassing `can_handle` probing.

```python
# Rough implementation sketch
class _TypeWrapper:
    object_type: str  # class attr set by subclass

class Image(_TypeWrapper):
    object_type = "image"
    def __init__(self, obj, **kwargs):
        self.obj = obj
        self.kwargs = kwargs

class Figure(_TypeWrapper):
    object_type = "figure"
    # Figure wrapper additionally normalizes matplotlib → Plotly during serialize.
    ...
```

The wrappers live in `cairn/sdk/wrappers.py` and are re-exported from `cairn/__init__.py`: `Image`, `Figure`, `Audio`, `Video`, `Histogram`, `Tensor`, `Text`.

### Figure wrapper — matplotlib to Plotly conversion

When a user passes `cairn.Figure(matplotlib_fig)`, the figure handler attempts conversion to Plotly for interactive UI rendering. Use Plotly's `mpl_to_plotly` utility (from the `plotly` package, which we add as an optional dep under the `[media]` extra). The converter is imperfect for complex matplotlib plots — if conversion fails, fall back to rasterizing the matplotlib figure to PNG and log a warning. Store whichever representation succeeded in the artifact metadata so the UI knows how to render.

For native Plotly figures passed in, no conversion is needed; serialize the `fig.to_json()` output directly.

### Figures — dual storage rationale

For matplotlib/Plotly figures, store both the source representation and a rendered PNG. The source enables the UI to re-render interactively (panning, hovering on Plotly). The PNG is the fallback so the UI list view can show thumbnails without deserializing every figure. Metadata on the artifact records which representations are present.

## CLI output capture (Aim-style)

Aim captures a run's stdout/stderr cleanly without interfering with the user's terminal experience. Emulate that approach.

### Requirements

1. During an active run, duplicate stdout/stderr: the user still sees output in their terminal in real time, AND the content is shipped to the server over HTTP.
2. The server writes `.cairn/logs/<run_id>/{stdout,stderr,combined}.log` and also indexes each line into the `log_lines` table for queryable access.
3. ANSI color codes are preserved in the on-server file (so users can `cat` the combined log after downloading), but stripped before insertion into the DB (so the UI gets clean text).
4. Capture must survive:
   - subprocess output written via `print()` from child processes (if they inherit stdout fds)
   - logging module output
   - tqdm and other progress bars — tqdm writes to stderr with carriage returns; strip `\r`-prefixed partial lines and only record the final line of each update cycle.
5. Capture starts on `Run(...)` construction and stops on `finish()` or interpreter exit (via atexit handler).
6. If `capture_stdout=False`, skip all of this.
7. Log uploads use the same buffering + retry + spill-to-disk strategy as metric batches.

### Implementation approach

Replace `sys.stdout` and `sys.stderr` with tee-like wrappers at run start. The wrappers:
- Write bytes through to the original stream (so the user still sees output).
- Maintain a line buffer; on newline, enqueue a log line for batched HTTP upload to `/api/runs/{run_id}/logs`.
- Stripped-ANSI content goes in the HTTP payload; the user's terminal still gets the full ANSI-formatted output locally.

The server, on receiving log batches, writes them to `<data-dir>/logs/<run_id>/{stdout,stderr,combined}.log` AND inserts rows into the `log_lines` table.

On finish, restore the original streams and flush any buffered lines. Handle edge cases:
- Nested runs: v1 forbids nested runs. If a `Run` is constructed while another is active in the same process, raise `RuntimeError`.
- Fork safety: best-effort. If the user forks, child writes go through the parent's wrappers via inherited fds — fine for most cases. Subprocess children launched via `subprocess.run(capture_output=False)` also flow through.

### Log UI tab

In the UI, each run has a "Logs" tab showing the combined output. Support:
- Tail-follow for running runs (poll every 2s for new rows).
- Search (simple substring match via SQL `LIKE`).
- Jump to timestamp.
- Download raw log.

## Source tree capture (W&B-style)

On run start, snapshot the user's Python source tree so that — months later — someone can see exactly what code produced this run.

### What to capture

By default, capture:
- All `*.py` files in the current working directory (recursive)
- All `*.yaml`, `*.yml`, `*.toml`, `*.json`, `*.cfg`, `*.ini` files (config)
- `requirements.txt`, `pyproject.toml`, `setup.py`, `setup.cfg`, `Pipfile`, `Pipfile.lock`, `poetry.lock`, `uv.lock`, `environment.yml`

Exclude by default:
- Anything matched by `.gitignore` (if present)
- `.git/`, `__pycache__/`, `*.pyc`, `.venv/`, `venv/`, `node_modules/`, `.cairn/` itself
- Files larger than 1 MB (log and skip — these are likely data, not code)
- Binary files (detect via null-byte sniff on first 8KB)

### Configuration

```python
run = cairn.Run(
    ...,
    capture_source=True,              # or False to disable entirely
    source_include=["*.py", "*.yaml"], # override patterns
    source_exclude=["tests/*"],        # additional excludes
    source_root=None,                  # auto-detected; see "Source root detection" below
    source_max_file_size_mb=1,
)
```

### Source root detection

When `source_root` is `None` (the default), Cairn walks upward from the current working directory looking for a project marker. The first directory containing any of the following becomes the source root:

1. `.git/` directory — strongest signal, most projects use git
2. `pyproject.toml`
3. `pixi.toml` or `pixi.lock`
4. `setup.py` or `setup.cfg`
5. `Pipfile`
6. `environment.yml` (conda)
7. `uv.lock`
8. `poetry.lock`
9. `requirements.txt`
10. `.hg/` (mercurial)

If the walk reaches the filesystem root without finding a marker, fall back to the current working directory and emit a warning suggesting the user either add a marker or pass `source_root=` explicitly. This behavior matches what developers expect from tools like `ruff`, `rye`, and `uv`.

The detected root is recorded in the manifest's `root` field so the UI can show where it came from. Also record *which* marker was found (`"marker": "pyproject.toml"`) for debuggability.

Implement this in `cairn/sdk/capture/source.py` as `find_project_root(start: Path) -> tuple[Path, str | None]` returning `(root, marker)`.

### Storage

On the client, build a tar archive and compress with zstd (use `zstandard` package). Compute sha256 per file and build a manifest:

```json
{
  "root": "/abs/path/to/source_root",
  "captured_at": "2026-04-16T12:00:00Z",
  "files": [
    {"path": "train.py", "size": 4821, "sha256": "abc..."},
    {"path": "config/base.yaml", "size": 312, "sha256": "def..."}
  ],
  "skipped": [
    {"path": "data/big.csv", "reason": "size>1MB"}
  ]
}
```

The SDK uploads both via `POST /api/runs/{run_id}/source` as multipart. The server stores the archive at `<data-dir>/sources/<run_id>/tree.tar.zst` and the manifest at `<data-dir>/sources/<run_id>/manifest.json`.

### UI tab

"Source" tab shows a file tree. Clicking a file displays it with syntax highlighting (use Prism or Shiki on the frontend). Include a "download archive" button.

## Git capture

If the run is launched from inside a git repo (detected via `git rev-parse --git-dir`), capture:

- `git_sha` — current HEAD commit
- `git_branch` — current branch name
- `git_dirty` — boolean, true if there are uncommitted changes
- If dirty, capture the diff (`git diff HEAD`) and save as `.cairn/sources/<run_id>/uncommitted.patch`

Store only in the `runs` row (and the patch file); no separate table.

## Environment capture

When `capture_env=True`, record:

- `python_version` — from `sys.version_info`
- `platform` — from `platform.platform()`
- `hostname` — from `socket.gethostname()`
- `user` — from `getpass.getuser()`
- `pip_freeze_hash` — sha256 of sorted `pip freeze` output (store the full output as an artifact keyed by that hash to deduplicate across runs with identical envs)
- `cuda_available`, `cuda_version`, `gpu_names` (list) — best-effort via `torch` if available, else `nvidia-smi` parsing, else null
- `cli_args` — `sys.argv`

Store in `runs.env_snapshot` as a JSON blob. The pip freeze itself goes to the artifact store.

## System metrics capture

In addition to static environment info, Cairn samples dynamic system resource usage throughout the run. These are automatically tracked as scalar sequences under a reserved `system.*` namespace so they show up in the UI alongside user-logged metrics.

### What to capture

Sampled every `system_metrics_interval` seconds (default 10s, configurable):

**CPU:**
- `system.cpu.util_percent` — overall CPU utilization (0-100)
- `system.cpu.per_core_util_percent.<N>` — per-core utilization, one series per core
- `system.cpu.load_1m`, `system.cpu.load_5m`, `system.cpu.load_15m` — load averages (Unix only)

**Memory:**
- `system.memory.used_gb` — used RAM in GiB
- `system.memory.total_gb` — total RAM in GiB (static, set once)
- `system.memory.util_percent` — RAM utilization (0-100)
- `system.memory.swap_used_gb` — swap used in GiB

**Disk:**
- `system.disk.read_mb_per_sec` — disk read throughput, delta-based
- `system.disk.write_mb_per_sec` — disk write throughput, delta-based

**Network:**
- `system.network.recv_mb_per_sec` — network receive throughput
- `system.network.sent_mb_per_sec` — network send throughput

**Per-GPU (one set of series per GPU, indexed by id):**
- `system.gpu.<N>.util_percent` — GPU utilization
- `system.gpu.<N>.memory_used_gb` — VRAM used
- `system.gpu.<N>.memory_util_percent` — VRAM utilization
- `system.gpu.<N>.temperature_c` — temperature in Celsius
- `system.gpu.<N>.power_watts` — power draw
- `system.gpu.<N>.fan_percent` — fan speed (if available)

**Process-level (the training process specifically):**
- `system.process.cpu_percent` — CPU used by this process
- `system.process.memory_gb` — RSS of this process
- `system.process.num_threads`

### Implementation

Use `psutil` for CPU, memory, disk, network, and process stats. It's cross-platform, well-maintained, and has no heavy dependencies.

For GPU stats, try sources in this order:
1. `pynvml` (NVIDIA Management Library Python bindings) — preferred for NVIDIA GPUs, gives us everything including temperature and power.
2. `nvidia-smi` subprocess with `--query-gpu=...` — fallback if `pynvml` isn't installed.
3. `rocm-smi` for AMD GPUs — basic support.
4. Apple Silicon via `powermetrics` (requires sudo on macOS — if unavailable, skip GPU metrics with a one-time warning).

Both `psutil` and `pynvml` are lightweight enough to be core dependencies. Add them to the required deps list.

A single background thread (`SystemMetricsCollector`) runs inside the SDK process during the run. It:
- Takes a sample every `system_metrics_interval` seconds.
- Pushes each metric through the normal `run.track()` path (so it flows through the same buffering, batching, and HTTP upload pipeline as user metrics).
- Runs at low priority (`nice` on Unix) to avoid perturbing training.
- Stops when the run finishes.

### Configuration

```python
run = cairn.Run(
    ...,
    capture_system_metrics=True,       # default True
    system_metrics_interval=10.0,      # seconds between samples
    system_metrics_include_per_core=False,  # per-core CPU is noisy; off by default
)
```

If `capture_system_metrics=False`, skip the collector entirely.

### UI treatment

The `system.*` namespace is displayed in a dedicated "System" sub-tab within the Metrics tab, separate from user-logged metrics, so the main view isn't cluttered. Users can toggle it off. In comparison views, system metrics are selectable like any other metric.

## SDK ergonomics and performance

### Buffering and flushing

Training loops may call `run.track()` thousands of times per second. Blocking on HTTP requests would be catastrophic. Architecture:

- `run.track()` appends to an in-memory buffer and returns immediately.
- A background thread (daemon) flushes the buffer in batches every 500ms OR when the buffer exceeds 1000 rows.
- Batches are sent as a single HTTP POST to `/api/runs/{run_id}/batch` with a compact JSON payload (or MessagePack if we want later).
- Artifacts (images, etc.) are uploaded as separate multipart POSTs to `/api/artifacts`, returning the sha256 hash that then gets referenced in the next sequence batch.
- Artifact uploads are deduplicated client-side: the SDK hashes the blob first and calls `HEAD /api/artifacts/{hash}` before uploading; if the server already has it, skip the upload.
- On `run.finish()`, drain the buffer and block until fully flushed.
- On Python interpreter exit, register an atexit handler that calls `finish()` on any active runs.

### Network resilience

Networks are flaky. Training jobs shouldn't die because of a dropped packet:

- All HTTP calls use exponential backoff with jitter (start 1s, cap 30s, max 5 retries per batch).
- If a batch ultimately fails after retries, spill it to `~/.cache/cairn/pending/<run_id>/<batch_id>.json` on the client machine. A background task retries spilled batches when the server is reachable again.
- `run.track()` never raises on transient network errors. It raises only for programmer errors (bad types, closed run, etc.).
- On `run.finish()`, wait up to `timeout` seconds for pending batches to flush; if they don't, log a warning and tell the user the run is "partial" and will reconcile when the server is next reachable.
- A `cairn sync` CLI command on the client forces reconciliation of any spilled batches.

This gives us a pragmatic middle ground: fully online in the happy path, graceful degradation when the network blips, without the full complexity of offline-first replication.

### Concurrency on the server

Many clients may push to the server concurrently. The server uses a single DuckDB connection and serializes writes through an internal queue (DuckDB's concurrency model prefers single-writer). Reads from the UI go through a separate read-only connection. This is simpler than managing connection pools and is plenty fast for single-network teams.

### API surface (minimal v1)

```python
cairn.Run(project, task, name=None, tags=None, notes=None, repo=None,
          capture_source=True, capture_stdout=True, capture_env=True, ...)
run.track(value, name, step=None, context=None, **kwargs)  # step auto-increments if None
run["key"] = value          # param setter (dict-like)
run.log_artifact(obj, name, step=None)  # one-off artifact (not a sequence)
run.set_tag(tag)
run.add_note(text)
run.finish(status="completed" | "failed" | "killed")
run.id  # the 12-char hash
run.url  # http://localhost:<port>/runs/<id> if server is running
```

Context manager support: `with cairn.Run(...) as run:` — calls `finish("completed")` on clean exit, `finish("failed")` on exception (and re-raises).

### Framework callbacks (v1 scope)

Ship one well-tested integration: **HuggingFace Trainer**. `cairn.integrations.huggingface.CairnCallback`. More integrations (PyTorch Lightning, Keras) are post-v1.

## Server and UI

### Server

FastAPI app in `cairn/server/app.py`. The server is the single source of truth — SDK clients and the UI both talk to it.

#### Ingest endpoints (SDK → server)

```
POST /api/runs                                      -> create a run
     body: { project, task, name?, tags?, notes?, env?, git?, cli_args? }
     returns: { run_id, url }

POST /api/runs/{run_id}/params                      -> set/update params
     body: { params: {key: value, ...} }

POST /api/runs/{run_id}/batch                       -> batch of sequence points
     body: { points: [{name, step, wall_time, context?, scalar_value? | artifact_hash?, object_type}, ...] }

POST /api/runs/{run_id}/logs                        -> batch of stdout/stderr lines
     body: { lines: [{stream, wall_time, line_no, content}, ...] }

HEAD /api/artifacts/{hash}                          -> check if artifact exists (for dedup)
POST /api/artifacts                                 -> upload an artifact
     multipart: file=<bytes>, mime_type=<str>, metadata=<json>
     returns: { hash, size_bytes }

POST /api/runs/{run_id}/source                      -> upload source tree archive
     multipart: archive=<tar.zst>, manifest=<json>

POST /api/runs/{run_id}/finish                      -> mark run completed/failed
     body: { status, exit_code? }
```

#### Read endpoints (UI → server)

```
GET  /api/projects                                  -> list all projects
GET  /api/projects/{project_id}                     -> project detail
GET  /api/projects/{project_id}/tasks               -> list tasks in project
GET  /api/projects/{project_id}/tasks/{task_id}     -> task detail
GET  /api/runs                                      -> list runs (query: project, task, status, limit, offset)
GET  /api/runs/{run_id}                             -> run detail (params, tags, env, git, etc.)
GET  /api/runs/{run_id}/sequences                   -> list sequence names + metadata (no values)
GET  /api/runs/{run_id}/sequences/{name}            -> sequence values (query: context, step_from, step_to, max_points)
GET  /api/runs/{run_id}/artifacts                   -> list artifacts
GET  /api/runs/{run_id}/logs                        -> paginated log lines (query: offset, limit, stream, since)
GET  /api/runs/{run_id}/source/tree                 -> file tree from manifest
GET  /api/runs/{run_id}/source/file?path=...        -> file contents (text)
GET  /api/artifacts/{hash}                          -> raw artifact bytes (with correct Content-Type, supports Range)
POST /api/compare                                   -> body: {run_ids: [...], metrics: [...]}, returns aligned series

GET  /api/workspaces/{scope_type}/{scope_id}        -> workspace layout for a run/task/project
                                                       In v1: returns auto-generated default layout.
                                                       In v2: returns saved layout if exists, else default.

GET  /api/health                                    -> { status: "ok", version, uptime_sec }
GET  /api/info                                      -> { version, data_dir, run_count, size_bytes }

GET  /                                              -> serves React SPA
GET  /static/*                                      -> static assets
```

For sequences, support `max_points` via SQL-side downsampling (LTTB or uniform bucketing) so the UI never receives more than e.g. 2000 points per metric regardless of run length.

For artifacts, serve with HTTP Range support so video scrubbing and audio seeking work natively in the browser.

#### CORS and binding

Default bind is `0.0.0.0:4300` — the server must be reachable from other machines on the network. CORS is permissive by default (`Access-Control-Allow-Origin: *`) because the v1 threat model is "trusted local network." A `--bind 127.0.0.1` flag is available for users who want local-only. Document clearly that Cairn has no auth and should not be exposed to the public internet.

### `cairn server` command

```
cairn server [--port 4300] [--host 0.0.0.0] [--data-dir PATH] [--no-browser] [--advertise]
```

Behavior:
- Default data directory is `~/.cairn/`. Create if it doesn't exist.
- Start FastAPI via uvicorn on the specified host:port.
- Print a clear startup banner:
  ```
  Cairn server running at:
    Local:   http://localhost:4300
    Network: http://192.168.1.42:4300
  Data directory: /home/user/.cairn
  Press Ctrl+C to stop.
  ```
- On first start on a new machine, detect the LAN IP and print the `Network:` URL prominently so the user knows what to pass to `CAIRN_SERVER`.
- With `--advertise`, broadcast the server via zeroconf/mDNS.
- On Ctrl+C, shut down cleanly: wait up to 10s for in-flight HTTP requests to complete.
- Write a PID file to `<data-dir>/server.pid`; refuse to start if another instance is already running on the same data directory.

### Client-side CLI commands

These run from any machine with Cairn installed; they talk to the server over HTTP:

- `cairn list` — list recent runs on the configured server.
- `cairn open <run_id>` — print the UI URL for a run, and open browser unless `--no-browser`.
- `cairn rm <run_id>` — delete a run and its artifacts (server-side).
- `cairn export <run_id> --format parquet|json --out PATH` — download a run's data.
- `cairn sync` — force reconciliation of any spilled batches from failed uploads.
- `cairn ping` — check server reachability and print version info.
- `cairn configure` — interactive setup that writes `~/.config/cairn/config.toml`.

### UI — v1 scope

React SPA. Vite build. TypeScript. Tailwind for styling. TanStack Query for data fetching. Recharts for plots. React Router for navigation.

The UI is inspired by Weights & Biases' navigation model but deliberately simpler. It must work well on both desktop and phones — many ML practitioners check training progress from their phone while away from their workstation.

#### Information hierarchy

Three levels of navigation, from most global to most specific:

1. **Server-level** — top bar: Cairn logo, search, server health indicator, settings.
2. **Project-level** — when viewing inside a project, a secondary nav with Workspace / Runs / Compare (these are project-scoped views).
3. **Run-level** — when viewing a single run, tabs for Overview / Metrics & Media / Logs / Source / Environment.

#### Routes

```
/                                              → Projects overview (landing page)
/p/:project                                    → Project workspace (default view)
/p/:project/runs                               → Runs table
/p/:project/compare                            → Compare view
/p/:project/r/:run_id                          → Run detail (redirects to /overview)
/p/:project/r/:run_id/overview
/p/:project/r/:run_id/metrics
/p/:project/r/:run_id/logs
/p/:project/r/:run_id/source
/p/:project/r/:run_id/env
/settings                                      → Server info, preferences
```

Task IDs are carried as query params (`?task=baseline-cnn`) rather than path segments to keep URLs short — tasks are primarily a filter/grouping concept, not a separate navigable level.

#### Projects overview (landing page at `/`)

A table of all projects on this server. For each project:
- Name (clickable, leads to `/p/:project`)
- Last run timestamp (relative: "15 hours ago")
- Total run count
- Active run count (currently running, with a pulsing dot)
- Tags

Sortable and searchable. This is the `/` route and what users see when they first open the UI. No "create project" button — projects are created implicitly by the SDK.

#### Project workspace (`/p/:project`)

This is the main working view, directly inspired by W&B's workspace. Two-pane layout on desktop:

**Left rail (run selector):**
- Header with project name + run count.
- Search box ("Search runs").
- Run list with checkboxes for visibility toggle (checked runs are included in the workspace plots).
- Each run row shows: color swatch (for plot series), run display name, status indicator, relative timestamp.
- Click a run's name to navigate to the run detail view.
- "Select all" / "Select none" quick actions.
- Filter pills at the top: by task, by tag, by status, by date range.

**Main pane (workspace canvas):**
- "Add panels" / search bar at the top — lets users filter which metric cards are visible (by name).
- The card grid: one card per unique `(name, context)` pair, aggregating data from all *visible* (checked) runs as overlaid series.
- When only one run is visible, cards show that single run's data (as in the W&B screenshot).
- When multiple runs are visible, scalar cards become multi-series plots (one series per run, colored by run).
- System metrics group at the bottom, collapsible.

**Section groups on the canvas:**
Cards are grouped into sections, inspired by W&B's "Charts / Media / system / runtime / train" groupings. Cairn's v1 auto-grouping rule:
- Any metric name with a `.` treats the prefix as a section name. `train.loss` → "train" section; `system.gpu.0.util_percent` → "system" section.
- Metrics without a `.` go into a default "Charts" section.
- Artifacts (images/audio/video/figures) go into a "Media" section.
- Section headers show a count and can be collapsed.

#### Runs table (`/p/:project/runs`)

A dense table view for when users want a bird's-eye view of many runs. Columns:
- Checkbox (for multi-select → Compare)
- Name
- Task
- Status (with icon)
- Created at
- Duration
- Selected key params (user-configurable columns)
- Selected summary metrics (user-configurable columns)
- Tags

Sortable by any column. Filter bar at the top. Multi-select lets users jump to Compare with the selection pre-populated.

#### Compare view (`/p/:project/compare`)

Similar to the project workspace but pre-scoped to a user-selected set of runs. Shows side-by-side plots with aligned x-axes. v1 keeps this simple — a list of selected runs on the left, overlaid plots on the right.

#### Run detail (`/p/:project/r/:run_id`)

Five tabs across the top of the main pane:
1. **Overview** — params table, tags, notes, status, timing, git info, detected source marker.
2. **Metrics & Media** — the per-run card workspace (same card system as the project workspace, but scoped to one run).
3. **Logs** — terminal-style log viewer with search, tail-follow for running runs, stream filter (stdout/stderr/combined).
4. **Source** — file tree + syntax-highlighted viewer + download archive button.
5. **Environment** — env snapshot, pip freeze, CLI args, GPU info, captured system metrics summary.

### Card-based layout for Metrics & Media

Everything logged during a run — scalars, images, audio, video, figures, histograms — is rendered as a **card** on a single scrollable canvas. The same card system is used in three places: the project workspace (aggregating visible runs), the Compare view (explicit set of runs), and the run detail view (one run).

**v1 behavior (fixed layout, auto-generated):**

- On first load, the server generates a default layout: one card per unique `(name, context)` pair across all logged sequences, plus one card per artifact name.
- Cards are arranged in a responsive grid, sized based on card type (scalar plots are wider than image thumbnails).
- Section grouping follows the `.`-prefix rule described above.
- Card types map to sequence `object_type`:
  - `scalar` → line plot card
  - `image` → image gallery card with step scrubber
  - `audio` → audio player card with step scrubber
  - `video` → video player card with step scrubber
  - `figure` → interactive Plotly render (or PNG fallback)
  - `histogram` → histogram card, optionally animated over steps
  - `text` → scrollable text card
- When multiple runs are visible (project workspace, Compare), scalar cards overlay series — one per run, colored by run. Media cards show a "run picker" inside the card since you can't meaningfully overlay images.
- Layout is *not* editable in v1 — no dragging, no adding custom cards. Ordering is deterministic: alphabetical within each section, sections in a fixed order (`Charts`, user-defined prefixed sections alphabetically, `Media`, `system` last).

**Card component contract:**

Every card is a React component that receives:
```typescript
interface CardProps {
  runIds: string[];        // one or more; card renders overlay when > 1
  config: CardConfig;      // type-specific (metric name, context, etc.)
  size: { w: number; h: number };  // grid cells in v2; responsive in v1
  onEdit?: () => void;     // no-op in v1, used in v2
}
```

Cards are registered in a central `CardRegistry` keyed by `card_type` string. v1 ships with: `scalar_plot`, `image_gallery`, `audio_player`, `video_player`, `figure_interactive`, `histogram`, `text_viewer`. Adding a card type is a matter of implementing the component and registering it.

### Mobile responsiveness

The UI must be genuinely usable on phones, not an afterthought. Design for 375px width (iPhone SE baseline) and up. Breakpoints:

- **`< 768px` (phone):**
  - Top bar collapses: logo + hamburger menu. Search and settings move into the menu.
  - Project-level secondary nav becomes a horizontally scrollable pill bar, not tabs.
  - Project workspace: the left run rail becomes a bottom sheet triggered by a "Runs (N)" button. The main pane takes the full width.
  - Card grid goes to a single column; every card is full-width.
  - Run detail tabs become a horizontally scrollable pill bar.
  - Logs view uses a smaller monospace font, horizontal scroll within lines.
  - Tables become card lists (each row a card with label-value pairs stacked vertically).
  - Card scrubbers (for image/audio/video) use larger touch targets (min 44px).
- **`768px – 1024px` (tablet):**
  - Two-pane layout retained but left rail is narrower (240px) and can be collapsed to an icon strip.
  - Card grid uses 2 columns.
- **`>= 1024px` (desktop):**
  - Full layout as described.
  - Card grid uses 2-3 columns depending on width.

Specific mobile considerations:
- All interactive elements respect `min-height: 44px` / `min-width: 44px` touch targets.
- Bottom-of-screen primary action pattern on phones (e.g., "Apply filters" button fixed at bottom when a filter sheet is open).
- No hover-only interactions. Hover states must have a tap equivalent (long-press for plot tooltips; we can use touch events for this).
- Progressive loading: on slow connections, render card skeletons immediately, then fill in as data arrives per-card.
- Respect `prefers-reduced-motion` for any plot animations or transitions.

Test on real devices before shipping, not just browser devtools. Minimum test matrix: iPhone SE (smallest modern screen), iPhone 15 Pro, a mid-range Android, iPad.

### Design principles

- Keep it boring and fast. No animations beyond basic transitions. No drag-and-drop in v1.
- Dark mode by default (developers prefer it; ML teams especially). Light mode toggle respects `prefers-color-scheme`.
- Monospace for all numbers, IDs, paths, code.
- The UI should feel closer to a debugger than a dashboard.
- All card components must render in under 100ms for a visible card's worth of data (driven by server-side downsampling).
- URLs are canonical — any view state the user might want to share or bookmark (selected runs, filters, active tab) goes in the URL, not just component state.

The user (project owner) will provide more detailed direction during UI implementation. For v1, build the skeleton with all navigation levels working, the default card layout, and full mobile responsiveness. Don't over-invest in visual polish before owner review.

## Packaging and distribution

- Package name on PyPI: **`cairn-track`** (the bare `cairn` name is taken by an abandoned 2019 package).
- Import name: `cairn` (so users write `import cairn`).
- Project/brand name: **Cairn**.
- GitHub repo: to be decided by owner.
- Python support: 3.10+.
- Dependencies (keep minimal): `duckdb`, `fastapi`, `uvicorn`, `pydantic`, `httpx` (SDK client), `zstandard`, `pillow`, `numpy`, `click` (for CLI), `platformdirs` (for config paths), `psutil` (system metrics), `pynvml` (NVIDIA GPU metrics; falls back gracefully if no NVIDIA GPU). Optional extras: `[media]` adds `imageio-ffmpeg`, `soundfile`, `plotly` (for matplotlib→Plotly conversion); `[hf]` adds HuggingFace callback deps; `[discovery]` adds `zeroconf`.
- Ship the pre-built React UI as static files inside the wheel. Users should not need Node.js to run Cairn.

## Project structure

```
cairn-track/
  pyproject.toml
  README.md
  LICENSE              # Apache 2.0
  cairn/
    __init__.py        # exports: Run, configure, register_handler, __version__
    config.py          # resolve server URL, load config file
    sdk/               # CLIENT side
      __init__.py
      run.py           # Run class (HTTP client)
      wrappers.py      # Image, Figure, Audio, Video, Histogram, Tensor, Text
      buffer.py        # background flushing
      transport.py     # HTTP client: retries, backoff, dedup, spill-to-disk
      capture/
        __init__.py
        stdout.py      # tee-style stdout/stderr capture
        source.py      # source tree archive builder + project root detection
        env.py         # environment capture
        git.py         # git metadata
        system.py      # background system metrics collector (CPU/RAM/GPU/disk/net)
      handlers/
        __init__.py
        registry.py
        scalar.py
        image.py
        audio.py
        video.py
        figure.py
        histogram.py
        tensor.py
        text.py
      discovery.py     # optional zeroconf client
    server/            # SERVER side
      __init__.py
      app.py           # FastAPI app
      storage/
        __init__.py
        db.py          # DuckDB connection management (single writer)
        migrations.py  # schema versioning
        blobs.py       # content-addressable artifact store
        datadir.py     # data directory management, PID file
      routes/
        ingest.py      # POST endpoints (SDK → server)
        projects.py
        runs.py
        sequences.py
        artifacts.py
        logs.py
        source.py
        compare.py
        health.py
      downsample.py    # LTTB + bucketing
      advertise.py     # optional zeroconf/mDNS broadcaster
    ui/
      dist/            # built React assets, shipped in wheel
    cli.py             # click-based CLI: server, list, open, rm, export, sync, ping, configure
    integrations/
      __init__.py
      huggingface.py
  tests/
    unit/
    integration/
  ui-src/              # React source (excluded from wheel)
    package.json
    vite.config.ts
    src/
      App.tsx
      components/
      pages/
      api/             # generated from OpenAPI spec
      types.ts
```

## Implementation order (suggested)

Build and test each layer before moving to the next. Don't try to build everything in parallel.

1. **Server storage layer** — data directory management, DuckDB setup, migrations, blob store. Unit tests for concurrent writes.
2. **Server ingest API** — FastAPI routes for creating runs, posting params, posting batches, uploading artifacts. Integration test: curl can drive a full run lifecycle.
3. **SDK transport layer** — HTTP client with retries, backoff, dedup, spill-to-disk. Test against a mock server AND a real one.
4. **SDK core** — `Run` class, params, scalar tracking, buffering on top of transport. Integration test: real training loop logs 10k scalars to a real server in <5s overhead.
5. **Handlers** — image, then figure, then audio/video/histogram/tensor. Each with round-trip tests through the HTTP API.
6. **Capture** — env, git, source tree. Each testable in isolation on the client side.
7. **Stdout capture** — tricky; leave for after the basics work. Test with tqdm, with logging module, with subprocess children.
8. **Server read API** — endpoints for the UI. OpenAPI spec auto-generated; use it to drive UI API client codegen.
9. **CLI** — `cairn server`, `cairn list`, `cairn ping`, etc. Startup banner with network URLs.
10. **UI skeleton** — routing, navigation shell, project workspace with run rail, runs table, run detail tabs, default card layout. Mobile-responsive from day one, not retrofitted. Wire up the APIs. Polish later, after owner review.
11. **HuggingFace integration** — end-to-end smoke test with a real fine-tuning run against a separate-machine server.
12. **Zeroconf discovery** — optional nice-to-have; last.
13. **Packaging** — build wheel with bundled UI assets, test on clean env, test cross-machine scenario, publish to TestPyPI.

## Open questions for the owner

Flag these before or during implementation — don't guess:

- Default port: **4300**. Confirm — or pick something more memorable (e.g. 4233, 5173 conflicts with Vite dev server so avoid).
- LICENSE: Apache 2.0 is proposed. Confirm.
- Default server bind: `0.0.0.0` (LAN-accessible) vs `127.0.0.1` (explicit opt-in for network). Proposal is `0.0.0.0` to match the "just works across devices" goal, with a prominent security note in docs and the startup banner.
- UI framework specifics (component library? shadcn/ui is a reasonable default).
- Zeroconf/mDNS: in v1 or post-v1? Proposal: implement last in v1, but gate behind `--advertise` flag.
- Retention policy for old runs — v1 proposes no automatic deletion, but should `cairn gc` be in scope?
- Auth: we're assuming trusted LAN for v1. If that's not true for your environment, we need to revisit before implementation starts — adding auth later is a breaking change for client setup.
- Logo / branding — out of scope for v1 implementation, but note for later.

## Testing strategy

- **Unit tests**: every handler, every storage primitive, every capture module.
- **Integration tests**: end-to-end run creation + query via Python API.
- **Performance tests**: training loop with 100k scalar logs + 100 images must complete with <10% overhead vs. no tracker.
- **UI tests**: Playwright for a smoke test that exercises the navigation hierarchy (projects → project workspace → run detail → all five tabs). Run the smoke suite at three viewport sizes: 375×667 (phone), 768×1024 (tablet), 1440×900 (desktop) — all three must pass for a green build.

Target: >80% line coverage on the Python code; UI just needs the smoke test.

## Definition of done for v1

A user on a clean Python 3.11 environment can:

1. `pip install cairn-track` on Machine A (server) and Machine B (training).
2. On Machine A: run `cairn server`. See a banner with a `Network: http://<lan-ip>:4300` URL.
3. On Machine B: set `CAIRN_SERVER=http://<lan-ip>:4300`, add ~5 lines to a training script to log metrics and images, run the script.
4. During training, Machine B's terminal shows training output normally; metrics appear on the server immediately.
5. On any device (Machine A, Machine B, a phone on the same WiFi): open `http://<lan-ip>:4300/` in a browser and see the projects overview. Enter a project, see the workspace with the run in the left rail and cards on the right. Open the run detail view. Click through all five tabs. See system metrics in the collapsible System section, see logs, source, env.
6. On the phone specifically: the same flow is fully usable — projects list, project workspace (run rail as bottom sheet), card grid single-column, run detail tabs as horizontal pills. No horizontal scrolling of the main page. Touch targets feel right.
7. Run the script a second time. A new run appears; compare both via the Compare view.
8. Pull Machine B's Ethernet cable mid-run. The training script keeps running and doesn't crash. On reconnect, `cairn sync` reconciles the missed batches.

If all eight work end-to-end on macOS, Linux, and Windows (for the server and client), and on iOS Safari and Android Chrome (for the UI), v1 is done.

## Future: offline mode

Post-v1, add a true offline mode where the SDK can write to a local DuckDB file with no server reachable at all, and `cairn push --from <path> --to <server>` replays it. The current architecture (HTTP batching with spill-to-disk) is a stepping stone toward this — the spilled batches on disk are already the raw material for offline replay. But don't build this in v1; get the happy-path cross-device experience rock solid first.

## v2: Editable workspace layouts

The v1 card layout is fixed and auto-generated. v2 turns it into a user-editable workspace, inspired by W&B's workspace feature. Users will be able to:

- **Rearrange cards** via drag-and-drop, resize cards, and persist the layout per run, per task, or per project (scope selectable).
- **Add custom cards**:
  - **Markdown note cards** — freeform text with markdown rendering, for run annotations and decisions made during analysis.
  - **Comparison cards** — pick N runs and a metric; render overlaid plots in a single card, independent of the Compare tab.
  - **Scalar aggregate cards** — show a single number (e.g. "best val_accuracy") computed over a sequence, configurable aggregation (min/max/last/mean over last N).
  - **Table cards** — display a subset of params or metrics as a formatted table.
  - **Image-diff cards** — side-by-side comparison of images at the same step across runs.
  - **Linked-axes groups** — cards whose x-axis is synchronized so hovering one plot highlights the step on all others.
- **Save named views** per task or project — e.g. "Ablation analysis", "Training health" — each with its own card layout and filter state.
- **Share a view** via a URL that encodes layout + filters + selected runs.

### Schema additions for v2

Add two tables to the DuckDB schema:

```sql
CREATE TABLE workspaces (
    id             VARCHAR PRIMARY KEY,    -- ulid
    scope_type     VARCHAR NOT NULL,       -- 'run' | 'task' | 'project' | 'global'
    scope_id       VARCHAR NOT NULL,       -- run_id, task_id, project_id, or 'default'
    name           VARCHAR NOT NULL,
    layout         JSON NOT NULL,          -- array of card configs with positions
    created_at     TIMESTAMP NOT NULL,
    updated_at     TIMESTAMP NOT NULL
);

CREATE TABLE notes (
    id             VARCHAR PRIMARY KEY,
    workspace_id   VARCHAR REFERENCES workspaces(id),
    content        VARCHAR NOT NULL,       -- markdown
    created_at     TIMESTAMP NOT NULL,
    updated_at     TIMESTAMP NOT NULL
);
```

The `layout` JSON structure is an array of card entries:

```json
{
  "cards": [
    {
      "id": "card_abc",
      "type": "scalar_plot",
      "config": {"metric": "loss", "contexts": ["train", "val"]},
      "position": {"x": 0, "y": 0, "w": 6, "h": 4}
    },
    {
      "id": "card_def",
      "type": "markdown_note",
      "config": {"note_id": "note_xyz"},
      "position": {"x": 6, "y": 0, "w": 6, "h": 4}
    },
    {
      "id": "card_ghi",
      "type": "comparison",
      "config": {"run_ids": ["abc123", "def456"], "metric": "accuracy"},
      "position": {"x": 0, "y": 4, "w": 12, "h": 6}
    }
  ],
  "grid": {"columns": 12}
}
```

### v1 design choices that enable v2

To make v2 additive rather than a rewrite, v1 should already:

- **Treat the default layout as just one layout.** Implement the v1 auto-generation as a function `generate_default_layout(run_id) -> Layout` that returns the same JSON structure v2 will edit. Even though it's not persisted in v1, the frontend should render from this structure, not from a hardcoded template. This means v1 and v2 share the render path.
- **Define the `CardRegistry` abstraction now.** Every v1 card type (`scalar_plot`, `image_gallery`, etc.) is registered the same way v2 cards will be. Adding `markdown_note` and `comparison` in v2 is just registering new types.
- **Use a grid system for positioning in v1, even though positions are fixed.** Assign each auto-generated card a `position` in the same grid coordinate system v2 will use. v1 just computes positions deterministically; v2 lets the user override them.
- **Keep the `Layout` API server-side ready.** Add `GET /api/workspaces/{scope_type}/{scope_id}` to the server now, even if v1's only response is the default generated layout. v2 adds `PUT` and `POST` on the same path. This avoids breaking the UI's API contract between versions.
- **Version the layout JSON.** Include a `"version": 1` field so v2 can migrate v1 layouts cleanly.

Essentially: v1 ships the full rendering pipeline, but with read-only layouts and a fixed set of card types. v2 adds editing, persistence, and new card types without touching what v1 built.
