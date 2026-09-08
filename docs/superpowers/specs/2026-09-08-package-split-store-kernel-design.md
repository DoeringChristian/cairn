# cairn package split with a storage kernel

Status: v2 (2026-09-08; v1 revised after two plan checks against the code). Owner: cairn. Supersedes the packaging halves of
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

Charter, written at the top of `cairn_store/__init__.py`: *everything that
reads or writes bytes under `.cairn/`, and nothing that decides who may.*
Auth, HTTP and sessions never move here.

Moved verbatim from `cairn/server/`, with imports rewritten:

| module | from |
|---|---|
| `datadir.py` (`DataDir`, `RepoLockedError`, `default_data_dir`, `read_live_servers`, `VERSION_MARKER`) | `server/storage/datadir.py` |
| `blobs.py` (`BlobStore`) | `server/storage/blobs.py` |
| `db.py` (`Database`) | `server/storage/db.py` |
| `migrations.py` (`SCHEMA_VERSION`, `apply_migrations`, `hash_context`) | `server/storage/migrations.py` |
| `ingest_ops.py` | `server/ingest_ops.py` |
| `artifact_registry_ops.py` | `server/artifact_registry_ops.py` |
| `wal.py` (record format, WRITER and reader, op table) | `server/wal_ingest.py` + `sdk/local.py::_wal_write` |
| `common.py` (`slugify`, `utc_now`, `value_type`, `flatten`) | the pure half of `server/routes/_common.py`; the FastAPI dependencies (`get_db`, `get_data_dir`, `get_blobs`, `require_run`) stay in the server |

`ingest_ops` and `artifact_registry_ops` contain repository semantics only
(row shapes, id minting, slugs, lifecycle), no auth: a local-mode client
already executes them in-process today, so nothing new leaks.

Two entry points, so a WAL-mode client never opens SQLite:

```python
# cairn_store/__init__.py
REPO_FORMAT = 3            # the one public number; == the `version` marker
class RepoFormatError(RuntimeError)
@dataclass(frozen=True) class Layout: data_dir: DataDir; blobs: BlobStore
@dataclass(frozen=True) class Repo(Layout): db: Database
def open_layout(root, *, create=True) -> Layout   # tree + marker check, NO sqlite
def open_repo(root, *, create=True, migrate=True) -> Repo   # open_layout + Database
```

`open_layout` creates the tree when allowed, reads the `version` marker
(today it is written and never read), raises `RepoFormatError` naming both
numbers when the marker is newer than `REPO_FORMAT`, and refuses an older
marker unless an upgrade is registered. `open_repo` adds the database:
`migrate=True` calls `Database.open` (which applies migrations),
`migrate=False` constructs `Database(path)` (which does not).
`LocalTransport(use_wal=True)` and the WAL writer use `open_layout`;
`LocalTransport` direct mode, `_LocalBackend` and the server use `open_repo`.

**WAL ownership.** `wal.py` owns the record format `{"seq","op","payload"}`
(one JSON object per line), a header record `{"wal_format": 1}` as the first
line (absent header = format 1), `WAL_FORMAT = 1`, ONE op table
`OPS: dict[str, Handler]` from which the writer's method names and the
reader's dispatch both derive, and a reader that quarantines (renames to
`.unknown-format`) files whose format it does not know instead of skipping
records. This closes a live defect: today `sdk/local.py` writes
`create_artifact_version` / `record_artifact_input` ops that
`server/wal_ingest.py` has no branch for and silently drops, and computes
`project_id` with a different rule than the store's `slugify`. The
HTTP-transport WAL in `sdk/wal.py` (a different format with epoch and
checkpoint) is NOT a repository artifact and stays in `cairn-track`.

**Versioning scheme** (three numbers, one public):

- `REPO_FORMAT`: the tree layout. Checked by every opener. Bumped when a
  directory, file name or marker meaning changes.
- `SCHEMA_VERSION`: private to `db.py`/`migrations.py`; only database
  openers see it. `apply_migrations` raises `RepoFormatError` when the
  stamped version is newer than it knows (today it rewrites the stamp
  downward, which an older process could do under a running server) and
  runs DDL plus stamp inside `BEGIN IMMEDIATE` so two processes cannot
  migrate concurrently.
- `WAL_FORMAT`: carried in the WAL header; readers quarantine unknown
  formats.

Per mode: HTTP mode touches none of them (the contract is the HTTP API;
`REPO_FORMAT` is not advertised over HTTP); WAL local mode checks
`REPO_FORMAT` and writes `WAL_FORMAT`; direct local mode checks all three,
and a direct-mode client that finds a live server lock refuses instead of
migrating (`DataDir.read_lock()` already reports the holder).

Locking is left as today (`cli.py` acquires it; the SDK reads it), with one
addition: `_LocalBackend`'s WAL drain (`ingest_all`, which writes SQLite and
renames files) refuses to run while a live server lock exists, because the
server's ingestion loop does the same work. Making the store own the lock
protocol fully is a follow-up, not part of this split.

