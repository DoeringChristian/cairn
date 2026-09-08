# cairn package split with a storage kernel

Status: v1 (2026-09-08). Owner: cairn. Supersedes the packaging halves of
`2026-08-26-cairn-split-design.md` (scrapped) and §1b of
`2026-08-27-cairn-refactor-design.md` (reverted, archived on branch
`refactor-split-archive` at c31741e7). Rulings (user, 2026-09-08): the
packages can be separated; cairn-ui becomes an optional dependency of the
server so one machine still serves both with one command; the storage layout
gets ONE centralised, versioned definition in its own package.

## 1. Problem

One wheel (`cairn-track`) carries the client, the server, the CLI and the
built UI. Consequences: a pure client install pulls FastAPI, uvicorn and a
multi-megabyte UI bundle; the server cannot ship without the UI and the UI
cannot ship without the server; the on-disk repository format (`.cairn/`:
SQLite schema and migrations, blob store, WAL, lock file, `version` marker)
is owned by `cairn/server/storage` yet written directly by the client in
local mode (`sdk/local.py`, `sdk/reader.py`, `sdk/run.py`), so "the server
never imports the SDK" holds but "the client never touches the server" does
not. The 2026-08-27 attempt split into four packages with "no code
dependency in either direction", which forced mirrored grammars and
duplicated storage knowledge, and was reverted for unrelated ingest reasons.

## 2. Goals and non-goals

Goals:

- Five distributable packages with a one-way dependency chain, developed
  in this monorepo as a uv workspace, released in lockstep.
- `cairn-store`: the single definition of the repository layout and its
  version: `DataDir`, `BlobStore`, `Database`, schema and migrations, the
  ingest operations, the artifact-registry operations, the WAL format
  (writer and reader), the lock protocol, `servers.json`. Standard library
  plus `zstandard`; no web framework, no SDK types.
- `cairn-track`: `Run`, handlers, wrappers, `Reader`, client WAL,
  transport, cairn-plot report authoring. Depends on `cairn-store` for local
  mode and on `cairn-plot`. Never imports `cairn-server`.
- `cairn-server`: FastAPI app, routes, auth, query grammar and resolver,
  WAL ingestion loop, remote-UI proxy, embed specs, LAN advertisement.
  Depends on `cairn-store`. Never imports `cairn-track`. Serves the UI when
  the `cairn-ui` package is installed (`cairn-server[ui]`).
- `cairn-ui`: a wheel containing only the built static assets and one
  function returning their path. Built from `apps/cairn-ui` (the React app,
  moved from `cairn/ui`).
- `cairn-cli`: the `cairn` command. Depends on `cairn-track`; `cairn
  server` and `cairn ui` import `cairn-server` lazily with an install hint
  (`cairn-cli[server]`, `cairn-cli[ui]` = `cairn-server[ui]`).
- A `cairn` meta-package depending on all five, so `pip install cairn`
  gives today's experience.
- Repository format versioning owned by `cairn-store`: one `REPO_FORMAT`
  constant, the `version` marker, `schema_version` and `apply_migrations`
  live together; every opener of a repo goes through one `open_repo()`
  that checks and migrates.
- Boundary lint tests that fail on a forbidden import direction.
- Behaviour unchanged for users: local direct mode, local WAL mode, HTTP
  mode, `Reader` on a local path, `cairn server --ui`, `cairn ui --repo
  cairn://…` all work exactly as today.

Non-goals: no change to the ingest model, WAL semantics, auth, query
grammar, HTTP API, or UI code; no independent versioning; no new hosting
mode for the UI; cairn-plot stays a hard dependency of `cairn-track`; the
UI stays in this repo.

## 3. Design

### 3.1 Dependency graph

```
cairn-plot (external)      cairn-ui (assets only)
      ▲                          ▲
      │                          │ [ui] extra
 cairn-track ──► cairn-store ◄── cairn-server
      ▲                               ▲
      └──────── cairn-cli ────────────┘ [server] extra (lazy import)
                    ▲
                  cairn (meta)
```

