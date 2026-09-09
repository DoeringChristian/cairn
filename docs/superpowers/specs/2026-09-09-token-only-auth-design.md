# Token-only auth: no sessions, no writes on the request path

Status: v1 (2026-09-09). Owner: cairn server.

## 1. Problem

Every authenticated request writes to the database. `verify_session` renews a
sliding 30-day expiry with `UPDATE sessions SET expires_at` on each call, and
`verify_bearer_token` records `last_used_at` on each call. A commit is an
fsync; on fermat's data disk an fsync costs 170–190 ms; every database access
shares one connection and one lock. A metrics page issuing 40 scalar reads
therefore takes about 8 s while a sweep is running. The reads themselves run
in under a millisecond.

User rulings (2026-09-09): the credential is the token the server prints at
launch. It is copied over SSH, needs no refresh, and the user revokes it with
the CLI. Simplify accordingly.

## 2. Design

One credential, two carriers, one read:

- A request authenticates with `Authorization: Bearer <token>` or with the
  HttpOnly cookie `cairn_token=<token>` (the header wins when both are sent).
  Both resolve through the same function: sha256 the value, look the hash up in
  `tokens`, `compare_digest`, check `disabled` and `expires_at`. No write.
- The `sessions` table, `create_session`, `verify_session`, `delete_session`,
  `sweep_expired`, `SESSION_TTL_*`, and the `last_used_at` touch are removed.
  The `last_used_at` column stays in the schema (additive migrations only) but
  is no longer written; `cairn token list` stops displaying it.
- `/api/auth/login`, `/api/auth/otp` and `/api/auth/ssh/verify` end by setting
  the `cairn_token` cookie to the plaintext token they just verified or minted
  (`HttpOnly; SameSite=Lax; Path=/`; `max_age` = the token's remaining lifetime
  when it has `expires_at`, else 400 days). `/api/auth/logout` clears the
  cookie and nothing else. `/api/auth/session` reports the principal resolved
  from the request, still never 401.
- Revocation is `cairn token revoke`: the token row is disabled and every
  client holding it, header or cookie, fails at its next request.
- `cairn ui --repo` with `CAIRN_TOKEN`: the proxy already attaches
  `Authorization: Bearer` to every relayed request; its start-up cookie login
  is replaced by one probe of `/api/auth/session` with the header, failing fast
  when `authenticated` is false. Browser mode (no `CAIRN_TOKEN`) is unchanged:
  the upstream `cairn_token` cookie is rebound to the local origin exactly as
  `cairn_session` was.
- Migration: `DROP TABLE IF EXISTS sessions` and its index, applied by
  `apply_migrations` (first destructive statement in the file; sessions are
  ephemeral, nothing references them).
- UI: no change. It never reads the cookie and keeps posting to the same
  routes.

## 3. What changes for users

- Logging out clears that browser only; the token stays valid everywhere else.
  Revoking the token is the only way to end all access. (Before: logout ended
  one session; revoke ended all sessions of that token.)
- There is no idle expiry any more. A cookie is valid exactly as long as its
  token.
- The browser cookie now holds the token itself rather than an opaque session
  id. A stolen cookie is a stolen token; `HttpOnly` still keeps it away from
  page scripts.

## 4. Testing

- `tests/unit/test_auth.py`: cookie and header resolve to the same principal;
  disabled and expired tokens give 401 through both carriers; a wrong or stale
  `cairn_session` cookie gives 401; logout clears the cookie; OTP and SSH
  flows set `cairn_token`; **no write during an authenticated read** — wrap
  `Database.write`/`transaction` with a counting spy around an authenticated
  GET and assert zero.
- `tests/unit/test_ui_proxy.py`: token mode never calls `/api/auth/login`;
  a rejected token fails start-up; browser mode rebinds `cairn_token`.
- Migration test: a database that has a `sessions` table loses it after
  `apply_migrations`.

## 5. Out of scope

Per-thread read connections and `synchronous=NORMAL` (next branch). The SSH
login flow keeps minting named tokens. The OTP URL keeps its 15-minute,
single-use semantics.
