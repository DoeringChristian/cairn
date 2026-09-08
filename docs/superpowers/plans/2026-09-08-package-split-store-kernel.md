# Package Split with Storage Kernel — Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the cairn monolith into `cairn-store`, `cairn-track`, `cairn-server`, `cairn-ui`, `cairn-cli` and a `cairn` meta-package with a one-way dependency chain, the repository format owned and versioned by `cairn-store` (including the WAL writer), and no user-visible behaviour change except three fixed defects (dropped WAL artifact-registry ops, project-id rule drift, downward schema re-stamp).

**Architecture:** Three tasks, each leaving the tree installable and the suite green: (1) the UI becomes its own wheel and the server's optional dependency, touching nothing in the store; (2) the store kernel is carved out in place with its entry points, WAL ownership and version checks; (3) one mechanical move creates the workspace and the five packages plus the meta-package, lazy CLI imports and the boundary lint. No commit declares a dependency edge that will not ship.

**Tech Stack:** Python 3.10+, uv 0.12 workspaces, hatchling, click, FastAPI; Node for the UI; pytest.

**Spec:** `docs/superpowers/specs/2026-09-08-package-split-store-kernel-design.md` (v2)

## Global Constraints

- Behaviour unchanged except the three defects the spec names: local direct mode, local WAL mode, HTTP mode, `Reader` on a local path, `cairn server --ui`, `cairn ui --repo cairn://…`, `cairn sync`, `cairn init` on a client-only install.
- Allowed import directions (module level): `cairn_store` → nothing cairn; `cairn` (track) → `cairn_store`, `cairn_plot`; `cairn_server` → `cairn_store`; `cairn_cli` → `cairn`, `cairn_store` at module level and `cairn_server` inside function bodies only; `cairn_ui` → nothing. Nothing server-side is evaluated at CLI import time.
- A WAL-mode client never opens SQLite (`open_layout`, not `open_repo`).
- `REPO_FORMAT` stays 3, `SCHEMA_VERSION` stays 2; existing repositories open unchanged. `apply_migrations` never re-stamps downward.
- Files move with `git mv`; the stale untracked `packages/` and `apps/` trees are deleted first.
- After every task, from the repo root: `uv sync --all-packages --extra dev` (Task 1: `uv sync --extra dev`), `uv run pytest -q -m "not torch and not slow"`, `uv run pytest -q tests/unit/test_package_boundaries.py`, and `uv build` of every package that exists at that point.
- Commit trailers on every commit:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_018R6F9Ys9R5Htmq6K7oL6gf`.

---

### Task 1: `cairn-ui` wheel; the UI becomes the server's optional dependency

**Files:**
- Delete (untracked): `apps/cairn-ui/`, `packages/cairn-track/`, `packages/cairn-server/`, `packages/cairn-cli/` (`rm -rf`; verify `git status` stays clean).
- Move: `git mv cairn/ui apps/cairn-ui` (node_modules is untracked and stays behind: delete `cairn/ui/node_modules` after the move, `npm ci` in the new place).
- Create: `packages/cairn-ui/pyproject.toml` (name `cairn-ui`, hatchling, no dependencies, `[tool.hatch.build.targets.wheel] packages = ["cairn_ui"]`, `artifacts = ["cairn_ui/dist/**/*"]`, `[tool.hatch.build.targets.wheel.hooks.custom] path = "hatch_build.py"`), `packages/cairn-ui/cairn_ui/__init__.py` (`__version__`, `def dist_path() -> Path: return Path(__file__).resolve().parent / "dist"`), `packages/cairn-ui/hatch_build.py` (moved from the root; builds from `../../apps/cairn-ui` when `cairn_ui/dist/index.html` is missing; `npm ci` when `node_modules` is missing; env `CAIRN_SKIP_UI_BUILD` kept).
- Move dist: `git mv apps/cairn-ui/dist packages/cairn-ui/cairn_ui/dist` (329 tracked files, 18 MB, a rename commit).
- Modify: `apps/cairn-ui/vite.config.ts` `outDir: "../../packages/cairn-ui/cairn_ui/dist", emptyOutDir: true` (the `../../vendor/cairn-plot` references in `package.json`, `vite.config.ts`, `tsconfig.app.json` stay valid at the same depth).
- Modify: `.gitignore`: replace the five `cairn/ui/*` patterns (lines ~24-36) with `apps/cairn-ui/` equivalents, and add `!packages/cairn-ui/cairn_ui/dist/` next to the global `dist/` rule (line 8) — without it rebuilt assets silently stop being tracked. Tell the user `.git/info/exclude` line 1 (`cairn/ui/node_modules`) is local and stale.
- Modify: root `pyproject.toml`: remove `artifacts = ["cairn/ui/dist/**/*"]` and the `hooks.custom` block; sdist `exclude` `cairn/ui/dist` → `apps/cairn-ui/dist`; coverage `omit` `cairn/ui/*` → drop; add `[tool.uv.workspace] members = ["packages/cairn-ui"]` and `[tool.uv.sources] cairn-ui = { workspace = true }`; add `cairn-ui` to `[project.optional-dependencies] ui = ["cairn-ui"]` and to `dev`.
- Modify: `cairn/server/app.py` `_resolve_ui_dist` (~233-241): order `CAIRN_UI_DIST` env → `cairn_ui.dist_path()` inside `try/except ImportError` → `None`; `_mount_spa_or_placeholder` shows the placeholder with the hint `pip install cairn-server[ui]` when `None` or `index.html` missing; the docstring at ~236 updated.
- Modify: `.github/workflows/ci.yml` UI job `working-directory: apps/cairn-ui`, `cache-dependency-path: apps/cairn-ui/package-lock.json`; python job `uv sync --all-packages --extra dev`.
- Modify tests: `tests/unit/test_plot_route.py:19` `_UI_DIST = cairn_ui.dist_path()` and turn the `skipif` into a hard assertion in the workspace; `tests/unit/test_ui_cairn_plot_card_contract.py:7-16` `cairn/ui/src` → `apps/cairn-ui/src`; new `tests/unit/test_ui_resolution.py`: with `cairn_ui` made unimportable (`monkeypatch.setitem(sys.modules, "cairn_ui", None)`) and no env, `create_app()`'s `/` returns the placeholder containing `cairn-server[ui]`; with `CAIRN_UI_DIST` pointing at a temp dir holding an `index.html`, that file is served.
- Docstring/doc references to `cairn/ui`: `tests/unit/test_card_spec_conformance.py:4`, `tests/unit/test_plot_route.py:8`, `cairn/sdk/card_spec.py:4,79`, `cairn/sdk/elements.py:58`, `examples/demo_run_selector.py:1`, `docs/cards-style-guide.md`, `docs/notes/smoke-plot-gallery.md`, `README.md` → `apps/cairn-ui`.

