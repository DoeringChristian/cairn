# Token-only Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Authenticated requests resolve the principal by a hash lookup of the token carried in the `Authorization: Bearer` header or the `cairn_token` cookie, with no database write; the sessions table and its bookkeeping are gone.

**Architecture:** `auth.py` keeps tokens as the source of truth and loses sessions; one resolver `verify_token(db, plaintext) -> Principal | None` serves both carriers. The auth routes set/clear the cookie. The proxy's token mode drops its start-up cookie login. A destructive migration drops `sessions`.

**Tech Stack:** Python 3.10+, FastAPI, SQLite, pytest; TypeScript UI untouched.

**Spec:** `docs/superpowers/specs/2026-09-09-token-only-auth-design.md`

## Global Constraints

- Cookie name `cairn_token`; attributes `httponly=True, samesite="lax", secure=False, path="/"`; `max_age` = seconds until the token's `expires_at` when set (minimum 1), else `400 * 86400`.
- Header wins over cookie when both are present. Resolution never writes.
- Remove: `SESSION_COOKIE`, `SESSION_TTL_DAYS`, `SESSION_TTL_SECONDS`, `create_session`, `verify_session`, `delete_session`, the `sessions` delete in `revoke_token`, the `last_used_at` write in `verify_bearer_token`. Keep the `tokens.last_used_at` column. KEEP `sweep_expired` (it is the only GC for `auth_otp` and `auth_nonces`; `sessions` was its third table): drop only its `sessions` DELETE and call it from `create_otp` and `create_nonce` (mint paths, never the read path).
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
    app, client, tokens = auth_env  # fixture yields (app, TestClient, {role: plaintext}); tokens are named f"{role}-token"
    db = app.state.db
    plain = tokens["read"]
    assert _authed_get(client, "/api/runs", bearer=plain).status_code == 200
    assert _authed_get(client, "/api/runs", cookie=plain).status_code == 200
    assert _authed_get(client, "/api/runs").status_code == 401


def test_header_wins_over_cookie(auth_env):
    app, client, tokens = auth_env
    db = app.state.db
    r = client.get("/api/auth/session", headers={"Authorization": f"Bearer {tokens['admin']}"}, cookies={"cairn_token": tokens["read"]})
    assert r.json()["role"] == "admin"


def test_disabled_and_expired_tokens_fail_on_both_carriers(auth_env):
    app, client, tokens = auth_env
    db = app.state.db
    from cairn.server import auth
    tid, plain = auth.create_token(db, name="short", role="read", expires_at=auth._iso_in(-1))
    assert _authed_get(client, "/api/runs", bearer=plain).status_code == 401
    assert _authed_get(client, "/api/runs", cookie=plain).status_code == 401
    tid2, plain2 = auth.create_token(db, name="gone", role="read")
    assert auth.revoke_token(db, tid2)
    assert _authed_get(client, "/api/runs", cookie=plain2).status_code == 401


def test_stale_session_cookie_is_ignored(auth_env):
    app, client, tokens = auth_env
    db = app.state.db
    assert client.get("/api/runs", cookies={"cairn_session": "0" * 64}).status_code == 401


def test_authenticated_read_never_writes(auth_env, monkeypatch):
    app, client, tokens = auth_env
    db = app.state.db
    writes = []
    orig_write, orig_tx = db.write, db.transaction
    monkeypatch.setattr(db, "write", lambda *a, **k: (writes.append(a), orig_write(*a, **k)))
    monkeypatch.setattr(db, "transaction", lambda *a, **k: (writes.append(("tx",)), orig_tx(*a, **k))[1])
    assert _authed_get(client, "/api/runs", cookie=tokens["read"]).status_code == 200
    assert _authed_get(client, "/api/runs", bearer=tokens["read"]).status_code == 200
    assert writes == []


def test_no_session_symbols_remain():
    from cairn.server import auth
    for name in ("create_session", "verify_session", "delete_session", "SESSION_COOKIE", "SESSION_TTL_DAYS", "SESSION_TTL_SECONDS"):
        assert not hasattr(auth, name), name


def test_sweep_expired_still_collects_otp_and_nonce_rows(auth_env):
    app, client, tokens = auth_env
    db = app.state.db
    from cairn.server import auth
    tid = auth.get_token(db, "read-token")["id"]
    db.write("INSERT INTO auth_otp (otp_hash, token_id, created_at, expires_at) VALUES (?, ?, ?, ?)", ["dead", tid, auth._iso_in(-100), auth._iso_in(-50)])
    db.write("INSERT INTO auth_nonces (nonce_hash, namespace, created_at, expires_at) VALUES (?, ?, ?, ?)", ["dead", "ssh", auth._iso_in(-100), auth._iso_in(-50)])
    auth.create_otp(db, tid)  # mint paths sweep
    assert db.read_one("SELECT COUNT(*) FROM auth_otp WHERE otp_hash = 'dead'")[0] == 0
    assert db.read_one("SELECT COUNT(*) FROM auth_nonces WHERE nonce_hash = 'dead'")[0] == 0
