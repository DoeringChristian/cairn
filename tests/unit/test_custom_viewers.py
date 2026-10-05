"""Custom viewers: manifest rules, publish dedupe, the viewers list, dev
sources, share scope, security headers and ``cairn viewer add``."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from click.testing import CliRunner
from fastapi.testclient import TestClient

import cairn
from cairn.server import auth as auth_core
from cairn.server.app import create_app
from cairn.server.custom_viewers import DevStore
from cairn.server.viewer_manifest import (
    MAX_FOLDER_BYTES,
    ManifestError,
    accepts_matches,
    load_folder,
    mime_for,
    validate_manifest,
)

QUIET = dict(capture_source=False, capture_stdout=False, capture_env=False, capture_system_metrics=False)
SCHEMA = Path(__file__).resolve().parents[2] / "docs" / "schemas" / "cairn-viewer.schema.json"


@pytest.fixture(autouse=True)
def _reset_active_run():
    from cairn.sdk.capture import stdout as scap

    scap._active_run_id = None
    yield
    scap._active_run_id = None


GOOD = {
    "name": "vmf-sphere",
    "title": "Guiding distribution",
    "accepts": ["custom:guiding/*", "volume"],
    "inputs": "compare",
    "webgl": True,
    "view": True,
    "imports": {"d3": "./vendor/d3.js", "addons/": "./vendor/addons/"},
    "settings": [
        {"key": "exposure", "type": "slider", "min": 0, "max": 4, "default": 1},
        {"key": "n", "type": "number"},
        {"key": "mode", "type": "select", "options": ["a", {"value": "b", "label": "B"}]},
        {"key": "grid", "type": "switch"},
        {"key": "cmap", "type": "colormap"},
        {"key": "note", "type": "text", "placeholder": "..."},
    ],
}
FILES = ["cairn-viewer.json", "index.js", "vendor/d3.js", "vendor/addons/x.js"]


def own(viewers: list[dict]) -> list[dict]:
    """The project's viewers (the built-in ones lead every list)."""
    return [v for v in viewers if not v.get("builtin")]


def make_viewer(root: Path, manifest: dict | None = None, *, index: str = "export {};\n") -> Path:
    root.mkdir(parents=True, exist_ok=True)
    (root / "cairn-viewer.json").write_text(json.dumps(manifest or GOOD))
    (root / "index.js").write_text(index)
    (root / "vendor" / "addons").mkdir(parents=True, exist_ok=True)
    (root / "vendor" / "d3.js").write_text("export const d3 = 1;\n")
    (root / "vendor" / "addons" / "x.js").write_text("export const x = 1;\n")
    (root / ".hidden").write_text("not published")
    return root


# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------

def test_good_manifest_is_normalized():
    m = validate_manifest(GOOD, FILES)
    assert m["entry"] == "index.js" and m["description"] is None
    s = {x["key"]: x for x in m["settings"]}
    assert s["exposure"]["default"] == 1 and s["exposure"]["label"] == "exposure"
    assert s["n"]["default"] == 0
    assert s["mode"]["options"] == [{"value": "a", "label": "a"}, {"value": "b", "label": "B"}]
    assert s["mode"]["default"] == "a"
    assert s["grid"]["default"] is False
    assert s["cmap"]["default"] == "turbo"
    assert s["note"]["default"] == "" and s["note"]["placeholder"] == "..."
    minimal = validate_manifest({"name": "v", "accepts": ["image"]}, ["index.js"])
    assert s["exposure"]["tab"] == "display" and s["exposure"]["section"] == "Appearance"
    assert s["exposure"]["help"] is None
    assert minimal == {
        "name": "v", "title": "v", "description": None, "icon": None, "entry": "index.js",
        "accepts": ["image"], "inputs": "single", "webgl": False, "view": False,
        "settings": [], "imports": {},
    }