- [ ] **Step 1:** Tests first (`test_ui_resolution.py`, the two path fixes). Run: they fail.
- [ ] **Step 2:** Deletions, moves, package, config, resolver, CI, docs as listed.
- [ ] **Step 3:** `cd apps/cairn-ui && npm ci && npm run build` (dist lands in the package; `git status` shows it tracked because of the negation); `uv sync --extra dev`; pytest; `uv build packages/cairn-ui` and inspect the wheel contains `cairn_ui/dist/index.html`; `uv run cairn ui --no-open-browser` prints no placeholder (stop it).
- [ ] **Step 4: Commit** `Make the UI its own wheel and the server's optional dependency`.

---

### Task 2: Carve out `cairn.store` in place

**Files:**
- Create via `git mv`: `cairn/store/datadir.py` ← `cairn/server/storage/datadir.py`; `blobs.py`, `db.py`, `migrations.py` likewise; `cairn/store/ingest_ops.py` ← `cairn/server/ingest_ops.py`; `cairn/store/artifact_registry_ops.py` ← `cairn/server/artifact_registry_ops.py`; `cairn/store/wal.py` ← `cairn/server/wal_ingest.py`.
- Create: `cairn/store/__init__.py`, `cairn/store/common.py` (the pure four functions moved out of `cairn/server/routes/_common.py`, which keeps `get_db`, `get_data_dir`, `get_blobs`, `require_run` and imports the four from the store).
- Delete: `cairn/server/storage/__init__.py` (no shim).
- Modify importers: server (`.storage.X` → `..store.X`; `.ingest_ops`/`.artifact_registry_ops`/`.wal_ingest` → `..store.ingest_ops`/`..store.artifact_registry_ops`/`..store.wal`; inside the moved ops `from .routes._common import …` → `from .common import …`; `wal.py:63`'s function-level `from .ingest_ops import utc_now` → `from .common import utc_now`), sdk (23 statements in `local.py`, `run.py`, `reader.py`, `elements.py`), `cli.py`, tests (`storage.datadir/db/blobs/migrations`, `wal_ingest`, `ingest_ops` → `cairn.store.*`), examples (9 files), `CAIRN_SPEC.md:1034`.
- Create tests: `tests/unit/test_store_open_repo.py`, `tests/unit/test_store_wal_ops.py`, `tests/unit/test_store_versioning.py`.

**Interfaces (produced, consumed by Task 3 unchanged):**
```python
# cairn/store/__init__.py
REPO_FORMAT = 3
class RepoFormatError(RuntimeError): ...
@dataclass(frozen=True)
class Layout: data_dir: DataDir; blobs: BlobStore
@dataclass(frozen=True)
class Repo(Layout): db: Database
    def close(self) -> None
def open_layout(root: str | Path, *, create: bool = True) -> Layout
def open_repo(root: str | Path, *, create: bool = True, migrate: bool = True) -> Repo
from .migrations import SCHEMA_VERSION, apply_migrations, hash_context
from .datadir import DataDir, RepoLockedError, default_data_dir, read_live_servers
from .blobs import BlobStore
from .db import Database
# cairn/store/wal.py
WAL_FORMAT = 1
OPS: dict[str, Callable[[Database, DataDir, BlobStore, dict], None]]   # one table: op name → apply
class WalWriter:                       # replaces sdk/local.py::_wal_write
    def __init__(self, path: Path): ...  # writes the {"wal_format": 1} header on a new file
    def write(self, op: str, payload: dict) -> int   # op must be in OPS; fsync
def ingest_wal(db, data_dir, blobs, wal_path) -> int
def ingest_all(db, data_dir, blobs, *, require_unlocked: bool = False) -> int
```

- [ ] **Step 1: Tests first.**
  `test_store_open_repo.py`: `open_layout(tmp)` creates the tree and writes `version == "3"` and opens NO sqlite (patch `sqlite3.connect` to raise); `open_repo(tmp)` returns a `Repo` whose `db` has `schema_version == SCHEMA_VERSION`; `open_repo(tmp, migrate=False)` on a fresh tree leaves `schema_version` absent (uses `Database(path)`, not `Database.open`); `create=False` on a missing root raises `FileNotFoundError`; marker `"99"` raises `RepoFormatError` whose message contains `99` and `3`; marker `"2"` raises `RepoFormatError` (no upgrade registered).
  `test_store_versioning.py`: a DB stamped `SCHEMA_VERSION + 1` makes `apply_migrations` raise `RepoFormatError` and leaves the stamp untouched; two threads calling `apply_migrations` on a fresh DB both succeed and the stamp is written once (the `BEGIN IMMEDIATE` guard).
  `test_store_wal_ops.py`: `set(OPS) == {every op name WalWriter accepts}` (derive the writer's accepted names from the same table so the test is a tautology-check in the right direction: assert the READER handles `create_artifact_version` and `record_artifact_input`, the two ops dropped today); round-trip: write every op with a representative payload through `WalWriter`, `ingest_wal` it, and assert the rows exist (run, params, points, logs, artifact, artifact version, artifact input); a file whose header says `{"wal_format": 99}` is renamed `*.unknown-format` and yields 0; a header-less file is read as format 1; `project_id` from a WAL `create_run` equals `slugify(project)` (the drift fix).
- [ ] **Step 2: Move and rewrite** as listed; implement `__init__.py`, `common.py`; in `wal.py` build `OPS` from the existing dispatch branches (add the two missing ones by delegating to `artifact_registry_ops`), the header, the quarantine rename, `require_unlocked` (skip and warn when `read_live_servers`/`read_lock` shows a live server); in `migrations.py` the newer-stamp refusal and `BEGIN IMMEDIATE`; `datadir.py` reads the marker via `open_layout` (the marker write stays where it is).
- [ ] **Step 3: Switch callers.** `sdk/local.py`: direct mode `open_repo`, WAL mode `open_layout` + `WalWriter` (delete `_wal_write` and `_wal_seq`; `project_id` via `slugify`); `sdk/reader.py` `_LocalBackend`: `open_repo` and `ingest_all(..., require_unlocked=True)`; `sdk/run.py` imports `RepoLockedError`/`DataDir` from `..store`; `cli.py` `init_cmd`, `server_cmd`, `ui_cmd`: `open_repo` where they open the DB today (lock handling untouched).
- [ ] **Step 4: Boundary lint** extend `tests/unit/test_package_boundaries.py`: `cairn/store/**` imports nothing under `cairn.` except `cairn.store`, and no third-party module besides `psutil`; server never imports sdk (existing).
- [ ] **Step 5: Verify** globals; plus a manual local-mode round trip: `uv run python -c "import cairn; r = cairn.Run(project='p', repo='/tmp/r1', local_wal=True); r.log({'a': 1}); r.finish()"` then `uv run python -c "from cairn.sdk.reader import Reader; print(Reader('/tmp/r1').runs())"` (adapt to the real API after reading `Run` and `Reader`). **Commit** `Carve the repository format into cairn.store with WAL ownership and version checks`.

---

### Task 3: The workspace: five packages, meta-package, lazy CLI, lint, CI

**Files:**
- Create: `packages/cairn-store/pyproject.toml` (deps `psutil>=5.9`); `git mv cairn/store packages/cairn-store/cairn_store`.
- Create: `packages/cairn-server/pyproject.toml` (deps `cairn-store`, `fastapi`, `uvicorn[standard]`, `pydantic`, `httpx`, `python-multipart`, `psutil`; extras `ui = ["cairn-ui"]`, `discovery = ["zeroconf"]`); `git mv cairn/server packages/cairn-server/cairn_server`.
- Create: `packages/cairn-cli/pyproject.toml` (deps `cairn-track`, `cairn-store`, `click`; extras `server = ["cairn-server"]`, `ui = ["cairn-server[ui]"]`; `[project.scripts] cairn = "cairn_cli.cli:main"`); `git mv cairn/cli.py packages/cairn-cli/cairn_cli/cli.py` + `__init__.py`.
- Create: `packages/cairn-track/pyproject.toml` (name `cairn-track`, package `cairn`, deps `cairn-store`, `cairn-plot>=0.1,<0.2`, plus today's client deps; extras `media`, `hf`, `discovery`); `git mv cairn packages/cairn-track/cairn` (what remains: `__init__.py`, `config.py`, `plot.py`, `sdk/`, `integrations/`).
- Create: `packages/cairn/pyproject.toml` (name `cairn`, deps `cairn-track==V`, `cairn-server[ui]==V`, `cairn-cli==V`; `[tool.hatch.build.targets.wheel] bypass-selection = true`, verified to produce a code-free wheel).
- Modify: root `pyproject.toml` → workspace only (`[tool.uv] package = false`; `[tool.uv.workspace] members = ["packages/*"]`; `[tool.uv.sources]` for the five members and `cairn-plot = { path = "vendor/cairn-plot", editable = true }`; `[dependency-groups] dev = [...]` from today's `dev` extra; pytest and coverage config stay).
- Rewrite imports: `cairn.store.*` → `cairn_store.*`; `cairn.server.*` → `cairn_server.*` (tests: `app`, `auth`, `proxy`, `advertise`, `query_grammar`, `query_resolver`, `_operators`; `tests/conftest.py:14-17`); inside `cairn_server`: `..store` → `cairn_store`; inside `cairn_cli`: `.config`/`.sdk.*` → `cairn.config`/`cairn.sdk.*`.
- `cli.py`: `_server()` helper (a function that imports `cairn_server.auth`, `cairn_server.app.create_app`, `cairn_server.proxy.create_proxy_app`, `cairn_server.advertise` and returns a namespace, raising `click.ClickException("… pip install cairn-cli[server]")` on `ImportError`); used by `server_cmd`, `ui_cmd`, `_print_access_banner`, `token_*_cmd`, `_token_db`; `init_cmd` and `_ensure_repo` use `cairn_store` directly; the decorator `type=click.Choice(_auth.ROLES)` at ~904 becomes `click.Choice(ROLES)` with `ROLES = ("read", "write", "admin")` — read `cairn_server/auth.py:41` for the real tuple — pinned by `tests/unit/test_cli_roles.py` asserting equality with `cairn_server.auth.ROLES`.
- `packages/cairn-track/cairn/__init__.py`: extend the existing PEP 562 `__getattr__` so `from cairn import server` raises `ImportError("cairn.server moved: storage is cairn_store, the server is cairn_server (pip install cairn-server)")`.
- Tests: `tests/unit/test_package_boundaries.py` rewritten table-driven over `packages/*` with the function-scope exception for `cairn_cli` (AST walk: an `Import`/`ImportFrom` whose nearest enclosing node is a `FunctionDef`); `tests/unit/test_plot_import_purity.py` `cairn.server*` → `cairn_server*` and `sys.path` root → workspace-installed packages; `tests/unit/test_cli_without_server.py` (`monkeypatch.setitem(sys.modules, "cairn_server", None)` before importing `cairn_cli.cli`; `cairn --help` and `cairn list --help` succeed; `cairn server` exits non-zero with the hint); `tests/unit/test_import_shim.py` (`from cairn import server` raises `ImportError` matching `cairn_server`).
- CI: `uv sync --all-packages --extra dev`; new `wheels` job: `uv build --all-packages` and `uv build vendor/cairn-plot`; bare venv: install `cairn_store`, `cairn_plot`, `cairn_track` wheels → `python -c "import cairn, cairn.sdk.reader, sys; assert 'cairn_server' not in sys.modules"` and `python -c "import fastapi"` must fail; install `cairn_cli` → `cairn init /tmp/x && cairn list --help`; install `cairn_server` (no `[ui]`) → `python -c` boots `create_app()` and asserts the placeholder at `/`; install `cairn_ui` and the meta `cairn` wheel → `cairn server --help`.
- Docs: `README.md` install matrix (client only / + server / + UI / everything = `pip install cairn`); `docs/superpowers/specs/2026-08-27-cairn-refactor-design.md` §1b pointer; `CAIRN_SPEC.md` wheel layout if named.
- `uv.lock` regenerated.

- [ ] **Step 1: Tests first** (the four new/rewritten test files) — they fail on the monolith layout.
- [ ] **Step 2:** Moves, pyprojects, rewrites, `_server()`, shim, CI, docs.
- [ ] **Step 3: Verify** globals; `uv run cairn --help`, `uv run cairn server --help`, `uv run cairn ui --help`, `uv run cairn init /tmp/x`; `uv build --all-packages`; the bare-venv sequence from the CI job locally.
- [ ] **Step 4: Commit** `Split cairn into store, track, server, ui, cli and a meta-package`.
