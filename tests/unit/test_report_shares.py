"""Report share links: create → redeem → scoped reads → expiry → revoke, the
default-deny route guard, artifact reachability, no-auth and the redeem limit."""

from __future__ import annotations

import io
import json

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from cairn.server import auth as auth_core
from cairn.server.app import create_app
from cairn.server.run_sets import run_sets_yaml


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _fence(body: str) -> str:
    return f"```cairn\n{body}\n```"


@pytest.fixture
def env(tmp_path):
    """An auth-enabled app with a report over run ``a`` and a code-diff cell
    over ``c``; run ``b`` is in the project but not in the report."""
    app = create_app(data_dir=tmp_path / "cairn", auth_enabled=True)
    with TestClient(app) as owner:
        _id, token = auth_core.create_token(app.state.db, name="writer", role="write")
        owner.headers.update(_bearer(token))

        def run(name, **extra):
            return owner.post("/api/runs", json={"project": "p", "name": name, **extra}).json()

        a = run("a", env={"SECRET": "hunter2"})
        pid = a["project_id"]
        b, c = run("b")["run_id"], run("c")["run_id"]
        a = a["run_id"]

        def blob(data: bytes, mime="application/octet-stream", meta=None):
            r = owner.post("/api/artifacts", files={"file": ("f", io.BytesIO(data), mime)},
                           data={"mime_type": mime, "metadata": json.dumps(meta or {})})
            assert r.status_code == 200, r.text
            return r.json()["hash"]

        def point(run_id, name, h, step=1):
            r = owner.post(f"/api/runs/{run_id}/batch", json={"points": [{
                "name": name, "step": step, "wall_time": "2026-01-01T00:00:00Z",
                "object_type": "table", "artifact_hash": h,
            }]})
            assert r.status_code == 200, r.text

        cell = blob(b"cell image")
        table = blob(b"a table", meta={"media_hashes": [cell]})
        point(a, "tbl", table)
        owner.post(f"/api/runs/{a}/batch", json={"points": [
            {"name": "loss", "step": 1, "wall_time": "2026-01-01T00:00:00Z",
             "object_type": "scalar", "scalar_value": 0.5},
        ]})
        other = blob(b"b's secret blob")
        point(b, "tbl", other)
        orphan = blob(b"logged by no run")

        source = "\n\n".join([
            "# Results",
            _fence(f"{run_sets_yaml([a])}\ncards:\n  - {{metric: loss, type: scalar}}"),
            _fence(f"{run_sets_yaml([c])}\ncards:\n  - type: code-diff"),
        ])
        rid = owner.post(f"/api/projects/{pid}/reports",
                         json={"name": "r", "payload": {"source": source}}).json()["id"]
        yield {
            "app": app, "owner": owner, "pid": pid, "rid": rid,
            "a": a, "b": b, "c": c,
            "cell": cell, "table": table, "other": other, "orphan": orphan,
        }