Dependencies: `psutil>=5.9` (pid liveness for the lock and `servers.json`).
Nothing else; the moved modules import no other third-party package.

### 3.3 `cairn-track` (`packages/cairn-track/cairn/`)

`cairn/sdk/**`, `cairn/integrations/**`, `cairn/config.py`, `cairn/plot.py`,
`cairn/__init__.py` move here unchanged except that the twenty-three
`..server.*` import statements in `sdk/local.py`, `sdk/run.py`,
`sdk/reader.py`, `sdk/elements.py` become `cairn_store.*` imports (every one
maps to the store; none needs the server), `_LocalBackend` and direct-mode
`LocalTransport` call `open_repo`, WAL-mode `LocalTransport` calls
`open_layout`, and `_wal_write` is replaced by the store's WAL writer.
The released metadata pins `cairn-plot>=0.1,<0.2` (path sources are not
published). The package keeps the import name
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
(`def dist_path() -> Path` = `Path(__file__).resolve().parent / "dist"`, a
real directory in both wheel and editable installs, which `StaticFiles`
requires; `importlib.resources` is not used) and `dist/**`. Assumption:
no zipapp/pex deployment. The dist is
committed as today; a hatch build hook (today's `hatch_build.py`, moved)
builds it on a clean checkout. No runtime Python dependency.

### 3.6 `cairn-cli` (`packages/cairn-cli/cairn_cli/`)

`cairn/cli.py` moves here. Module-level imports: `click`, `cairn`
(`config`, `sdk.transport`, `sdk.wal`). `cairn-cli` also depends on `cairn-store`
directly, so `cairn init` (which needs only `DataDir`/`Database`) works on a
client-only install. Server pieces are imported inside `server_cmd`,
`ui_cmd` (including the proxy), `_print_access_banner` and the token
commands through one helper `_server()` that raises a `ClickException` with
the install hint on `ImportError`; nothing server-side is evaluated at import
time (today `token_create_cmd`'s decorator reads `_auth.ROLES`; the roles
become a literal in the CLI with a test pinning them against
`cairn_server.auth.ROLES`). `cairn ui --repo
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
server-never-imports-sdk test is subsumed. Tests that encode the monolith
layout are rewritten, not left to decay: `test_plot_import_purity.py`
(`cairn.server*` → `cairn_server*`, root on `sys.path` → the workspace),
`test_plot_route.py` (`_UI_DIST` from `cairn_ui.dist_path()`, failing not
skipping when absent in the workspace), `test_ui_cairn_plot_card_contract.py`
(ten `cairn/ui/src` paths → `apps/cairn-ui/src`).

### 3.9 Repository compatibility

`REPO_FORMAT` stays 3 and `SCHEMA_VERSION` stays 2; existing repositories
open unchanged. The `version` marker is now read, not only written:
`open_repo` refuses a newer marker with a clear error, and the CLI prints
it.

## 4. Migration of tests, examples and docs

- 20 test files and 9 examples import `cairn.server.*` (41 references):
  `storage.datadir/db/blobs/migrations`, `wal_ingest`, `ingest_ops` →
  `cairn_store.*`; `app`, `auth`, `proxy`, `advertise`, `query_grammar`,
  `query_resolver`, `_operators` → `cairn_server.*`. `tests/conftest.py`
  imports both, so the suite needs the whole workspace; the client-only
  guarantee is proven by the CI wheel job instead. `README.md` gains an install
  matrix (client only; server; server with UI; everything).
- `tests/unit/test_package_boundaries.py` rewritten (§3.8).
- CI: `uv sync --all-packages --extra dev`; pytest unchanged; UI job runs in
  `apps/cairn-ui`; a new job builds all wheels (`uv build --all-packages`)
  and installs `cairn-track` + `cairn-store` + the cairn-plot wheel alone into
  a bare venv to prove the client imports without the server
  (`python -c "import cairn, cairn.sdk.reader, sys; assert 'cairn_server' not in sys.modules"` and `import fastapi` fails); then `cairn-server` WITHOUT `[ui]` and asserts the
  placeholder page; then everything and `cairn server --help`.

## 5. Compatibility

Import paths `cairn.server.*` disappear. No in-repo shim package (it would
recreate the dependency). `cairn/__init__.py`'s existing PEP 562
`__getattr__` raises `ImportError` naming `cairn_server`/`cairn_store` for
the attribute form (`from cairn import server`, `cairn.server`); the
statement form `import cairn.server` raises the standard
`ModuleNotFoundError`, which the release notes explain. Pip name
`cairn-track` keeps working for the client; users who relied on it for the
server install `cairn`.

## 6. Pre-existing leftovers to remove first

Untracked, gitignored trees from the reverted 2026-08-27 split exist on
disk: `packages/cairn-{track,server,cli}` (`__pycache__` only) and
`apps/cairn-ui` (`dist/`, `node_modules/`). A `packages/*` workspace glob
fails on a member without `pyproject.toml`, and `git mv` into an existing
directory nests. They are deleted before any move.
