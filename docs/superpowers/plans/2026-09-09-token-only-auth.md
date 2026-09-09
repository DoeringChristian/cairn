# Token-only Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Authenticated requests resolve the principal by a hash lookup of the token carried in the `Authorization: Bearer` header or the `cairn_token` cookie, with no database write; the sessions table and its bookkeeping are gone.

**Architecture:** `auth.py` keeps tokens as the source of truth and loses sessions; one resolver `verify_token(db, plaintext) -> Principal | None` serves both carriers. The auth routes set/clear the cookie. The proxy's token mode drops its start-up cookie login. A destructive migration drops `sessions`.

**Tech Stack:** Python 3.10+, FastAPI, SQLite, pytest; TypeScript UI untouched.

**Spec:** `docs/superpowers/specs/2026-09-09-token-only-auth-design.md`

## Global Constraints

- Cookie name `cairn_token`; attributes `httponly=True, samesite="lax", secure=False, path="/"`; `max_age` = seconds until the token's `expires_at` when set (minimum 1), else `400 * 86400`.
- Header wins over cookie when both are present. Resolution never writes.
- Remove: `SESSION_COOKIE`, `SESSION_TTL_DAYS`, `SESSION_TTL_SECONDS`, `create_session`, `verify_session`, `delete_session`, `sweep_expired`, the `sessions` delete in `revoke_token`, the `last_used_at` write in `verify_bearer_token`. Keep the `tokens.last_used_at` column.
- `apply_migrations` runs `DROP TABLE IF EXISTS sessions` and `DROP INDEX IF EXISTS idx_sessions_token`; remove the `CREATE TABLE ... sessions` and its index from `SCHEMA_SQL`.
- `cairn/ui` is untouched. `vendor/cairn-plot` untouched.
- `uv run pytest tests/unit/test_auth.py tests/unit/test_ui_proxy.py tests/unit/test_cli_ui.py tests/unit/test_embed_specs_route.py tests/integration/test_api_query.py -q` green; the full-suite check `uv run pytest tests/unit -q --ignore=tests/unit/test_plot_components.py --ignore=tests/unit/test_plot_element_emit.py --ignore=tests/unit/test_plot_elements.py --ignore=tests/unit/test_plot_gallery_example.py --ignore=tests/unit/test_plot_spec_conformance.py` green (54 `test_plot_*` failures are pre-existing).
- Commit messages end with:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_018R6F9Ys9R5Htmq6K7oL6gf`.
- Never `git add -A`; named files only. The pre-commit hook rebuilds `cairn/ui/dist`; expected.

---

### Task 1: Core resolver, sessions removed, migration

**Files:**
- Modify: `cairn/server/auth.py`
- Modify: `cairn/server/storage/migrations.py`
- Modify: `cairn/cli.py` (`token list` output: drop `last_used_at` column)
- Test: `tests/unit/test_auth.py`, `tests/unit/test_migrations.py` (create if absent)

**Interfaces:**
- Produces: `AUTH_COOKIE = "cairn_token"`; `verify_token(db, plaintext) -> Principal | None` (pure read; header and cookie both use it); `cookie_max_age(db, token_id) -> int`; `_principal_from_request(request)` reads `Authorization: Bearer` first, then `request.cookies.get(AUTH_COOKIE)`; `verify_bearer_token` stays as a thin alias of `verify_token` for the CLI banner and login route.
- Consumes: nothing new.

- [ ] **Step 1: Failing tests** — in `tests/unit/test_auth.py` replace the session tests (`create_session`/`verify_session`/expiry/"session outlives token" cases) with:

```python
def _authed_get(client, path, *, bearer=None, cookie=None):
    headers = {"Authorization": f"Bearer {bearer}"} if bearer else {}
    cookies = {"cairn_token": cookie} if cookie else {}
    return client.get(path, headers=headers, cookies=cookies)


def test_header_and_cookie_resolve_same_principal(auth_env):
    db, client, tokens = auth_env  # match the fixture's real shape
    plain = tokens["read"]
    assert _authed_get(client, "/api/runs", bearer=plain).status_code == 200
    assert _authed_get(client, "/api/runs", cookie=plain).status_code == 200
    assert _authed_get(client, "/api/runs").status_code == 401


def test_header_wins_over_cookie(auth_env):
    db, client, tokens = auth_env
    r = client.get("/api/auth/session", headers={"Authorization": f"Bearer {tokens['admin']}"}, cookies={"cairn_token": tokens["read"]})
    assert r.json()["role"] == "admin"


def test_disabled_and_expired_tokens_fail_on_both_carriers(auth_env):
    db, client, tokens = auth_env
    from cairn.server import auth
    tid, plain = auth.create_token(db, name="short", role="read", expires_at=auth._iso_in(-1))
    assert _authed_get(client, "/api/runs", bearer=plain).status_code == 401
    assert _authed_get(client, "/api/runs", cookie=plain).status_code == 401
    tid2, plain2 = auth.create_token(db, name="gone", role="read")
    assert auth.revoke_token(db, tid2)
    assert _authed_get(client, "/api/runs", cookie=plain2).status_code == 401