```

and APPEND to the existing `tests/unit/test_migrations.py` (118 lines; it has a `conn` fixture and a `_tables(con)` helper — use them, add no imports):

```python
def test_sessions_table_is_dropped(conn):
    conn.execute("CREATE TABLE sessions (id TEXT PRIMARY KEY, token_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL)")
    conn.execute("CREATE INDEX idx_sessions_token ON sessions(token_id)")
    conn.commit()
    apply_migrations(conn)
    assert "sessions" not in _tables(conn)
    assert "idx_sessions_token" not in {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='index'")}
    assert "tokens" in _tables(conn)
```

The `auth_env` fixture (`tests/unit/test_auth.py:57-68`) yields `(app, TestClient, tokens)` with `tokens = {"admin": plain, "write": plain, "read": plain}` and token names `f"{role}-token"`. Delete exactly `test_session_rejected_when_backing_token_expired` (`:127-146`) and `test_revoke_drops_live_sessions` (`:165-172`); fix the module docstring (`:1`, no "sessions, WS gating") and drop the unused `from starlette.websockets import WebSocketDisconnect` (`:11`). Keep every other test (token CRUD, OTP, SSH, authorized_keys, local token reuse, bootstrap). Note: the no-write spy covers `write` and `transaction`; `Database.executemany` is not used by auth and is left unspied deliberately.

- [ ] **Step 2: Run** — `uv run pytest tests/unit/test_auth.py tests/unit/test_migrations.py -q` → FAIL.

- [ ] **Step 3: Implement**

`auth.py`:
- `AUTH_COOKIE = "cairn_token"`; delete the session constants.
- `verify_token(db, plaintext)`: the body of today's `verify_bearer_token` (`:149-170`) minus the `last_used_at` write; `verify_bearer_token = verify_token` kept as an alias (callers: `routes/auth.py:52`, `cli.py:160`).
- `cookie_max_age(db, token_id) -> int`: read `expires_at`; `max(1, int((expires - now).total_seconds()))` when set, else `400 * 86400`.
- `_principal_from_request`: Bearer header → `verify_token`; else `request.cookies.get(AUTH_COOKIE)` → `verify_token`; else `None`.
- `revoke_token`: drop the `DELETE FROM sessions` statement (keep the transaction).
- Delete `create_session`, `verify_session`, `delete_session`. `sweep_expired` (`:178-190`) loses its `sessions` statement and is called at the top of `create_otp` and `create_nonce` (its former caller `create_session` is gone). Update the module docstring (`:1-19`) to describe the token-only model and the no-write rule.

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
    app, client, tokens = auth_env
    db = app.state.db
    r = client.post("/api/auth/login", json={"token": tokens["write"]})
    assert r.status_code == 200 and r.json() == {"name": "write-token", "role": "write"}
    assert r.cookies.get("cairn_token") == tokens["write"]
    assert "cairn_session" not in r.cookies
    assert client.get("/api/runs").status_code == 200  # TestClient keeps the jar
    r = client.post("/api/auth/logout")
    assert r.status_code == 200
    assert client.get("/api/runs").status_code == 401


def test_session_route_reports_principal_from_either_carrier(auth_env):
    app, client, tokens = auth_env
    db = app.state.db
    assert client.get("/api/auth/session").json()["authenticated"] is False
    assert client.get("/api/auth/session", headers={"Authorization": f"Bearer {tokens['read']}"}).json()["role"] == "read"
    assert client.get("/api/auth/session", cookies={"cairn_token": tokens["read"]}).json()["authenticated"] is True


def test_otp_exchange_sets_token_cookie(auth_env):
    app, client, tokens = auth_env
    db = app.state.db
    from cairn.server import auth
    tid = auth.get_token(db, "read-token")["id"]
    otp = auth.create_otp(db, tid)
    r = client.post("/api/auth/otp", json={"otp": otp})
    assert r.status_code == 200 and r.cookies.get("cairn_token")
    assert client.get("/api/runs").status_code == 200


@pytest.mark.skipif(not HAS_SSH_KEYGEN, reason="needs ssh-keygen")
def test_ssh_verify_sets_token_cookie(auth_env, tmp_path):
    # Follow the existing SSH challenge/verify test in this file for key setup; after a successful
    # POST /api/auth/ssh/verify assert r.cookies.get("cairn_token") == r.json()["token"]
    # and that a following client.get("/api/runs") is 200.
    ...


def test_cookie_max_age_follows_token_expiry(auth_env):
    app, client, tokens = auth_env
    db = app.state.db
    from cairn.server import auth
    tid, plain = auth.create_token(db, name="hourly", role="read", expires_at=auth._iso_in(3600))
    r = client.post("/api/auth/login", json={"token": plain})
    set_cookie = r.headers["set-cookie"]
    assert "Max-Age=" in set_cookie
    age = int(set_cookie.split("Max-Age=")[1].split(";")[0])
    assert 3500 <= age <= 3600
```

Proxy (`tests/unit/test_ui_proxy.py`; style = module helper `_json(data, status=200, headers=None) -> httpx.Response` plus a local `async def upstream(request: httpx.Request)` given to `httpx.MockTransport(upstream)`): rewrite `test_proxy_keeps_configured_token_server_side_and_serves_spa` (`:18-61`) so its `/api/auth/session` handler derives `authenticated` from `request.headers.get("authorization") == "Bearer secret"` (today it keys on a `cairn_session=upstream` cookie and will fail), delete its `/api/auth/login` branch, and assert the proxy never POSTs `/api/auth/login`; add a case where the probe returns `authenticated: false` → `RuntimeError` mentioning `CAIRN_TOKEN` at start-up; rename `cairn_session` → `cairn_token` in `test_proxy_browser_login_rebinds_cookie_and_logout` (`:69-114`). The other three proxy tests are unaffected.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

`routes/auth.py`:
- `_set_auth_cookie(response, db, token_id, plaintext)`: `response.set_cookie(key=auth.AUTH_COOKIE, value=plaintext, httponly=True, samesite="lax", secure=False, max_age=auth.cookie_max_age(db, token_id), path="/")`.
- `/login`: `verify_token` → `_set_auth_cookie` with the pasted plaintext (no `create_session`).
- `/otp`: `consume_otp` already returns a `Principal(token_id, name, role)` (`auth.py:262-291`); no change to it. Mint a fresh browser token `create_token(db, name=f"{principal.name}-browser-{secrets.token_hex(4)}", role=principal.role)` and `_set_auth_cookie` with its plaintext. (Every OTP/SSH login adds one `tokens` row; `cairn token list` shows them and `token revoke` removes them individually — this is the per-browser revocation the spec describes, not a leak.)
- `/logout`: `response.delete_cookie(auth.AUTH_COOKIE, path="/")` only.
- `/session`: principal via `auth._principal_from_request(request)` (make it public as `principal_from_request`); response shape unchanged.
- `/ssh/verify` (`routes/auth.py:131-187`): add `response: Response` to the handler signature and `_set_auth_cookie` with the minted token's plaintext (`:186`); the JSON body keeps returning the plaintext as today (the CLI needs it).

`proxy.py` `lifespan` (`:142-154`): replace the session-probe + login with one `GET /api/auth/session` carrying `Authorization: Bearer {token}`; raise `RuntimeError(f"remote Cairn rejected CAIRN_TOKEN")` when `auth_enabled` and not `authenticated`. Cookie rebinding (`_local_cookie`) keys on the `Set-Cookie` name generically already — verify it handles `cairn_token`. Update comments mentioning `cairn_session`.

`app.py:213-215`: delete the stale WebSocket comment.

- [ ] **Step 4: Run** — the constraint's test list green; full-suite check green.

- [ ] **Step 5: Commit** — `git add cairn/server/routes/auth.py cairn/server/proxy.py cairn/server/app.py tests/unit/test_auth.py tests/unit/test_ui_proxy.py`; message "Token cookie at login; proxy authenticates with the bearer header".

---

### Task 3: Docs

**Files:**
- Modify: `CAIRN_SPEC.md` — its three claims that Cairn has no auth / assumes a trusted LAN (`:15`, `:672`, `:994`) are replaced by one paragraph describing token-only auth (token printed at launch; `Authorization: Bearer` or the `cairn_token` cookie; hash lookup, no sessions, no writes on requests; revoke with `cairn token revoke`; SameSite=Lax cookie so the CSRF posture is unchanged even though multipart routes exist). `docs/superpowers/specs/2026-07-20-query-urls-design.md` mentions the session cookie: add a one-line "superseded by 2026-09-09 token-only auth" note at that spot; other dated specs/plans are historical records and stay untouched.

- [ ] **Step 1:** apply the edits; `grep -rn "cairn_session\|verify_session\|create_session" cairn/ CAIRN_SPEC.md README.md` → no hits.
- [ ] **Step 2: Commit** — message "Document token-only auth".