def _create(env, **body):
    r = env["owner"].post(f"/api/projects/{env['pid']}/reports/{env['rid']}/shares", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _viewer(env, secret) -> TestClient:
    """A fresh browser (no token) that redeemed ``secret``."""
    viewer = TestClient(env["app"])
    r = viewer.post("/api/share/redeem", json={"secret": secret})
    assert r.status_code == 200, r.text
    assert r.json() == {"report_id": env["rid"], "project_id": env["pid"]}
    return viewer


def test_full_flow(env):
    share = _create(env)
    assert share["url"] == f"/share/{share['secret']}"
    assert len(share["secret"]) >= 43  # 256 bits, urlsafe
    # Stored only as a hash.
    (stored,) = env["app"].state.db.read_one("SELECT secret_hash FROM report_shares")
    assert stored == auth_core.hash_secret(share["secret"])
    assert share["secret"] not in json.dumps(
        env["owner"].get(f"/api/projects/{env['pid']}/reports/{env['rid']}/shares").json()
    )

    viewer = TestClient(env["app"])
    r = viewer.post("/api/share/redeem", json={"secret": share["secret"]})
    cookie = r.headers["set-cookie"]
    share_cookie = auth_core.share_cookie_name(env["app"].state.server_id)
    assert f"{share_cookie}=" in cookie and "HttpOnly" in cookie and "samesite=lax" in cookie.lower()
    assert r.headers["referrer-policy"] == "no-referrer"

    # The context: report, in-scope runs without env, their metric index.
    ctx = viewer.get("/api/share/context")
    assert ctx.status_code == 200, ctx.text
    body = ctx.json()
    assert body["report"]["id"] == env["rid"]
    assert {r["id"] for r in body["runs"]} == {env["a"], env["c"]}
    assert all("env_snapshot" not in r for r in body["runs"])
    assert {s["name"] for s in body["metric_index"][env["a"]]} == {"loss", "tbl"}
    # Each fence's run sets, resolved by the server.
    assert body["run_sets"] == [[[env["a"]]], [[env["c"]]]]
    assert body["source_run_ids"] == [env["c"]]

    # Allowed reads.
    a = env["a"]
    ok = [
        f"/api/projects/{env['pid']}/reports/{env['rid']}",
        f"/api/runs/{a}", f"/api/runs/{a}/sequences", f"/api/runs/{a}/sequences/loss",
        f"/api/runs/{a}/updates", f"/api/runs/{a}/outputs",
        f"/api/artifacts/{env['table']}", f"/api/artifacts/{env['cell']}",
    ]
    for path in ok:
        assert viewer.get(path).status_code == 200, path
    run = viewer.get(f"/api/runs/{a}").json()["run"]
    assert "env_snapshot" not in run
    assert "hunter2" not in viewer.get(f"/api/runs/{a}").text
    # The owner still sees the environment.
    assert "hunter2" in env["owner"].get(f"/api/runs/{a}").text

    # Source files: only the code-diff cell's runs (c has no archive: 404, not 403).
    assert viewer.get(f"/api/runs/{env['c']}/source/tree").status_code == 404
    assert viewer.get(f"/api/runs/{a}/source/tree").status_code == 403
    assert viewer.get(f"/api/runs/{a}/source/file", params={"path": "x.py"}).status_code == 403

    # Other runs, other blobs, other reports, lists and writes: 403.
    b = env["b"]
    for path in (
        f"/api/runs/{b}", f"/api/runs/{b}/sequences", f"/api/runs/{b}/sequences/tbl",
        f"/api/artifacts/{env['other']}", f"/api/artifacts/{env['orphan']}",
        "/api/runs", "/api/projects", f"/api/projects/{env['pid']}/reports",
        f"/api/projects/{env['pid']}/reports/{env['rid']}/comments",
        f"/api/runs/{a}/logs",
    ):
        assert viewer.get(path).status_code == 403, path
    assert viewer.put(
        f"/api/projects/{env['pid']}/reports/{env['rid']}", json={"name": "pwned"},
    ).status_code == 403
    assert viewer.post("/api/runs", json={"project": "p"}).status_code == 403

    # A share session is not a login.
    assert viewer.get("/api/auth/session").json()["authenticated"] is False

    # Expiry: the very next request is refused.
    env["app"].state.db.write(
        "UPDATE report_shares SET expires_at = '2000-01-01T00:00:00+00:00' WHERE id = ?",
        [share["id"]],
    )
    assert viewer.get(f"/api/runs/{a}").status_code == 401
    assert viewer.get("/api/share/context").status_code == 401
    assert TestClient(env["app"]).post(
        "/api/share/redeem", json={"secret": share["secret"]},
    ).status_code == 404

    # Revoke.
    second = _create(env, expires_at="2099-01-01T00:00:00Z")
    assert second["expires_at"].startswith("2099-01-01")
    viewer2 = _viewer(env, second["secret"])
    assert viewer2.get(f"/api/runs/{a}").status_code == 200
    r = env["owner"].delete(
        f"/api/projects/{env['pid']}/reports/{env['rid']}/shares/{second['id']}",
    )
    assert r.status_code == 200
    assert viewer2.get(f"/api/runs/{a}").status_code == 401
    listed = env["owner"].get(f"/api/projects/{env['pid']}/reports/{env['rid']}/shares").json()
    assert {s["id"]: s["status"] for s in listed["shares"]} == {
        share["id"]: "expired", second["id"]: "revoked",
    }


def test_expiry_defaults_to_30_days_and_must_be_future(env):
    from datetime import datetime, timedelta, timezone

    share = _create(env)
    exp = datetime.fromisoformat(share["expires_at"])
    assert abs(exp - (datetime.now(timezone.utc) + timedelta(days=30))) < timedelta(minutes=1)
    r = env["owner"].post(
        f"/api/projects/{env['pid']}/reports/{env['rid']}/shares",
        json={"expires_at": "2001-01-01T00:00:00Z"},
    )
    assert r.status_code == 422


def test_managing_shares_takes_write(env):
    _id, read = auth_core.create_token(env["app"].state.db, name="reader", role="read")
    reader = TestClient(env["app"], headers=_bearer(read))
    base = f"/api/projects/{env['pid']}/reports/{env['rid']}/shares"
    assert reader.post(base, json={}).status_code == 403
    assert reader.get(base).status_code == 403


def test_scope_is_live(env):
    """Editing the report changes what the share reaches (after the cache TTL)."""
    viewer = _viewer(env, _create(env)["secret"])
    assert viewer.get(f"/api/runs/{env['b']}").status_code == 403
    source = _fence(f"{run_sets_yaml([env['b']])}")
    env["owner"].put(f"/api/projects/{env['pid']}/reports/{env['rid']}",
                     json={"payload": {"source": source}})
    env["app"].state.share_scopes.clear()  # stands in for the 30 s TTL
    assert viewer.get(f"/api/runs/{env['b']}").status_code == 200
    assert viewer.get(f"/api/runs/{env['a']}").status_code == 403


def test_artifact_reachability(env):
    """Only blobs the in-scope runs reach, transitively (a table's media cells,
    a gallery's items, a manifest's files)."""
    from cairn.server import artifact_refs

    owner = env["owner"]

    def blob(data: bytes, mime="application/octet-stream", meta=None):
        return owner.post("/api/artifacts", files={"file": ("f", io.BytesIO(data), mime)},
                          data={"mime_type": mime, "metadata": json.dumps(meta or {})}).json()["hash"]

    img = blob(b"gallery image")
    gallery = blob(json.dumps({"items": [{"hash": img}]}).encode(), artifact_refs.GALLERY_MIME)
    leaf = blob(b"a file in a dir")
    manifest = blob(json.dumps({"files": [{"path": "x", "hash": leaf, "size": 15}]}).encode(),
                    artifact_refs.MANIFEST_MIME)
    owner.post(f"/api/runs/{env['a']}/batch", json={"points": [
        {"name": "gal", "step": 1, "wall_time": "2026-01-01T00:00:00Z",
         "object_type": "image", "artifact_hash": gallery},
    ]})
    r = owner.post(f"/api/projects/{env['pid']}/artifact-versions", json={
        "name": "dir", "digest": manifest, "created_by_run": env["a"],
    })
    assert r.status_code == 200, r.text

    viewer = _viewer(env, _create(env)["secret"])
    for h in (gallery, img, manifest, leaf, env["table"], env["cell"]):
        assert viewer.get(f"/api/artifacts/{h}").status_code == 200, h
    for h in (env["other"], env["orphan"], "0" * 64):
        assert viewer.get(f"/api/artifacts/{h}").status_code == 403, h


def test_report_assets_only_of_the_shared_report(env):
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
    owner, pid = env["owner"], env["pid"]
    mine = owner.post(f"/api/projects/{pid}/reports/{env['rid']}/assets",
                      files={"file": ("x", io.BytesIO(png), "image/png")}).json()
    other_rid = owner.post(f"/api/projects/{pid}/reports",
                           json={"name": "o", "payload": {"source": ""}}).json()["id"]
    theirs = owner.post(f"/api/projects/{pid}/reports/{other_rid}/assets",
                        files={"file": ("x", io.BytesIO(png + b"!"), "image/png")}).json()
    viewer = _viewer(env, _create(env)["secret"])
    assert viewer.get(mine["url"]).status_code == 200
    assert viewer.get(theirs["url"]).status_code == 403
    assert viewer.get(f"/api/projects/{pid}/reports/{other_rid}").status_code == 403


# Routes that are public (no require_role at all) and so never see a share
# principal's 403. Every OTHER /api route must refuse a share principal unless
# it is in SHARE_ALLOWED.
_PUBLIC = {
    "/api/health",
    "/api/auth/login", "/api/auth/otp", "/api/auth/logout", "/api/auth/session",
    "/api/auth/ssh/challenge", "/api/auth/ssh/verify",
    "/api/share/redeem",
}


def _fill(path: str) -> str:
    """A concrete URL for a route template (dummy path params)."""
    import re

    return re.sub(r"\{[^}]+\}", "x", path)


def test_guard_every_route_not_allowlisted_is_403(env):
    viewer = _viewer(env, _create(env)["secret"])
    seen_allowed = set()
    seen_read_posts = set()
    checked = 0
    for route in env["app"].routes:
        if not isinstance(route, APIRoute) or not route.path.startswith("/api"):
            continue
        if route.path in _PUBLIC:
            continue
        for method in sorted(route.methods):
            if route.path in auth_core.SHARE_ALLOWED and method in ("GET", "HEAD"):
                seen_allowed.add(route.path)
                continue
            if route.path in auth_core.SHARE_READ_POSTS and method == "POST":
                seen_read_posts.add(route.path)
                continue
            r = viewer.request(method, _fill(route.path), json={})
            assert r.status_code == 403, f"{method} {route.path} -> {r.status_code}"
            checked += 1
    assert checked > 50
    # Every allowlist entry names a real GET route (no stale entries).
    assert seen_allowed == set(auth_core.SHARE_ALLOWED)
    assert seen_read_posts == set(auth_core.SHARE_READ_POSTS)


def test_public_routes_are_exactly_the_known_ones(env):
    """A new route without require_role would escape the guard above."""
    from fastapi.dependencies.models import Dependant

    def guarded(dep: Dependant) -> bool:
        return any(
            getattr(d.call, "__qualname__", "").startswith("require_role.")
            or guarded(d) for d in dep.dependencies
        )

    public = {
        r.path for r in env["app"].routes
        if isinstance(r, APIRoute) and r.path.startswith("/api") and not guarded(r.dependant)
    }
    assert public == _PUBLIC


def test_allowlisted_route_with_a_foreign_id_is_403(env):
    viewer = _viewer(env, _create(env)["secret"])
    for path in auth_core.SHARE_ALLOWED:
        if path == "/api/share/context" or path.startswith("/api/viewers/builtin/"):
            continue  # not scoped: the built-in viewers ship with the app
        assert viewer.get(_fill(path)).status_code == 403, path


def test_no_auth_mode_refuses_to_create(tmp_path):
    app = create_app(data_dir=tmp_path / "cairn")
    with TestClient(app) as c:
        pid = c.post("/api/runs", json={"project": "p"}).json()["project_id"]
        rid = c.post(f"/api/projects/{pid}/reports",
                     json={"name": "r", "payload": {"source": ""}}).json()["id"]
        r = c.post(f"/api/projects/{pid}/reports/{rid}/shares", json={})
        assert r.status_code == 400
        assert "auth" in r.json()["detail"]


def test_redeem_is_rate_limited(env):
    viewer = TestClient(env["app"])
    codes = [
        viewer.post("/api/share/redeem", json={"secret": f"guess-{i}"}).status_code
        for i in range(12)
    ]
    assert codes[:10] == [404] * 10
    assert codes[10:] == [429, 429]
    # Even the right secret is refused while limited.
    secret = _create(env)["secret"]
    assert viewer.post("/api/share/redeem", json={"secret": secret}).status_code == 429


def test_token_beats_share_cookie(env):
    """A logged-in browser holding a share cookie keeps its full access."""
    viewer = _viewer(env, _create(env)["secret"])
    assert viewer.get("/api/runs").status_code == 403
    _id, read = auth_core.create_token(env["app"].state.db, name="r2", role="read")
    viewer.cookies.set(auth_core.auth_cookie_name(env["app"].state.server_id), read)
    assert viewer.get("/api/runs").status_code == 200


def test_metric_rules_are_narrowed_to_the_reports_runs(env):
    owner, pid = env["owner"], env["pid"]
    owner.post(f"/api/runs/{env['a']}/metric-rules", json={"name": "loss", "summary": "min"})
    owner.post(f"/api/runs/{env['b']}/batch", json={"points": [
        {"name": "secret", "step": 1, "wall_time": "2026-01-01T00:00:00Z",
         "object_type": "scalar", "scalar_value": 1.0},
    ]})
    owner.post(f"/api/runs/{env['b']}/metric-rules", json={"name": "secret", "summary": "max"})
    owner.put(f"/api/projects/{pid}/metric-rules/secret", json={"goal": "higher"})
    assert set(owner.get(f"/api/projects/{pid}/metric-rules").json()["rules"]) == {"loss", "secret"}

    viewer = _viewer(env, _create(env)["secret"])
    body = viewer.get(f"/api/projects/{pid}/metric-rules").json()
    assert body == {
        "logged": {"loss": "min"}, "overrides": {},
        "rules": {"loss": {"summary": "min", "goal": "lower"}},
    }
    assert viewer.put(f"/api/projects/{pid}/metric-rules/loss", json={"goal": "none"}).status_code == 403
    assert viewer.get("/api/projects/other/metric-rules").status_code == 403


def test_runs_batch_and_series_answer_only_the_reports_runs(env):
    viewer = _viewer(env, _create(env)["secret"])
    a, b, c = env["a"], env["b"], env["c"]
    r = viewer.post("/api/runs/batch", json={"ids": [a, b, c, "nope"]})
    assert r.status_code == 200, r.text
    body = r.json()
    # b is the project's but not the report's; an unknown id is no more the report's.
    assert list(body["runs"]) == [a, c]
    assert body["forbidden"] == [b, "nope"] and body["missing"] == []
    # Exactly the per-run routes' answers, so never the run's environment.
    assert body["runs"][a]["run"] == viewer.get(f"/api/runs/{a}").json()
    assert "env_snapshot" not in body["runs"][a]["run"]["run"]
    assert body["runs"][a]["sequences"] == viewer.get(f"/api/runs/{a}/sequences").json()["sequences"]
    # The owner sees every run, the environment included.
    owned = env["owner"].post("/api/runs/batch", json={"ids": [a, b], "include": ["run"]}).json()
    assert list(owned["runs"]) == [a, b] and owned["forbidden"] == []
    assert owned["runs"][a]["run"]["run"]["env_snapshot"]
    # The same for series.
    r = viewer.post("/api/runs/series", json={"runs": {a: ["loss"], b: ["tbl"]}})
    assert r.status_code == 200, r.text
    assert list(r.json()["runs"]) == [a] and r.json()["forbidden"] == [b]
    assert r.json()["runs"][a] == viewer.get(f"/api/runs/{a}/series", params={"name": "loss"}).json()
    # Other POSTs stay closed to a share link.
    assert viewer.post("/api/runs/query", json={}).status_code == 403