def test_stale_session_cookie_is_ignored(auth_env):
    db, client, tokens = auth_env
    assert client.get("/api/runs", cookies={"cairn_session": "0" * 64}).status_code == 401


def test_authenticated_read_never_writes(auth_env, monkeypatch):
    db, client, tokens = auth_env
    writes = []
    orig_write, orig_tx = db.write, db.transaction
    monkeypatch.setattr(db, "write", lambda *a, **k: (writes.append(a), orig_write(*a, **k)))
    monkeypatch.setattr(db, "transaction", lambda *a, **k: (writes.append(("tx",)), orig_tx(*a, **k))[1])
    assert _authed_get(client, "/api/runs", cookie=tokens["read"]).status_code == 200
    assert _authed_get(client, "/api/runs", bearer=tokens["read"]).status_code == 200
    assert writes == []


def test_no_session_symbols_remain():
    from cairn.server import auth
    for name in ("create_session", "verify_session", "delete_session", "sweep_expired", "SESSION_COOKIE", "SESSION_TTL_SECONDS"):
        assert not hasattr(auth, name), name
```

and `tests/unit/test_migrations.py`:

```python
import sqlite3

from cairn.server.storage.migrations import apply_migrations


def test_sessions_table_is_dropped(tmp_path):
    con = sqlite3.connect(tmp_path / "x.db")
    con.execute("CREATE TABLE sessions (id TEXT PRIMARY KEY, token_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL)")
    con.execute("CREATE INDEX idx_sessions_token ON sessions(token_id)")
    con.commit()
    apply_migrations(con)
    names = {r[0] for r in con.execute("SELECT name FROM sqlite_master")}
    assert "sessions" not in names and "idx_sessions_token" not in names
    assert "tokens" in names
```

Read the real `auth_env` fixture (`tests/unit/test_auth.py:60-68`) and adapt the unpacking to its actual return shape; keep every other existing test that does not concern sessions (token CRUD, OTP, SSH, authorized_keys, local token reuse). Existing tests that asserted `last_used_at` advances are deleted.

- [ ] **Step 2: Run** — `uv run pytest tests/unit/test_auth.py tests/unit/test_migrations.py -q` → FAIL.

- [ ] **Step 3: Implement**

`auth.py`:
- `AUTH_COOKIE = "cairn_token"`; delete the session constants.
- `verify_token(db, plaintext)`: the body of today's `verify_bearer_token` (`:149-170`) minus the `last_used_at` write; `verify_bearer_token = verify_token` kept as an alias (callers: `routes/auth.py:52`, `cli.py:160`).
- `cookie_max_age(db, token_id) -> int`: read `expires_at`; `max(1, int((expires - now).total_seconds()))` when set, else `400 * 86400`.
- `_principal_from_request`: Bearer header → `verify_token`; else `request.cookies.get(AUTH_COOKIE)` → `verify_token`; else `None`.
- `revoke_token`: drop the `DELETE FROM sessions` statement (keep the transaction).
- Delete `create_session`, `verify_session`, `delete_session`, `sweep_expired`. Update the module docstring (`:1-19`) to describe the token-only model and the no-write rule.

`migrations.py`: remove the `sessions` table and `idx_sessions_token` from `SCHEMA_SQL`; in `apply_migrations`, after the additive statements, execute `DROP INDEX IF EXISTS idx_sessions_token` and `DROP TABLE IF EXISTS sessions`, with a comment that this is the one destructive step and why it is safe (ephemeral rows, no references).

`cli.py` `token list` (`:929-951`): remove the `last_used_at` column from the printed table.

- [ ] **Step 4: Run** — the two files green; then `uv run pytest tests/unit -q -k "auth or migration or token"`.

- [ ] **Step 5: Commit** — `git add cairn/server/auth.py cairn/server/storage/migrations.py cairn/cli.py tests/unit/test_auth.py tests/unit/test_migrations.py` ; message "Resolve auth from a static token; drop sessions".

---

### Task 2: Routes set and clear the token cookie; proxy token mode without cookie login

**Files:**
- Modify: `cairn/server/routes/auth.py`
- Modify: `cairn/server/proxy.py`
- Modify: `cairn/server/app.py:213-215` (delete the stale WebSocket comment)
- Test: `tests/unit/test_auth.py` (route tests), `tests/unit/test_ui_proxy.py`

**Interfaces:**
- Consumes: `AUTH_COOKIE`, `verify_token`, `cookie_max_age` (Task 1).
- Produces: `_set_auth_cookie(response, db, token_id, plaintext)` in `routes/auth.py`.

- [ ] **Step 1: Failing tests**

```python
def test_login_sets_token_cookie_and_logout_clears_it(auth_env):
    db, client, tokens = auth_env
    r = client.post("/api/auth/login", json={"token": tokens["write"]})
    assert r.status_code == 200 and r.json() == {"name": "write", "role": "write"}  # adapt names to the fixture
    assert r.cookies.get("cairn_token") == tokens["write"]
    assert "cairn_session" not in r.cookies
    assert client.get("/api/runs").status_code == 200  # TestClient keeps the jar
    r = client.post("/api/auth/logout")
    assert r.status_code == 200
    assert client.get("/api/runs").status_code == 401


