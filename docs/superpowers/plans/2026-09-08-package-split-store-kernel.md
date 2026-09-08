# Package Split with Storage Kernel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the cairn monolith into `cairn-store`, `cairn-track`, `cairn-server`, `cairn-ui`, `cairn-cli` and a `cairn` meta-package with a one-way dependency chain, the repository format owned and versioned by `cairn-store`, and no user-visible behaviour change.

**Architecture:** Pure directory moves with import rewrites, done in an order that keeps the tree importable and the test suite green after every task: the store is carved out first while the monolith still imports it; then the workspace is created and the remaining subpackages move one at a time; the CLI's server imports become lazy last. Every task ends with `uv sync`, `pytest` and the boundary lint passing.

**Tech Stack:** Python 3.10+, uv workspaces, hatchling, click, FastAPI; Node for the UI; pytest.

**Spec:** `docs/superpowers/specs/2026-09-08-package-split-store-kernel-design.md`

## Global Constraints

- Behaviour unchanged: local direct mode, local WAL mode, HTTP mode, `Reader` on a local path, `cairn server --ui`, `cairn ui --repo cairn://…`, `cairn sync`.
- Allowed import directions (module level): `cairn_store` → nothing cairn; `cairn` (track) → `cairn_store`, `cairn_plot`; `cairn_server` → `cairn_store`; `cairn_cli` → `cairn` at module level, `cairn_server` inside function bodies only; `cairn_ui` → nothing.
- `REPO_FORMAT` stays 3, `SCHEMA_VERSION` stays 2; existing repositories open unchanged.
- Files move with `git mv` so history follows; import rewrites are mechanical and listed in the task.
- After every task, from the repo root: `uv sync --all-packages --extra dev && uv run pytest -q -m "not torch and not slow"` and `uv run pytest -q tests/unit/test_package_boundaries.py`.
- Commit trailers on every commit:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_018R6F9Ys9R5Htmq6K7oL6gf`.

---

### Task 0: Baseline and inventory

**Files:** none changed; produces `docs/superpowers/plans/2026-09-08-package-split-inventory.md`.

- [ ] **Step 1:** From the repo root run `uv sync --extra dev && uv run pytest -q -m "not torch and not slow"` and record pass/fail counts and the list of pre-existing failures (the `PlotLeafSpec has no attribute renderer` family is known).
- [ ] **Step 2:** Generate the import inventory with a script (commit it as `scripts/import_inventory.py`): for every `.py` under `cairn/`, `tests/`, `examples/`, list `from cairn.X`/`import cairn.X` edges grouped by target subpackage (`sdk`, `server`, `server.storage`, `cli`, `config`, `plot`, `integrations`). Write the result to the inventory doc. It is the checklist Tasks 1–6 tick off.
- [ ] **Step 3:** Commit `Add the package-split import inventory`.

---

### Task 1: Carve out `cairn-store` inside the monolith

**Files:**
- Create: `cairn/store/__init__.py`, `cairn/store/datadir.py`, `blobs.py`, `db.py`, `migrations.py`, `ingest_ops.py`, `artifact_registry_ops.py`, `wal.py`, `common.py` (all via `git mv` from `cairn/server/storage/*.py`, `cairn/server/ingest_ops.py`, `cairn/server/artifact_registry_ops.py`, `cairn/server/wal_ingest.py`, and the pure functions of `cairn/server/routes/_common.py`)
- Modify: every importer of the moved modules (`cairn/server/**`, `cairn/sdk/**`, `cairn/cli.py`, tests, examples) — the inventory lists them
- Create: `tests/unit/test_store_open_repo.py`
- Keep: `cairn/server/storage/__init__.py` as a one-line re-export shim raising a `DeprecationWarning`? NO — delete it; rewrite importers. (Ruling: no shims inside the repo.)

**Interfaces (produced):**
```python
# cairn/store/__init__.py
REPO_FORMAT = 3
from .migrations import SCHEMA_VERSION, apply_migrations, hash_context
from .datadir import DataDir, RepoLockedError, default_data_dir, read_live_servers
from .blobs import BlobStore
from .db import Database
class RepoFormatError(RuntimeError): ...
@dataclass(frozen=True)
class Repo:
    data_dir: DataDir; db: Database; blobs: BlobStore
    def close(self) -> None: ...
def open_repo(root: str | Path, *, create: bool = True, migrate: bool = True) -> Repo: ...
```

- [ ] **Step 1: Tests first** (`tests/unit/test_store_open_repo.py`): `open_repo(tmp)` creates the tree, writes `version` == `str(REPO_FORMAT)`, returns a `Repo` whose `db` has `schema_version` == `SCHEMA_VERSION`; a second `open_repo` on the same root reuses it; `create=False` on a missing root raises `FileNotFoundError`; a `version` file containing `"99"` raises `RepoFormatError` whose message contains both `99` and `3`; `migrate=False` on a fresh root opens without applying migrations (assert `schema_version` table absent) — read `Database.open` first to see whether it always migrates; if so, add a `migrate` flag to `Database.open` in this task.
- [ ] **Step 2: Move** the modules with `git mv`; `_common.py`: move `slugify`, `utc_now`, `value_type`, `flatten` into `cairn/store/common.py` and make `routes/_common.py` import them from there (the FastAPI getters stay). Rewrite imports: `..server.storage.X` → `..store.X` (sdk), `.storage.X` → `..store.X` (server), `.ingest_ops`/`.artifact_registry_ops`/`.wal_ingest` → `..store.ingest_ops`/`..store.artifact_registry_ops`/`..store.wal` (server), `from .routes._common import flatten, slugify, utc_now, value_type` in the moved ops → `from .common import …`. `wal.py` must not import anything under `cairn/server`.
- [ ] **Step 3: `open_repo`** per the interface; switch `sdk/reader.py` `_LocalBackend.__init__`, `sdk/local.py` `LocalTransport.__init__`, and `cli.py` (`server_cmd`, `ui_cmd`, `init_cmd`) to it where they open a repo today (keep their lock handling as is).
- [ ] **Step 4: Boundary lint** extend `tests/unit/test_package_boundaries.py`: `cairn/store/**` imports nothing from `cairn.` except `cairn.store`; `cairn/server/**` never imports `cairn.sdk` (existing).
- [ ] **Step 5: Verify** the global commands; also `uv run cairn init /tmp/x && uv run python -c "from cairn.store import open_repo; open_repo('/tmp/x')"`. **Commit** `Carve the repository format into cairn.store`.

---

### Task 2: Workspace skeleton; `cairn-store` and `cairn-ui` become packages

**Files:**
- Create: `packages/cairn-store/pyproject.toml`, `packages/cairn-store/cairn_store/` (via `git mv cairn/store packages/cairn-store/cairn_store`)
- Create: `packages/cairn-ui/pyproject.toml`, `packages/cairn-ui/cairn_ui/__init__.py`, `packages/cairn-ui/hatch_build.py` (moved from root `hatch_build.py`, paths updated)
- Move: `cairn/ui` → `apps/cairn-ui` (`git mv`, excluding `node_modules`; `.gitignore` for `apps/cairn-ui/node_modules`); `apps/cairn-ui/vite.config.ts` `outDir: "../../packages/cairn-ui/cairn_ui/dist"`; `apps/cairn-ui/package.json` scripts that reference `../../vendor/cairn-plot` re-pointed (`smoke:plot`)
- Modify: root `pyproject.toml` → workspace (`[tool.uv.workspace] members = ["packages/*"]`, `[tool.uv.sources]` for `cairn-store`, `cairn-ui`, `cairn-plot`), keep the monolith's `[project]` for now (name `cairn-track`, depends on `cairn-store`, `cairn-ui` optional) so the tree still installs
- Modify: `cairn/server/app.py` `_resolve_ui_dist`: `CAIRN_UI_DIST` → `cairn_ui.dist_path()` (try/except ImportError) → `apps/cairn-ui/dist`? NO: dev builds now land in `packages/cairn-ui/cairn_ui/dist`, so the third fallback is unnecessary; keep only env → `cairn_ui` → placeholder
- Modify: all `cairn.store` importers → `cairn_store` (sed)
- Modify: `.github/workflows/ci.yml` UI job `working-directory: apps/cairn-ui`; python job `uv sync --all-packages --extra dev`

**Interfaces:** `cairn_ui.dist_path() -> Path`; `cairn_ui.__version__`.

- [ ] **Step 1:** Create both package pyprojects (hatchling; `cairn-store` deps `zstandard`, `platformdirs` — confirm by grepping the moved modules' imports; `cairn-ui` no deps, `artifacts = ["cairn_ui/dist/**/*"]`, hook path `hatch_build.py`).
- [ ] **Step 2:** Moves and rewrites as listed. `hatch_build.py` builds from `../../apps/cairn-ui` when `cairn_ui/dist/index.html` is missing.
- [ ] **Step 3:** `uv sync --all-packages --extra dev`; `uv run pytest`; `cd apps/cairn-ui && npm ci && npm run build` (dist lands in the package; commit it as today); `uv run cairn ui --no-open-browser` smoke: the placeholder must NOT appear (dist found via `cairn_ui`). Then `CAIRN_UI_DIST=/nonexistent` plus a venv without `cairn-ui` → placeholder page with the install hint (test in `tests/unit/test_ui_resolution.py` by monkeypatching `importlib` to fail `cairn_ui`).
- [ ] **Step 4: Commit** `Create the uv workspace with cairn-store and cairn-ui packages`.

