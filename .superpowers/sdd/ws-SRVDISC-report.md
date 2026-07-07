# WS-SRVDISC — Notebook card server auto-discovery

Branch `fix/notebook-server-discovery` (base `37fa0eac`). Fixes: a card built in a
notebook (`cairn.plot.*` → `CardElement`) couldn't find a locally-running `cairn ui`
and fell back to a noisy text notice, because `_resolve_server()` probed a FIXED port
(`config.DEFAULT_SERVER` = `http://localhost:4300`) while `cairn ui` defaults to 4301
and auto-increments when taken (the user landed on 4302/4303).

## Commits

- `de1a4813` Auto-discover a locally-running `cairn ui` for notebook cards
- `5c176cad` marimo demo: note card auto-discovery + robust `media_compare` cell
- `9b8adc72` Make server-discovery tests deterministic under stray local servers
- `9b231c8d` Thread a server-mode Reader's connected URL into cards

## Fix 1 — `cairn ui` advertises its serving URL

**File:** `<repo>/.cairn/servers.json` (i.e. `DataDir.servers_path`, alongside
`repo.lock`).

**Format:** a JSON **list** of entries, each
`{"pid", "mode", "host", "port", "started_at"}` — e.g.
`[{"pid": 61903, "mode": "ui", "host": "127.0.0.1", "port": 4303, "started_at": "...Z"}]`.

**Mechanism** (`cairn/server/storage/datadir.py`): new
`DataDir.add_live_server(mode, host=, port=)` / `remove_live_server()` and a
module-level `read_live_servers(root)`. `cairn ui` (`cli.py` `ui_cmd`) calls
`add_live_server("ui", host, port)` after binding its actual (possibly
auto-incremented) port, and `remove_live_server()` in its shutdown `finally`.

**Concurrent servers:** a **list**, not a single holder — unlike `repo.lock` (one
exclusive writer), WAL mode lets many `cairn ui` serve one repo concurrently, and
all are valid discovery targets. `add_live_server` drops any prior entry for the
same pid then appends (no dup accumulation). Writes are atomic (temp file +
`os.replace`).

**Stale/robustness:** `read_live_servers` prunes entries whose pid is no longer
alive (`psutil.pid_exists`) on every read, and returns `[]` on any I/O/parse error.
All writes are **best-effort** — `add_live_server`/`remove_live_server` swallow
`OSError`, so a read-only FS never prevents the server from starting. (Verified in
smoke: an abrupt kill left the entry on disk, but `read_live_servers` pruned the
dead pid → `[]`, self-healing.)

## Fix 2 + 3 — `CardElement._resolve_server()` consumes it (+ reader-server threading)

**File:** `cairn/sdk/elements.py`. Resolution order:

1. explicit `server=` — trusted, no probe.
2. **the source `Reader`'s own connected server** (`reader_server`, set when the
   reader was opened as `Reader(repo="cairn://host:port")`) — trusted, no probe:
   the reader queried this card's data from there, so the card renders there too.
   *(Fix 3 — closes the gap where an HTTP reader found runs but the card fell back
   to the dead `:4300` default.)*
3. configured `cairn://…` (`cairn.configure`/`CAIRN_REPO`/config file, via
   `config.resolve_target()`) — trusted, no probe.
4. **the repo's advertised `servers.json`** (health-probed `GET /api/health`,
   0.5 s timeout), newest `started_at` first. *(Fix 2 — the local-repo case.)*
5. last-resort fixed-port probes: `config.resolve_server()` (`:4300`) + `cairn ui`'s
   own `:4301` default.

**Repo-path / server threading:** `_LocalBackend.repo_path` and
`_HttpBackend.server_url` (new properties, `cairn/sdk/reader.py`) are plumbed by
`cairn/plot.py`'s `_card_element` (via `_repo_path_of` / `_server_url_of` off the
`DataRef.run._backend`) into `CardElement(repo_path=…, reader_server=…)`. So a plain
`Reader()`/local repo consults *that specific repo's* `servers.json`, and a
`cairn://` reader renders against its own server — neither needs global config.