BAD = [
    ({"accepts": ["image"]}, "name"),
    ({**GOOD, "name": "Has Caps"}, "name"),
    ({**GOOD, "accepts": []}, "accepts"),
    ({**GOOD, "accepts": ["custom:Bad Kind"]}, "accepts"),
    ({**GOOD, "inputs": "three"}, "inputs"),
    ({**GOOD, "webgl": "yes"}, "webgl"),
    ({**GOOD, "entry": "../escape.js"}, "inside"),
    ({**GOOD, "entry": "/abs.js"}, "relative"),
    ({**GOOD, "entry": "missing.js"}, "does not exist"),
    ({**GOOD, "imports": {"./rel": "./vendor/d3.js"}}, "bare specifier"),
    ({**GOOD, "imports": {"cairn:three": "./vendor/d3.js"}}, "bare specifier"),
    ({**GOOD, "imports": {"d3": "vendor/d3.js"}}, "./relative"),
    ({**GOOD, "imports": {"d3": "./vendor/nope.js"}}, "does not exist"),
    ({**GOOD, "imports": {"a/": "./vendor/d3.js"}}, "folder"),
    ({**GOOD, "imports": {"d3": "./../x.js"}}, "inside"),
    ({**GOOD, "settings": [{"key": "a", "type": "slider", "min": 1}]}, "min and max"),
    ({**GOOD, "settings": [{"key": "a", "type": "slider", "min": 0, "max": 1, "default": 5}]}, "outside"),
    ({**GOOD, "settings": [{"key": "a", "type": "select", "options": []}]}, "options"),
    ({**GOOD, "settings": [{"key": "a", "type": "select", "options": ["x"], "default": "y"}]}, "not an option"),
    ({**GOOD, "settings": [{"key": "a", "type": "switch", "default": 1}]}, "true or false"),
    ({**GOOD, "settings": [{"key": "a", "type": "knob"}]}, "type must be"),
    ({**GOOD, "settings": [{"key": "viewer", "type": "text"}]}, "reserved"),
    ({**GOOD, "settings": [{"key": "a", "type": "text"}, {"key": "a", "type": "text"}]}, "twice"),
    ({**GOOD, "settings": [{"key": "a", "type": "switch", "min": 0}]}, "does not apply|do\\(es\\) not apply"),
    ({**GOOD, "extra": 1}, "unknown manifest field"),
    ({**GOOD, "icon": "skull"}, "icon must be one of"),
    ({**GOOD, "settings": [{"key": "a", "type": "text", "tab": "advanced"}]}, "tab must be one of"),
    ({**GOOD, "settings": [{"key": "a", "type": "text", "section": "Misc"}]}, "section must be one of"),
    ({**GOOD, "settings": [{"key": "a", "type": "text", "help": 3}]}, "help must be a string"),
]


def test_setting_placement_help_and_icon():
    raw = {
        **GOOD,
        "icon": "globe",
        "settings": [
            {"key": "lobes", "type": "number", "tab": "data", "section": "Series", "help": "How many lobes."},
            {"key": "exposure", "type": "slider", "min": 0, "max": 4},
        ],
    }
    m = validate_manifest(raw, FILES)
    assert m["icon"] == "globe"
    lobes, exposure = m["settings"]
    assert (lobes["tab"], lobes["section"], lobes["help"]) == ("data", "Series", "How many lobes.")
    assert (exposure["tab"], exposure["section"], exposure["help"]) == ("display", "Appearance", None)


def test_placement_vocabulary_matches_the_ui_palette():
    """The tabs/sections are the settings palette's (vendor/cairn-ui/src/components/settings/palette/logic.ts)."""
    from cairn.server.viewer_manifest import SETTING_SECTIONS, SETTING_TABS

    schema = json.loads(SCHEMA.read_text())
    assert schema["$defs"]["tab"]["enum"] == list(SETTING_TABS)
    assert schema["$defs"]["section"]["enum"] == list(SETTING_SECTIONS)
    logic = Path(__file__).resolve().parents[2] / "vendor/cairn-ui/src/components/settings/palette/logic.ts"
    if logic.exists():
        text = logic.read_text()
        for name in SETTING_SECTIONS:
            assert f'"{name}"' in text
        for tab in SETTING_TABS:
            assert f'id: "{tab}"' in text


@pytest.mark.parametrize("raw,match", BAD)
def test_bad_manifests(raw, match):
    with pytest.raises(ManifestError, match=match):
        validate_manifest(raw, FILES)


def test_json_schema_agrees():
    jsonschema = pytest.importorskip("jsonschema")
    schema = json.loads(SCHEMA.read_text())
    jsonschema.validate(GOOD, schema)
    for raw, _ in BAD:
        if any(w in _ for w in ("exist", "inside", "outside", "not an option", "min and max", "twice", "folder")):
            continue  # file and cross-field checks are beyond the schema
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(raw, schema)