---

### Task 3: `cairn-server` package

**Files:**
- Create: `packages/cairn-server/pyproject.toml`; `git mv cairn/server packages/cairn-server/cairn_server`
- Modify: all importers (`cairn/cli.py`, `cairn/sdk/elements.py` if it still touches the server — it should now import `cairn_store` only; tests; examples) `cairn.server.X` → `cairn_server.X`; inside the package `..store` → `cairn_store`, relative imports stay
- Modify: root `pyproject.toml` (`cairn-track` now depends on `cairn-store`, `cairn-plot`; NOT on `cairn-server`; add `cairn-server` to workspace sources); `cairn/cli.py` temporarily imports `cairn_server` at module level (Task 5 makes it lazy) — so for THIS task the monolith's `[project]` gets `cairn-server` in `dependencies` to keep `cairn` installable
- Modify: `tests/unit/test_package_boundaries.py` → table-driven over `packages/*` per spec §3.8

- [ ] **Step 1:** Move, rewrite, add `pyproject` (deps per spec §3.4; extras `ui`, `discovery`).
- [ ] **Step 2:** Boundary table: `cairn_store: []`, `cairn_server: ["cairn_store"]`, `cairn` (track, still at root for now): `["cairn_store", "cairn_plot", "cairn_server"]` TEMPORARILY (the cli still lives inside) — with a comment that Task 5 removes `cairn_server`.
- [ ] **Step 3:** Verify globals + integration tests (`tests/integration` use `create_app`). **Commit** `Move the server into the cairn-server package`.