## Fallback message de-noise (`elements.py` `_repr_html_`)

When still no server: the `<pre>` notice now (a) names the exact command
`cairn ui --repo <repo> --no-auth` (the repo interpolated when known), (b) lists the
explicit overrides (`cairn.configure(repo="cairn://localhost:PORT")`,
`CAIRN_REPO=cairn://localhost:PORT`, `server=`), and (c) moves the raw card-spec JSON
into a collapsed `<details><summary>spec (debug)</summary>` block instead of dumping
a wall of text inline. Never raises.

## marimo example (`examples/marimo_cairn_demo.py`)

Notes that live card rendering needs a `cairn ui` on the SAME repo, and that with
auto-discovery it "just works" once one is running — no port needed (`cairn ui --repo
<path> --no-auth`) — plus the explicit `cairn://host:port` override (and the warning
that a plain `http://` URL is read as a local *path*, not a server). The
`media_compare` cell now points at `image-comparison-demo`/`output` (real image data)
and falls back to a working `cairn.plot.figure` element from the section 2/3 run when
that project isn't seeded, so the cell is never dead. Headless run exits 0.

## Tests

- `test_datadir.py`: `add_live_server` writes `servers.json`; `read_live_servers`
  matches, prunes dead pid, handles missing/garbage file; own-stale-entry replaced;
  multiple concurrent servers all listed; `remove_live_server` drops only own entry;
  write failure never raises. (+10)
- `test_plot_elements.py`: `_resolve_server` prefers advertised `servers.json`
  (health-probed) over a dead default; stale (dead-pid) entry is pruned and never
  probed; builder threads `repo_path` and auto-discovers a live server end-to-end;
  `reader_server` from an HTTP reader beats a dead config; builder threads
  `reader_server` end-to-end (live iframe at the reader's port); fallback notice
  contains the command + collapses the spec. (+5)
- `test_report.py`: the existing "no server" test now also mocks `_probe` so a stray
  dev `cairn ui` on the fixed-fallback `:4301` can't defeat the assertion.

## Gates

- `uv run --extra dev pytest tests/unit -m "not slow"`: **15 failed, 498 passed, 3
  skipped**. All 15 failures are **pre-existing baseline** in files untouched by this
  behavior — `test_config`/`test_config_target` (`resolve_target(server=…)` kwarg
  doesn't exist → `TypeError`; config-precedence drift), `test_cli` (client commands
  exit 1 with no server on `:4300`), `test_local_transport` (`…writes_to_duckdb`, DB
  is SQLite now). Every new test passes.
- `test_cli_ui.py` (slow subprocess suite): **4 passed** — `cairn ui`/`cairn server`
  startup unaffected.
- The full `tests/unit` (incl. slow) once timed out under heavy machine load (many
  stray `cairn ui` from other worktrees); split into non-slow + `test_cli_ui`, both
  green.

## End-to-end smoke

Seeded `/tmp/cairn-srvdisc-smoke/.cairn` (via `demo_plot_helpers.py`), started
`cairn ui --repo … --no-auth` letting it **pick its own port** — it landed on **4303**
(4300/4301/4302 in use, exactly the reported scenario) and wrote
`servers.json` advertising `:4303`. Then in Python:

- **Case A (local repo, no config):** `Reader(repo="/tmp/…/.cairn")` → `cplot.scalar`
  → `_repr_html_()` returned a **LIVE `<iframe … :4303/embed/card?sid=…>`**, sid
  resolved `200`. Auto-discovered the real port via `servers.json`.
- **Case B (explicit `cairn://`):** `Reader(repo="cairn://localhost:4303")` → card
  rendered a **LIVE iframe at `:4303`** (`reader_server` threaded), sid resolved
  `200` — no `cairn.configure`/`CAIRN_REPO`.
- `marimo_cairn_demo.py` headless: **exit 0**.

Server stopped afterward; the leftover stale entry self-pruned on read.