Allowed import directions are exactly the arrows. `cairn-store` imports
nothing cairn. `cairn-server` and `cairn-track` import `cairn-store` only.
`cairn-cli` imports `cairn-track` at module level and `cairn-server` only
inside the commands that need it. `cairn-ui` exports one function.

### 3.2 `cairn-store` (`packages/cairn-store/cairn_store/`)

Moved verbatim from `cairn/server/`, with imports rewritten:

| module | from |
|---|---|
| `datadir.py` (`DataDir`, `RepoLockedError`, `default_data_dir`, `read_live_servers`, `VERSION_MARKER`) | `server/storage/datadir.py` |
| `blobs.py` (`BlobStore`) | `server/storage/blobs.py` |
| `db.py` (`Database`) | `server/storage/db.py` |
| `migrations.py` (`SCHEMA_VERSION`, `apply_migrations`, `hash_context`) | `server/storage/migrations.py` |
| `ingest_ops.py` | `server/ingest_ops.py` |
| `artifact_registry_ops.py` | `server/artifact_registry_ops.py` |
| `wal.py` (`ingest_wal`, `ingest_all`, the record format) | `server/wal_ingest.py` |
| `common.py` (`slugify`, `utc_now`, `value_type`, `flatten`) | the pure half of `server/routes/_common.py`; the FastAPI dependencies (`get_db`, `get_data_dir`, `get_blobs`, `require_run`) stay in the server |

New in `cairn-store`:

```python
# cairn_store/__init__.py
REPO_FORMAT = 3            # == VERSION_MARKER; the one number a repo carries
SCHEMA_VERSION             # re-exported from migrations
class RepoFormatError(RuntimeError)
@dataclass class Repo: data_dir: DataDir; db: Database; blobs: BlobStore
def open_repo(root: Path, *, create: bool = True, migrate: bool = True) -> Repo
```

`open_repo` creates the tree when allowed, reads the `version` marker,
raises `RepoFormatError` naming both versions when the marker is newer than
`REPO_FORMAT`, opens the database and applies migrations when `migrate` is
true (the `Database.open` path today), and returns the triple. The
client's `_LocalBackend` and `LocalTransport` and the server's `create_app`
callers all open repositories through it, so there is one place that
decides what a valid repo is. The WAL record shape (`{"seq","op","payload"}`
lines; blob inline limit) is documented in `wal.py`'s module docstring as
the format contract, with `WAL_FORMAT = 1`.

Dependencies: `zstandard` (blob compression, if used there; verify),
`platformdirs` (default data dir). Nothing else.

### 3.3 `cairn-track` (`packages/cairn-track/cairn/`)

`cairn/sdk/**`, `cairn/integrations/**`, `cairn/config.py`, `cairn/plot.py`,
`cairn/__init__.py` move here unchanged except that the twelve
`..server.*` imports in `sdk/local.py`, `sdk/run.py`, `sdk/reader.py`,
`sdk/elements.py` become `cairn_store.*` imports, and `_LocalBackend` /
`LocalTransport` call `open_repo`. The package keeps the import name
`cairn` and the pip name `cairn-track`. Dependencies: `cairn-store`,
`cairn-plot`, `pydantic`, `httpx`, `zstandard`, `pillow`, `numpy`,
`platformdirs`, `psutil`, `pynvml`, `tomli-w`, `tomli`. Extras `media`,
`hf`, `discovery` as today.

### 3.4 `cairn-server` (`packages/cairn-server/cairn_server/`)

`cairn/server/**` minus what moved to the store, imports rewritten. `app.py`
locates the UI in this order: `CAIRN_UI_DIST` env; `cairn_ui.dist_path()`
if `cairn_ui` imports; else the monorepo dev path `apps/cairn-ui/dist`
relative to the repo root if it exists; else no SPA (today's placeholder
page saying the UI is not installed, with the install hint
`pip install cairn-server[ui]`). `create_app(..., mount_ui=True)` keeps its
signature. Dependencies: `cairn-store`, `fastapi`, `uvicorn[standard]`,
`pydantic`, `httpx` (proxy), `python-multipart`, `psutil`. Extras: `ui =
["cairn-ui"]`, `discovery = ["zeroconf"]`.