---

### Task 4: `cairn-track` package

**Files:**
- Create: `packages/cairn-track/pyproject.toml` (name `cairn-track`, package dir `cairn/`); `git mv cairn packages/cairn-track/cairn` (what remains: `__init__.py`, `config.py`, `plot.py`, `cli.py`, `sdk/`, `integrations/`)
- Modify: root `pyproject.toml` becomes workspace-only (`[project] name = "cairn-workspace"` or the meta-package moves to `packages/cairn`, see Task 6); pytest config stays at root; `tests/` stay at root
- Modify: `packages/cairn-track/cairn/__init__.py` gains a `__getattr__` that raises `ImportError("cairn.server moved to cairn_server / cairn_store; install cairn-server")` for `server`

- [ ] **Step 1:** Move and configure. `cairn/cli.py` still inside track for one more task.
- [ ] **Step 2:** Verify; add `tests/unit/test_import_shim.py`: `import cairn.server` raises `ImportError` mentioning `cairn_server`. **Commit** `Move the client into the cairn-track package`.

---

### Task 5: `cairn-cli` package with lazy server imports

**Files:**
- Create: `packages/cairn-cli/pyproject.toml` (deps `cairn-track`, `click`; extras `server = ["cairn-server"]`, `ui = ["cairn-server[ui]"]`; script `cairn = cairn_cli.cli:main`); `git mv packages/cairn-track/cairn/cli.py packages/cairn-cli/cairn_cli/cli.py` + `__init__.py`
- Modify: `cli.py`: module-level server imports → a `_server()` helper (the archive's `_require_server` shape, c31741e7 `packages/cairn-cli/cairn_cli/cli.py:30-60`) used by `init_cmd`, `server_cmd`, `ui_cmd`, token commands; the proxy import in `ui_cmd` goes through it too
- Modify: `packages/cairn-track/pyproject.toml` drops the `cairn` script; boundary table: `cairn` → `["cairn_store", "cairn_plot"]`, `cairn_cli` → module-level `["cairn", "click"]`, function-level additionally `["cairn_server"]`
- Create: `tests/unit/test_cli_without_server.py`: with `cairn_server` made unimportable (monkeypatch `sys.modules["cairn_server"] = None` and reload), `cairn list --help` works and `cairn server` exits with the install hint

- [ ] **Step 1:** Move, rewrite, tests. Verify `uv run cairn --help`, `uv run cairn server --help`, `uv run cairn ui --help`. **Commit** `Move the command into cairn-cli with lazy server imports`.

---

### Task 6: Meta-package, release script, CI, docs

**Files:**
- Create: `packages/cairn/pyproject.toml` (name `cairn`, deps `cairn-track`, `cairn-server[ui]`, `cairn-cli`, all `==` the shared version; no code — hatchling needs at least one file: `packages/cairn/cairn_meta/__init__.py` with `__version__`? Prefer `[tool.hatch.build.targets.wheel] bypass-selection = true` — verify hatchling supports an empty wheel; else the tiny module)
- Create: `scripts/release.py` (`--version X.Y.Z` rewrites every `packages/*/pyproject.toml` `version` and the `cairn-*==` pins; `--check` verifies they agree) + `tests/unit/test_release_versions.py` (all members share one version; pins match)
- Modify: `.github/workflows/ci.yml`: add a `wheels` job: `uv build --all-packages`, then in a bare venv `pip install dist/cairn_track-*.whl dist/cairn_store-*.whl` (+ cairn-plot wheel from the submodule) and `python -c "import cairn, cairn.sdk.reader; import sys; assert 'cairn_server' not in sys.modules"`; then `pip install dist/cairn*.whl` and `cairn server --help`
- Modify: `README.md` install matrix; `docs/superpowers/specs/2026-08-27-cairn-refactor-design.md` §1b gets a pointer to this spec; `CAIRN_SPEC.md` if it names the wheel layout
- Modify: `uv.lock` regenerated

- [ ] **Step 1:** Implement; `uv run python scripts/release.py --check`; full test suite; `uv build --all-packages` locally and the bare-venv import proof.
- [ ] **Step 2: Commit** `Add the cairn meta-package, lockstep release script and wheel CI`.