def test_schema_vocabulary_matches_the_validator():
    from cairn.server.viewer_manifest import SETTING_TYPES

    schema = json.loads(SCHEMA.read_text())
    assert schema["$defs"]["setting"]["properties"]["type"]["enum"] == list(SETTING_TYPES)
    assert schema["properties"]["inputs"]["enum"] == ["single", "compare"]
    assert set(schema["properties"]) == {
        "$schema", "name", "title", "description", "icon", "entry", "accepts", "inputs",
        "webgl", "view", "imports", "settings",
    }


def test_accepts_glob():
    assert accepts_matches("custom:guiding/*", "custom:guiding/vmf")
    assert accepts_matches("custom:guiding/*", "custom:guiding/a/b")
    assert not accepts_matches("custom:guiding/*", "custom:guidingx")
    assert accepts_matches("custom:?/x", "custom:a/x")
    assert accepts_matches("volume", "volume") and not accepts_matches("volume", "volumes")
    assert accepts_matches("custom:a.b", "custom:a.b") and not accepts_matches("custom:a.b", "custom:axb")


def test_folder_rules(tmp_path):
    root = make_viewer(tmp_path / "v")
    (root / "node_modules").mkdir()
    (root / "node_modules" / "big.js").write_text("x")
    manifest, files = load_folder(root)
    assert [f[0] for f in files] == sorted(FILES)
    assert manifest["name"] == "vmf-sphere"
    (root / "huge.bin").write_bytes(b"\0" * (MAX_FOLDER_BYTES + 1))
    with pytest.raises(ManifestError, match="larger than"):
        load_folder(root)
    with pytest.raises(ManifestError, match="no cairn-viewer.json"):
        load_folder(tmp_path)
    (tmp_path / "w").mkdir()
    (tmp_path / "w" / "cairn-viewer.json").write_text("{nope")
    with pytest.raises(ManifestError, match="not valid JSON"):
        load_folder(tmp_path / "w")


def test_mime_by_extension():
    assert mime_for("a/b.js") == mime_for("x.mjs") == "text/javascript"
    assert mime_for("s.css") == "text/css"
    assert mime_for("m.wasm") == "application/wasm"
    assert mime_for("d.json") == "application/json"
    assert mime_for("i.png") == "image/png" and mime_for("i.svg") == "image/svg+xml"
    assert mime_for("x.unknownext") == "application/octet-stream"


# ---------------------------------------------------------------------------
# Publishing + listing
# ---------------------------------------------------------------------------

def test_publish_dedupes_by_content(tmp_path):
    repo = tmp_path / ".cairn"
    root = make_viewer(tmp_path / "v")
    v1 = cairn.publish_viewer(root, project="Proj", repo=repo)
    assert (v1.name, v1.type, v1.version) == ("vmf-sphere", "cairn-viewer", 1)
    assert v1.metadata["manifest"]["title"] == "Guiding distribution"
    assert {e.path for e in v1.files()} == set(FILES)
    again = cairn.publish_viewer(root, project="Proj", repo=repo, aliases=["stable"])
    assert again.id == v1.id and "stable" in again.aliases
    (root / "index.js").write_text("export const changed = true;\n")
    v2 = cairn.publish_viewer(root, project="Proj", repo=repo)
    assert v2.version == 2 and v2.metadata["content_digest"] != v1.metadata["content_digest"]

    # Run.use_viewer publishes only on change and records the producer.
    with cairn.Run(project="Proj", repo=repo, **QUIET) as run:
        same = run.use_viewer(root)
        assert same.id == v2.id
        (root / "index.js").write_text("export const again = 1;\n")
        v3 = run.use_viewer(root)
    assert v3.version == 3
    assert v3.logged_by().id == run.id

    # Another type under the viewer's name is refused.
    other = make_viewer(tmp_path / "o", {**GOOD, "name": "ckpt"})
    cairn.log_artifact(b"x", "ckpt", project="Proj", repo=repo)
    with pytest.raises(ValueError, match="not a viewer"):
        cairn.publish_viewer(other, project="Proj", repo=repo)