def test_session_route_reports_principal_from_either_carrier(auth_env):
    db, client, tokens = auth_env
    assert client.get("/api/auth/session").json()["authenticated"] is False
    assert client.get("/api/auth/session", headers={"Authorization": f"Bearer {tokens['read']}"}).json()["role"] == "read"
    assert client.get("/api/auth/session", cookies={"cairn_token": tokens["read"]}).json()["authenticated"] is True


def test_otp_exchange_sets_token_cookie(auth_env):
    db, client, tokens = auth_env
    from cairn.server import auth
    tid = auth.get_token(db, "read")["id"]  # adapt to the fixture's token names
    otp = auth.create_otp(db, tid)
    r = client.post("/api/auth/otp", json={"otp": otp})
    assert r.status_code == 200 and r.cookies.get("cairn_token")
    assert client.get("/api/runs").status_code == 200


def test_cookie_max_age_follows_token_expiry(auth_env):
    db, client, tokens = auth_env
    from cairn.server import auth
    tid, plain = auth.create_token(db, name="hourly", role="read", expires_at=auth._iso_in(3600))
    r = client.post("/api/auth/login", json={"token": plain})
    set_cookie = r.headers["set-cookie"]
    assert "Max-Age=" in set_cookie
    age = int(set_cookie.split("Max-Age=")[1].split(";")[0])
    assert 3500 <= age <= 3600
```

Proxy (`tests/unit/test_ui_proxy.py`, follow the file's existing mock-transport style): token mode start-up performs `GET /api/auth/session` with `Authorization: Bearer <token>` and never `POST /api/auth/login`; when that probe returns `authenticated: false` start-up raises `RuntimeError` mentioning `CAIRN_TOKEN`; browser mode rewrites an upstream `Set-Cookie: cairn_token=...` to the local origin and relays the cookie back.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

`routes/auth.py`:
- `_set_auth_cookie(response, db, token_id, plaintext)`: `response.set_cookie(key=auth.AUTH_COOKIE, value=plaintext, httponly=True, samesite="lax", secure=False, max_age=auth.cookie_max_age(db, token_id), path="/")`.
- `/login`: `verify_token` → `_set_auth_cookie` (no `create_session`). `/otp`: `consume_otp` yields the token id; look up the plaintext? — the OTP flow only knows the token id, not the plaintext. Ruling: `consume_otp` must return enough to set the cookie. Since plaintext is never stored, mint the cookie value from the OTP path as follows: `create_otp` stores, alongside the token id, an encrypted-at-rest copy? No — simpler and consistent with the spec: OTP and SSH-verify **mint a fresh token** for the browser (`create_token(db, name=f"{base}-browser-{short}", role=role)`) and set its plaintext as the cookie. The SSH flow already mints (`:186`); OTP now does the same, with the minted token carrying the OTP's token role. `cairn token list` shows these browser tokens and `revoke` removes them individually — this is the per-browser revocation the user asked for ("user is responsible for clearing tokens").
- `/logout`: `response.delete_cookie(auth.AUTH_COOKIE, path="/")` only.
- `/session`: principal via `auth._principal_from_request(request)` (make it public as `principal_from_request`); response shape unchanged.
- `/ssh/verify`: set the cookie with the minted token's plaintext.

`proxy.py` `lifespan` (`:142-154`): replace the session-probe + login with one `GET /api/auth/session` carrying `Authorization: Bearer {token}`; raise `RuntimeError(f"remote Cairn rejected CAIRN_TOKEN")` when `auth_enabled` and not `authenticated`. Cookie rebinding (`_local_cookie`) keys on the `Set-Cookie` name generically already — verify it handles `cairn_token`. Update comments mentioning `cairn_session`.

`app.py:213-215`: delete the stale WebSocket comment.

- [ ] **Step 4: Run** — the constraint's test list green; full-suite check green.

- [ ] **Step 5: Commit** — `git add cairn/server/routes/auth.py cairn/server/proxy.py cairn/server/app.py tests/unit/test_auth.py tests/unit/test_ui_proxy.py`; message "Token cookie at login; proxy authenticates with the bearer header".

---

### Task 3: Docs

**Files:**
- Modify: `.superpowers/sdd/spec-auth.md` is git-ignored scratch — do not edit. Instead: `CAIRN_SPEC.md` auth lines (`:15`, `:672`, `:994`) → one short paragraph describing token-only auth (header or cookie, hash lookup, revoke via CLI, no sessions); `docs/` — grep `cairn_session|session cookie|sliding` and fix every hit.

- [ ] **Step 1:** apply the edits; `grep -rn "cairn_session\|verify_session\|create_session" cairn/ docs/ CAIRN_SPEC.md` → no hits outside git history.
- [ ] **Step 2: Commit** — message "Document token-only auth".
