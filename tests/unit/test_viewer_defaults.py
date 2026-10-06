"""One default viewer per kind of data: built-in viewers, ``default_for``,
the implicit first-published rule, the API, and share scope."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from click.testing import CliRunner
from fastapi.testclient import TestClient

import cairn
from cairn.server import auth as auth_core
from cairn.server.app import create_app
from cairn.server.custom_viewers import builtin_defaults, builtin_viewers
from cairn.server.viewer_defaults import default_for_subject, normalize_kind, resolve
from tests.conftest import ingest_repo

QUIET = dict(capture_source=False, capture_stdout=False, capture_env=False, capture_system_metrics=False)


@pytest.fixture(autouse=True)
def _reset_active_run():
    from cairn.sdk.capture import stdout as scap

    scap._active_run_id = None
    yield
    scap._active_run_id = None


def viewer(root: Path, name: str, accepts: list[str]) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    (root / "cairn-viewer.json").write_text(json.dumps({"name": name, "accepts": accepts}))
    (root / "index.js").write_text(f"export const name = {name!r};\n")
    return root


def defaults(client: TestClient, project: str = "p") -> dict:
    return client.get(f"/api/projects/{project}/viewer-defaults").json()


# ---------------------------------------------------------------------------
# Pure rules
# ---------------------------------------------------------------------------

def test_normalize_kind():
    assert normalize_kind("volume") == "volume"
    assert normalize_kind("guiding/vmf") == "custom:guiding/vmf"
    assert normalize_kind("custom:guiding/*") == "custom:guiding/*"
    with pytest.raises(ValueError):
        normalize_kind("Bad Kind")


def test_most_specific_key_wins():
    d = {"custom:guiding/*": "glob", "custom:guiding/vmf": "exact", "volume": "vol"}
    assert default_for_subject(d, "custom:guiding/vmf") == "exact"
    assert default_for_subject(d, "custom:guiding/sg") == "glob"
    assert default_for_subject(d, "image") is None
    # The project's default beats a built-in viewer's; none: the built-in renderer.
    assert resolve({"volume": "mine"}, {"volume": "cairn.volume"}, "volume") == "mine"
    assert resolve({}, {"volume": "cairn.volume"}, "volume") == "cairn.volume"
    assert resolve({}, {"volume": "cairn.volume"}, "image") is None


# ---------------------------------------------------------------------------
# Built-in viewers
# ---------------------------------------------------------------------------

def test_builtin_volume_viewer_ships_and_is_listed(tmp_path):
    vol = builtin_viewers()["cairn.volume"]
    assert vol.manifest["accepts"] == ["volume"] and vol.manifest["webgl"] is True
    assert builtin_defaults() == {"volume": "cairn.volume"}
    repo = tmp_path / ".cairn"
    ingest_repo(repo)
    with TestClient(create_app(data_dir=repo, background_tasks=False)) as client:
        listed = client.get("/api/projects/fresh/viewers").json()["viewers"]
        (entry,) = [v for v in listed if v["builtin"]]
        assert entry["name"] == "cairn.volume" and entry["dev"] is False and entry["content_digest"] == vol.digest
        assert defaults(client, "fresh") == {"defaults": {}, "builtin": {"volume": "cairn.volume"}}
        files = client.get("/api/viewers/builtin/cairn.volume/files").json()["files"]
        assert {f["path"] for f in files} == {"cairn-viewer.json", "index.js", "colormaps.js"}
        r = client.get("/api/viewers/builtin/cairn.volume/file", params={"path": "index.js"})
        assert r.status_code == 200 and "webgl2" in r.text
        assert r.headers["content-security-policy"] == "sandbox" and r.headers["x-content-type-options"] == "nosniff"
        assert client.get("/api/viewers/builtin/cairn.volume/file", params={"path": "x.js"}).status_code == 404
        assert client.get("/api/viewers/builtin/nope/files").status_code == 404


def test_builtin_names_are_reserved(tmp_path):
    root = viewer(tmp_path / "v", "cairn.mine", ["custom:k"])
    with pytest.raises(ValueError, match="reserved"):
        cairn.publish_viewer(root, project="p", repo=tmp_path / ".cairn")


# ---------------------------------------------------------------------------
# Publishing
# ---------------------------------------------------------------------------

def test_first_published_viewer_of_a_custom_kind_becomes_its_default(tmp_path):
    repo = tmp_path / ".cairn"
    cairn.publish_viewer(viewer(tmp_path / "a", "a", ["custom:k/*", "volume"]), project="p", repo=repo)
    cairn.publish_viewer(viewer(tmp_path / "b", "b", ["custom:k/x", "custom:other"]), project="p", repo=repo)
    ingest_repo(repo)
    with TestClient(create_app(data_dir=repo, background_tasks=False)) as client:
        # `a` is first for k/*; `b`'s k/x falls under it, `other` is new. Volume
        # (a built-in type) never changes implicitly.
        assert defaults(client)["defaults"] == {"custom:k/*": "a", "custom:other": "b"}


def test_default_for_declares_and_republishes_only_on_change(tmp_path):
    repo = tmp_path / ".cairn"
    root = viewer(tmp_path / "ray", "ray", ["volume"])
    v1 = cairn.publish_viewer(root, project="p", repo=repo)
    v2 = cairn.publish_viewer(root, project="p", repo=repo, default_for=["volume"])
    assert v2.version == 2 and v2.metadata["default_for"] == ["volume"]
    assert cairn.publish_viewer(root, project="p", repo=repo, default_for=["volume"]).id == v2.id
    assert cairn.publish_viewer(root, project="p", repo=repo).id == v2.id
    assert v1.version == 1
    with pytest.raises(ValueError, match="cannot be the default"):
        cairn.publish_viewer(root, project="p", repo=repo, default_for=["image"])
    ingest_repo(repo)
    with TestClient(create_app(data_dir=repo, background_tasks=False)) as client:
        assert defaults(client)["defaults"] == {"volume": "ray"}


def test_run_use_viewer_and_cli_default_for(tmp_path):
    from cairn.cli import main

    repo = tmp_path / ".cairn"
    with cairn.Run(project="p", repo=repo, **QUIET) as run:
        run.use_viewer(viewer(tmp_path / "a", "a", ["custom:k", "image"]), default_for=["image"])
    r = CliRunner().invoke(main, [
        "viewer", "publish", str(viewer(tmp_path / "b", "b", ["custom:k"])), "--project", "p",
        "--repo", str(repo), "--default-for", "k",
    ])
    assert r.exit_code == 0, r.output
    ingest_repo(repo)
    with TestClient(create_app(data_dir=repo, background_tasks=False)) as client:
        assert defaults(client)["defaults"] == {"image": "a", "custom:k": "b"}


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

def test_put_sets_and_clears_defaults(tmp_path):
    repo = tmp_path / ".cairn"
    cairn.publish_viewer(viewer(tmp_path / "a", "a", ["custom:k", "volume", "image"]), project="p", repo=repo)
    ingest_repo(repo)
    app = create_app(data_dir=repo, auth_enabled=True, background_tasks=False)
    with TestClient(app) as client:
        _id, token = auth_core.create_token(app.state.db, name="w", role="write")
        _rid, read = auth_core.create_token(app.state.db, name="r", role="read")
        client.headers.update({"Authorization": f"Bearer {token}"})
        put = lambda body: client.put("/api/projects/p/viewer-defaults", json=body)  # noqa: E731
        assert put({"kind": "volume", "viewer": "a"}).json()["defaults"] == {"custom:k": "a", "volume": "a"}
        assert put({"kind": "volume", "viewer": "cairn.volume"}).json()["defaults"]["volume"] == "cairn.volume"
        assert put({"kind": "volume", "viewer": None}).json()["defaults"] == {"custom:k": "a"}
        assert put({"kind": "image", "viewer": "cairn.volume"}).status_code == 400
        assert put({"kind": "image", "viewer": "nope"}).status_code == 404
        assert put({"kind": "Bad Kind", "viewer": "a"}).status_code == 400
        reader = TestClient(app)
        reader.headers.update({"Authorization": f"Bearer {read}"})
        assert reader.get("/api/projects/p/viewer-defaults").status_code == 200
        assert reader.put("/api/projects/p/viewer-defaults", json={"kind": "image", "viewer": "a"}).status_code == 403


# ---------------------------------------------------------------------------
# Share scope
# ---------------------------------------------------------------------------

def test_share_scope_has_the_default_viewers_of_its_kinds(tmp_path):
    repo = tmp_path / ".cairn"
    vol = cairn.publish_viewer(viewer(tmp_path / "vol", "vol", ["volume"]), project="p", repo=repo)
    img = cairn.publish_viewer(viewer(tmp_path / "img", "img", ["image"]), project="p", repo=repo, default_for=["image"])
    with cairn.Run(project="p", repo=repo, **QUIET) as run:
        run.track(1.0, "x", 0)

    ingest_repo(repo)
    app = create_app(data_dir=repo, auth_enabled=True, background_tasks=False)
    with TestClient(app) as owner:
        _id, token = auth_core.create_token(app.state.db, name="w", role="write")
        owner.headers.update({"Authorization": f"Bearer {token}"})

        def share(cards: str) -> TestClient:
            source = f"```cairn\nruns: {{ids: [{run.id}]}}\ncards:\n{cards}```"
            rid = owner.post("/api/projects/p/reports", json={"name": "r", "payload": {"source": source}}).json()["id"]
            secret = owner.post(f"/api/projects/p/reports/{rid}/shares", json={}).json()["secret"]
            c = TestClient(app)
            assert c.post("/api/share/redeem", json={"secret": secret}).status_code == 200
            return c

        def published(c: TestClient) -> set[str]:
            return {v["version_id"] for v in c.get("/api/projects/p/viewers").json()["viewers"] if not v.get("builtin")}

        c = share("  - {metric: a, type: image}\n  - {metric: b, type: volume}\n")
        # image's default is `img`; volume's is the built-in viewer (a published
        # viewer accepting volume does not take it over).
        assert published(c) == {img.id}
        assert vol.id not in published(c)
        assert c.get("/api/projects/p/viewer-defaults").status_code == 200
        builtin = [v for v in c.get("/api/projects/p/viewers").json()["viewers"] if v.get("builtin")]
        assert [v["name"] for v in builtin] == ["cairn.volume"]
        assert c.get("/api/viewers/builtin/cairn.volume/file", params={"path": "index.js"}).status_code == 200

        owner.put("/api/projects/p/viewer-defaults", json={"kind": "volume", "viewer": "vol"})
        assert published(share("  - {metric: b, type: volume}\n")) == {vol.id}