def test_viewers_list_and_files(tmp_path):
    repo = tmp_path / ".cairn"
    root = make_viewer(tmp_path / "v")
    cairn.publish_viewer(root, project="p", repo=repo)
    (root / "index.js").write_text("export const two = 2;\n")
    v2 = cairn.publish_viewer(root, project="p", repo=repo)
    cairn.log_artifact(b"x", "not-a-viewer", project="p", repo=repo)
    with TestClient(create_app(data_dir=repo, background_tasks=False)) as client:
        (entry,) = own(client.get("/api/projects/p/viewers").json()["viewers"])
        assert entry["version_id"] == v2.id and entry["version"] == 2 and entry["dev"] is False
        assert entry["accepts"] == GOOD["accepts"] and entry["inputs"] == "compare"
        assert entry["settings"][0]["default"] == 1 and entry["imports"]["d3"] == "./vendor/d3.js"
        assert entry["digest"] == v2.digest and entry["content_digest"] and entry["updated_at"]
        assert entry["error"] is None and entry["icon"] is None and entry["settings"][0]["tab"] == "display"
        both = own(client.get("/api/projects/p/viewers", params={"all_versions": 1}).json()["viewers"])
        assert [v["version"] for v in both] == [2, 1]
        assert own(client.get("/api/projects/other/viewers").json()["viewers"]) == []

        r = client.get(f"/api/artifact-versions/{v2.id}/file", params={"path": "index.js"})
        assert r.status_code == 200 and r.text == "export const two = 2;\n"
        assert r.headers["content-type"].startswith("text/javascript")
        assert r.headers["x-content-type-options"] == "nosniff"
        assert r.headers["content-security-policy"] == "sandbox"
        files = client.get(f"/api/artifact-versions/{v2.id}/files").json()["files"]
        assert {f["path"] for f in files} == set(FILES)


def test_blob_headers_and_media_still_served(tmp_path):
    import numpy as np

    repo = tmp_path / ".cairn"
    with cairn.Run(project="p", repo=repo, **QUIET) as run:
        run.track(cairn.Image(np.zeros((4, 4, 3), np.uint8)), "img", 0)
    with TestClient(create_app(data_dir=repo, background_tasks=False)) as client:
        (seq,) = client.get(f"/api/runs/{run.id}/sequences/img").json()["points"]
        r = client.get(f"/api/artifacts/{seq['artifact_hash']}")
        assert r.status_code == 200 and r.headers["content-type"] == "image/png"
        assert r.headers["x-content-type-options"] == "nosniff"
        assert r.headers["content-security-policy"] == "sandbox"
        # Ranges (video/audio seeking) and 304s keep the headers too.
        part = client.get(f"/api/artifacts/{seq['artifact_hash']}", headers={"Range": "bytes=0-3"})
        assert part.status_code == 206 and part.headers["content-security-policy"] == "sandbox"


# ---------------------------------------------------------------------------
# Dev sources
# ---------------------------------------------------------------------------

class _Clock:
    def __init__(self) -> None:
        self.t = 0.0

    def __call__(self) -> float:
        return self.t


def _sha(b: bytes) -> str:
    import hashlib

    return hashlib.sha256(b).hexdigest()


def test_dev_store_lifecycle():
    clock = _Clock()
    store = DevStore(ttl_s=30, clock=clock)
    manifest = json.dumps({"name": "v", "accepts": ["image"]}).encode()
    index = b"export {};"
    files = {"cairn-viewer.json": _sha(manifest), "index.js": _sha(index)}
    out = store.declare("p", "v", "session-1", files)
    assert out == {"missing": ["cairn-viewer.json", "index.js"], "revision": 0}
    assert store.entries("p") == []  # incomplete: not listed
    store.put("p", "v", "session-1", "cairn-viewer.json", manifest)
    out = store.put("p", "v", "session-1", "index.js", index)
    assert out == {"missing": [], "revision": 1}
    (entry,) = store.entries("p")
    assert entry["dev"] is True and entry["revision"] == 1 and entry["error"] is None
    assert entry["accepts"] == ["image"] and entry["version_id"] is None
    # Heartbeat with the same set: no bump.
    assert store.declare("p", "v", "session-1", files)["revision"] == 1
    # A change: declare -> upload -> bump.
    index2 = b"export const a = 1;"
    files2 = {**files, "index.js": _sha(index2)}
    assert store.declare("p", "v", "session-1", files2) == {"missing": ["index.js"], "revision": 1}
    with pytest.raises(Exception, match="does not match"):
        store.put("p", "v", "session-1", "index.js", b"other bytes")
    assert store.put("p", "v", "session-1", "index.js", index2)["revision"] == 2
    assert store.get("p", "v").read("index.js") == index2
    # A removal alone (all content held) bumps at declare time.
    assert store.declare("p", "v", "session-1", {"cairn-viewer.json": _sha(manifest)})["revision"] == 3
    (entry,) = store.entries("p")
    assert "entry 'index.js' does not exist" in entry["error"]
    # Wrong session: 409; expiry after 30 s of silence.
    with pytest.raises(Exception, match="another session"):
        store.put("p", "v", "intruder-x", "index.js", index2)
    clock.t = 29
    assert store.entries("p")
    clock.t = 60
    assert store.entries("p") == []