### 3.5 `cairn-ui` (`packages/cairn-ui/cairn_ui/` + `apps/cairn-ui/`)

`apps/cairn-ui` is today's `cairn/ui` (sources, `package.json`, vite
config, scripts) with `outDir` pointing at
`packages/cairn-ui/cairn_ui/dist`. The wheel contains `cairn_ui/__init__.py`
(`def dist_path() -> Path` and `__version__`) and `dist/**`. The dist is
committed as today; a hatch build hook (today's `hatch_build.py`, moved)
builds it on a clean checkout. No runtime Python dependency.

### 3.6 `cairn-cli` (`packages/cairn-cli/cairn_cli/`)

`cairn/cli.py` moves here. Module-level imports: `click`, `cairn`
(`config`, `sdk.transport`, `sdk.wal`). Server pieces are imported inside
`server_cmd`, `ui_cmd`, `init_cmd` and the token commands through one
helper `_server()` that raises a `ClickException` with the install hint on
`ImportError` (the archive's `_require_server`, kept). `cairn ui --repo
cairn://…` (the proxy) also needs the server package, since the proxy lives
there. Extras: `server = ["cairn-server"]`, `ui = ["cairn-server[ui]"]`.
Entry point `cairn = cairn_cli.cli:main`.

### 3.7 Meta-package and workspace

`packages/cairn/pyproject.toml`: name `cairn`, no code, dependencies
`cairn-track`, `cairn-server[ui]`, `cairn-cli`. Root `pyproject.toml`
becomes the workspace (`[tool.uv.workspace] members = packages/*`,
`[tool.uv.sources]` for each member and `cairn-plot = { path =
"vendor/cairn-plot", editable = true }`), with the `dev` extra and pytest
config. One version string in `packages/cairn/pyproject.toml` propagated
by a `scripts/release.py` that rewrites every member's `version` and the
inter-member pins (`cairn-store==X.Y.Z` etc.), so lockstep is mechanical.

### 3.8 Boundary tests

`tests/unit/test_package_boundaries.py` becomes a table-driven lint over
`packages/*`: for each package, the set of `cairn*` top-level names it may
import at module level. `cairn-cli` may additionally import
`cairn_server` inside function bodies only (detected by AST: an `Import`
node whose nearest enclosing scope is a function). The existing
server-never-imports-sdk test is subsumed.

### 3.9 Repository compatibility

`REPO_FORMAT` stays 3 and `SCHEMA_VERSION` stays 2; existing repositories
open unchanged. The `version` marker is now read, not only written:
`open_repo` refuses a newer marker with a clear error, and the CLI prints
it.

## 4. Migration of tests, examples and docs

- Tests import `cairn.server.*` in 65 files: rewrite to `cairn_store.*` /
  `cairn_server.*` mechanically (sed by module table), keep everything else.
- Examples and docs: 10 files import `cairn.server.storage.*` and
  `wal_ingest`; rewrite to `cairn_store`. `README.md` gains an install
  matrix (client only; server; server with UI; everything).
- `tests/unit/test_package_boundaries.py` rewritten (§3.8).
- CI: `uv sync --all-packages --extra dev`; pytest unchanged; UI job runs in
  `apps/cairn-ui`; a new job builds all wheels (`uv build --all-packages`)
  and installs `cairn-track` alone into a bare venv to prove the client
  imports without the server (`python -c "import cairn; cairn.Run"`).

## 5. Compatibility

Import paths `cairn.server.*` disappear. A shim package `cairn/server/
__init__.py` in `cairn-track` is NOT provided (it would recreate the
dependency); instead `cairn/__init__.py` raises an `ImportError` with the
new module name when `cairn.server` is imported (a `__getattr__` hook).
Pip name `cairn-track` keeps working for the client; users who relied on
it for the server install `cairn`.