def _dev_folder(tmp_path) -> Path:
    return make_viewer(tmp_path / "dev", {"name": "devv", "accepts": ["custom:k"]})


def test_dev_routes_and_cli_sync(tmp_path):
    from cairn.sdk.custom_viewers import DevSync

    app = create_app(data_dir=tmp_path / "cairn", auth_enabled=True, background_tasks=False)
    with TestClient(app) as client:
        _id, writer = auth_core.create_token(app.state.db, name="w", role="write")
        _id, reader = auth_core.create_token(app.state.db, name="r", role="read")
        client.headers.update({"Authorization": f"Bearer {writer}"})
        root = _dev_folder(tmp_path)
        sync = DevSync(client, "p", root)
        assert sync.sync() == 1
        assert sync.sync() == 1  # unchanged
        (root / "index.js").write_text("export const v = 2;\n")
        assert sync.sync() == 2

        ro = TestClient(app)
        ro.headers.update({"Authorization": f"Bearer {reader}"})
        (entry,) = own(ro.get("/api/projects/p/viewers").json()["viewers"])
        assert entry["dev"] is True and entry["name"] == "devv" and entry["revision"] == 2
        files = ro.get("/api/projects/p/viewers/dev/devv/files").json()
        assert files["revision"] == 2 and "index.js" in {f["path"] for f in files["files"]}
        r = ro.get("/api/projects/p/viewers/dev/devv/file", params={"path": "index.js"})
        assert r.text == "export const v = 2;\n"
        assert r.headers["content-type"].startswith("text/javascript")
        assert r.headers["cache-control"] == "no-store"
        assert r.headers["content-security-policy"] == "sandbox"
        assert r.headers["x-content-type-options"] == "nosniff"
        assert ro.get("/api/projects/p/viewers/dev/devv/file", params={"path": "nope.js"}).status_code == 404
        # A read token cannot write a dev source.
        r = ro.post("/api/projects/p/viewers/dev/devv", json={"session": "s" * 16, "files": {}})
        assert r.status_code == 403
        # Stop removes it.
        sync.close()
        assert own(ro.get("/api/projects/p/viewers").json()["viewers"]) == []
        assert ro.get("/api/projects/p/viewers/dev/devv/files").status_code == 404


def test_dev_store_is_shared_by_apps_on_one_repo(tmp_path):
    from cairn.server.custom_viewers import dev_store_for

    assert dev_store_for(tmp_path) is dev_store_for(tmp_path / "." )
    assert dev_store_for(tmp_path) is not dev_store_for(tmp_path / "other")


# ---------------------------------------------------------------------------
# Share scope
# ---------------------------------------------------------------------------

def test_share_scope_includes_report_viewers_only(tmp_path):
    repo = tmp_path / ".cairn"
    used = make_viewer(tmp_path / "used", {"name": "used", "accepts": ["custom:k"]})
    pinned = make_viewer(tmp_path / "pinned", {"name": "pinned", "accepts": ["custom:k"]})
    unused = make_viewer(tmp_path / "unused", {"name": "unused", "accepts": ["custom:k"]})
    used_v1 = cairn.publish_viewer(used, project="p", repo=repo)
    (used / "index.js").write_text("export const v2 = 1;\n")
    used_v2 = cairn.publish_viewer(used, project="p", repo=repo)
    pinned_v1 = cairn.publish_viewer(pinned, project="p", repo=repo)
    (pinned / "index.js").write_text("export const v2 = 1;\n")
    pinned_v2 = cairn.publish_viewer(pinned, project="p", repo=repo)
    unused_v1 = cairn.publish_viewer(unused, project="p", repo=repo)
    with cairn.Run(project="p", repo=repo, **QUIET) as run:
        run.track(cairn.Data([1], kind="k"), "d", 0)

    app = create_app(data_dir=repo, auth_enabled=True, background_tasks=False)
    with TestClient(app) as owner:
        _id, token = auth_core.create_token(app.state.db, name="w", role="write")
        owner.headers.update({"Authorization": f"Bearer {token}"})
        source = (
            f"```cairn\nruns: {{ids: [{run.id}]}}\ncards:\n"
            "  - {metric: d, type: custom, settings: {viewer: used}}\n"
            "  - {metric: d, type: custom, settings: {viewer: pinned, viewer_version: 1}}\n```"
        )
        rid = owner.post("/api/projects/p/reports", json={"name": "r", "payload": {"source": source}}).json()["id"]
        secret = owner.post(f"/api/projects/p/reports/{rid}/shares", json={}).json()["secret"]
        viewer = TestClient(app)
        assert viewer.post("/api/share/redeem", json={"secret": secret}).status_code == 200

        listed = own(viewer.get("/api/projects/p/viewers").json()["viewers"])
        assert {v["version_id"] for v in listed} == {used_v2.id, pinned_v1.id}
        assert all(not v["dev"] for v in listed)
        for vid in (used_v2.id, pinned_v1.id):
            assert viewer.get(f"/api/artifact-versions/{vid}/files").status_code == 200
            assert viewer.get(f"/api/artifact-versions/{vid}/file", params={"path": "index.js"}).status_code == 200
        for vid in (used_v1.id, pinned_v2.id, unused_v1.id):
            assert viewer.get(f"/api/artifact-versions/{vid}/files").status_code == 403
            assert viewer.get(f"/api/artifact-versions/{vid}/file", params={"path": "index.js"}).status_code == 403
        assert viewer.get("/api/projects/other/viewers").status_code == 403
        assert viewer.get("/api/projects/p/viewers/dev/used/files").status_code == 403
        # The share roster carries the custom kind.
        ctx = viewer.get("/api/share/context").json()
        (seq,) = ctx["metric_index"][run.id]
        assert seq["object_type"] == "custom" and seq["kind"] == "k"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def test_cli_publish_and_ls(tmp_path):
    from cairn.cli import main

    repo = str(tmp_path / ".cairn")
    root = make_viewer(tmp_path / "v")
    runner = CliRunner()
    r = runner.invoke(main, ["viewer", "publish", str(root), "--project", "p", "--repo", repo])
    assert r.exit_code == 0, r.output
    assert "p/vmf-sphere:v1" in r.output
    r = runner.invoke(main, ["viewer", "publish", str(root), "--project", "p", "--repo", repo])
    assert "p/vmf-sphere:v1" in r.output  # unchanged: same version
    r = runner.invoke(main, ["viewer", "ls", "--project", "p", "--repo", repo])
    assert r.exit_code == 0 and "vmf-sphere" in r.output and "v1" in r.output
    (root / "cairn-viewer.json").write_text(json.dumps({**GOOD, "entry": "gone.js"}))
    r = runner.invoke(main, ["viewer", "publish", str(root), "--project", "p", "--repo", repo])
    assert r.exit_code != 0 and "does not exist" in r.output


def test_cli_dev_needs_a_server(tmp_path):
    from cairn.cli import main

    root = make_viewer(tmp_path / "v")
    r = CliRunner().invoke(main, ["viewer", "dev", str(root), "--project", "p", "--repo", str(tmp_path / ".cairn")])
    assert r.exit_code != 0 and "running server" in r.output


# ---------------------------------------------------------------------------
# cairn viewer add (vendoring)
# ---------------------------------------------------------------------------

def _fake_cdn(pages: dict[str, str]):
    fetched: list[str] = []

    def fetch(url: str) -> bytes:
        fetched.append(url)
        if url not in pages:
            raise AssertionError(f"unexpected fetch {url}")
        return pages[url].encode()

    return fetch, fetched


def test_add_vendors_a_module_graph(tmp_path):
    from cairn.sdk.viewer_vendor import add_package

    root = make_viewer(tmp_path / "v", {"name": "v", "accepts": ["image"]})
    fetch, fetched = _fake_cdn({
        "https://esm.sh/d3@7?bundle&target=es2022":
            '/* esm.sh - d3@7.9.0 */\nexport * from "/d3@7.9.0/es2022/d3.bundle.mjs";\n'
            'export { default } from "/d3@7.9.0/es2022/d3.bundle.mjs";\n',
        "https://esm.sh/d3@7.9.0/es2022/d3.bundle.mjs":
            'import{a as b}from"/d3@7.9.0/es2022/chunk.mjs";import "./side.mjs";'
            'const lazy=()=>import("https://esm.sh/d3@7.9.0/es2022/lazy.mjs");'
            'import * as t from "three";export const d3=b;export default d3;',
        "https://esm.sh/d3@7.9.0/es2022/chunk.mjs": "export const a = 1;",
        "https://esm.sh/d3@7.9.0/es2022/side.mjs": "globalThis.x = 1;",
        "https://esm.sh/d3@7.9.0/es2022/lazy.mjs": "export const lazy = 1;",
    })
    result = add_package(root, "d3@7", fetch=fetch)
    assert result.name == "d3" and result.entry == "./vendor/d3.js"
    assert result.bare_imports == ["three"]
    assert set(result.files) == {
        "vendor/d3.js",
        "vendor/esm.sh/d3@7.9.0/es2022/d3.bundle.mjs",
        "vendor/esm.sh/d3@7.9.0/es2022/chunk.mjs",
        "vendor/esm.sh/d3@7.9.0/es2022/side.mjs",
        "vendor/esm.sh/d3@7.9.0/es2022/lazy.mjs",
    }
    stub = (root / "vendor/d3.js").read_text()
    assert 'from "./esm.sh/d3@7.9.0/es2022/d3.bundle.mjs"' in stub
    bundle = (root / "vendor/esm.sh/d3@7.9.0/es2022/d3.bundle.mjs").read_text()
    assert 'from"./chunk.mjs"' in bundle
    assert 'import "./side.mjs"' in bundle
    assert 'import("./lazy.mjs")' in bundle
    assert 'from "three"' in bundle
    manifest = json.loads((root / "cairn-viewer.json").read_text())
    assert manifest["imports"] == {"d3": "./vendor/d3.js"}
    # The folder is still a valid viewer (the import target exists).
    load_folder(root)


def test_add_names_subpaths_and_externals(tmp_path):
    from cairn.sdk.viewer_vendor import add_package, import_name

    assert import_name("three@0.170/examples/jsm/controls/OrbitControls.js") == \
        "three/examples/jsm/controls/OrbitControls.js"
    assert import_name("@scope/pkg@1.2/sub") == "@scope/pkg/sub"
    assert import_name("lodash-es") == "lodash-es"
    with pytest.raises(ValueError):
        import_name("not a spec")
    root = make_viewer(tmp_path / "v", {"name": "v", "accepts": ["image"]})
    spec = "three@0.170/examples/jsm/controls/OrbitControls.js"
    fetch, fetched = _fake_cdn({
        f"https://esm.sh/{spec}?bundle&target=es2022&external=three":
            'import * as T from "three"; export class OrbitControls {}',
    })
    result = add_package(root, spec, externals=["three"], fetch=fetch)
    assert result.entry == "./vendor/three/examples/jsm/controls/OrbitControls.js"
    assert result.bare_imports == ["three"]
    result = add_package(root, spec, name="orbit", externals=["three"], fetch=fetch)
    assert result.entry == "./vendor/orbit.js"
    imports = json.loads((root / "cairn-viewer.json").read_text())["imports"]
    assert set(imports) == {"three/examples/jsm/controls/OrbitControls.js", "orbit"}
    with pytest.raises(ValueError, match="invalid import name"):
        add_package(root, "d3@7", name="cairn:x", fetch=fetch)


def test_cli_add_reports_errors(tmp_path):
    from cairn.cli import main

    r = CliRunner().invoke(main, ["viewer", "add", str(tmp_path), "d3@7"])
    assert r.exit_code != 0 and "cairn-viewer.json" in r.output


@pytest.mark.slow
@pytest.mark.network
def test_add_from_the_real_cdn(tmp_path):
    from cairn.sdk.viewer_vendor import add_package

    root = make_viewer(tmp_path / "v", {"name": "v", "accepts": ["image"]})
    try:
        result = add_package(root, "d3-array@3")
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"no network: {exc}")
    assert (root / result.entry).is_file()
    load_folder(root)


def test_cli_init_writes_the_minimal_example(tmp_path, monkeypatch):
    """`cairn viewer init hist --kind demo/hist` is exactly examples/custom_viewers/minimal/hist."""
    from cairn.cli import main

    example = Path(__file__).resolve().parents[2] / "examples" / "custom_viewers" / "minimal" / "hist"
    monkeypatch.chdir(tmp_path)
    r = CliRunner().invoke(main, ["viewer", "init", "hist", "--kind", "demo/hist"])
    assert r.exit_code == 0, r.output
    made = sorted(p.name for p in (tmp_path / "hist").iterdir())
    assert made == sorted(p.name for p in example.iterdir()) == ["README.md", "cairn-viewer.json", "index.js"]
    for name in made:
        assert (tmp_path / "hist" / name).read_text() == (example / name).read_text(), name
    # A valid, publishable viewer: two settings, one on the Display tab and one on the Data tab.
    manifest, _ = load_folder(tmp_path / "hist")
    assert manifest["name"] == "hist" and manifest["accepts"] == ["custom:demo/hist"]
    assert [(s["key"], s["tab"]) for s in manifest["settings"]] == [("color", "display"), ("normalize", "data")]
    # Never over an existing viewer.
    r = CliRunner().invoke(main, ["viewer", "init", "hist"])
    assert r.exit_code != 0 and "exists already" in r.output


def test_cli_init_three_and_defaults(tmp_path):
    from cairn.cli import main

    r = CliRunner().invoke(main, ["viewer", "init", str(tmp_path / "My Points"), "--three"])
    assert r.exit_code == 0, r.output
    manifest, files = load_folder(tmp_path / "My Points")
    assert manifest["name"] == "my-points" and manifest["accepts"] == ["custom:my-points"]
    assert manifest["webgl"] is True
    assert 'from "cairn:three"' in (tmp_path / "My Points" / "index.js").read_text()
    # It publishes as is.
    repo = str(tmp_path / ".cairn")
    r = CliRunner().invoke(main, ["viewer", "publish", str(tmp_path / "My Points"), "--project", "p", "--repo", repo])
    assert r.exit_code == 0 and "p/my-points:v1" in r.output, r.output
    r = CliRunner().invoke(main, ["viewer", "init", str(tmp_path / "x"), "--kind", "Bad Kind"])
    assert r.exit_code != 0 and "invalid data kind" in r.output


def test_share_scope_includes_viewers_a_card_may_pick(tmp_path):
    """A custom card without `viewer` puts the viewers it may pick (its kind's
    default, or one accepting custom data) in scope; a volume card's default
    is the built-in viewer, which needs no scope, until the project names its
    own (cairn.server.viewer_defaults)."""
    repo = tmp_path / ".cairn"
    kinds = make_viewer(tmp_path / "kinds", {"name": "kinds", "accepts": ["custom:k/*"]})
    vol = make_viewer(tmp_path / "vol", {"name": "vol", "accepts": ["volume"]})
    img = make_viewer(tmp_path / "img", {"name": "img", "accepts": ["image"]})
    kinds_v1 = cairn.publish_viewer(kinds, project="p", repo=repo)
    vol_v1 = cairn.publish_viewer(vol, project="p", repo=repo)
    img_v1 = cairn.publish_viewer(img, project="p", repo=repo)
    with cairn.Run(project="p", repo=repo, **QUIET) as run:
        run.track(cairn.Data([1], kind="k/a"), "d", 0)

    app = create_app(data_dir=repo, auth_enabled=True, background_tasks=False)
    with TestClient(app) as owner:
        _id, token = auth_core.create_token(app.state.db, name="w", role="write")
        owner.headers.update({"Authorization": f"Bearer {token}"})

        def listed(cards: str) -> set[str]:
            source = f"```cairn\nruns: {{ids: [{run.id}]}}\ncards:\n{cards}```"
            rid = owner.post("/api/projects/p/reports", json={"name": "r", "payload": {"source": source}}).json()["id"]
            secret = owner.post(f"/api/projects/p/reports/{rid}/shares", json={}).json()["secret"]
            viewer = TestClient(app)
            assert viewer.post("/api/share/redeem", json={"secret": secret}).status_code == 200
            return {v["version_id"] for v in own(viewer.get("/api/projects/p/viewers").json()["viewers"])}

        assert listed("  - {metric: d, type: custom}\n") == {kinds_v1.id}
        assert listed("  - {metric: blob, type: volume}\n") == set()
        assert listed("  - {metric: d, type: scalar}\n") == set()
        assert img_v1.id not in listed("  - {metric: d, type: custom}\n  - {metric: blob, type: volume}\n")
        owner.put("/api/projects/p/viewer-defaults", json={"kind": "volume", "viewer": "vol"})
        assert listed("  - {metric: blob, type: volume}\n") == {vol_v1.id}
