"""The data commands of the CLI on BOTH targets: a local repo (no server)
and a live server. Every test runs with HOME, the XDG dirs, the config file,
the WAL and spill dirs and the working directory inside tmp_path, so the
user's config and caches are never read or written."""

from __future__ import annotations

import contextlib
import json
import threading
import time
import zipfile
from pathlib import Path
from typing import Any, Iterator

import pytest
import uvicorn
from click.testing import CliRunner

import cairn
from cairn import cli, config
from cairn.server.app import create_app
from cairn.server.storage.datadir import DataDir
from tests.conftest import _find_free_port

QUIET = dict(capture_source=False, capture_stdout=False, capture_env=False,
             capture_system_metrics=False)


@pytest.fixture(autouse=True)
def _isolated(monkeypatch, tmp_path):
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(home / ".config"))
    monkeypatch.setenv("XDG_CACHE_HOME", str(home / ".cache"))
    monkeypatch.setattr(config, "config_file_path", lambda: tmp_path / "config.toml")
    monkeypatch.setattr(cli, "default_spill_dir", lambda: tmp_path / "spill")
    monkeypatch.setenv("CAIRN_WAL_DIR", str(tmp_path / "wal"))
    for var in ("CAIRN_REPO", "CAIRN_SERVER", "CAIRN_TOKEN", "CAIRN_ARTIFACT_DIR"):
        monkeypatch.delenv(var, raising=False)
    cwd = tmp_path / "cwd"
    cwd.mkdir()
    monkeypatch.chdir(cwd)
    monkeypatch.setattr("webbrowser.open", lambda _url: False)
    config.reset_configured()
    yield
    config.reset_configured()


@contextlib.contextmanager
def _serve(app: Any) -> Iterator[str]:
    port = _find_free_port()
    server = uvicorn.Server(uvicorn.Config(app=app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 10
    while not server.started and time.time() < deadline:
        time.sleep(0.02)
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(timeout=10)


class Target:
    """Where the seed data lives and how the CLI names it."""

    def __init__(self, kind: str, repo: str, args: list[str], root: Path) -> None:
        self.kind, self.repo, self.args, self.root = kind, repo, args, root

    def run(self, *argv: str, ok: bool = True) -> Any:
        cmd = list(argv)
        # Options go after the subcommand path (`artifact alias add REF ...`).
        result = CliRunner().invoke(cli.main, cmd + self.args)
        if ok:
            assert result.exit_code == 0, result.output
        return result


@pytest.fixture(params=["local", "server"])
def target(request, tmp_path) -> Iterator[Target]:
    if request.param == "local":
        root = tmp_path / "repo" / ".cairn"
        yield Target("local", str(root), ["--repo", str(root)], root)
        return
    root = tmp_path / "srv"
    with _serve(create_app(data_dir=root, mount_ui=False)) as url:
        yield Target("server", url.replace("http://", "cairn://"), ["--server", url], root)


def _seed(t: Target) -> dict[str, str]:
    """prep -> data:v1 -> train -> model:v1, model:v2 (alias best) -> eval;
    a second project with one run; one report."""
    ids: dict[str, str] = {}
    with cairn.Run("proj", name="prep", repo=t.repo, **QUIET) as run:
        run.log_artifact({"rows": 3}, "data", type="dataset")
        ids["prep"] = run.id
    with cairn.Run("proj", name="train", repo=t.repo, **QUIET) as run:
        run.use_artifact("data:v1")
        for step in range(3):
            run.track(1.0 / (step + 1), name="loss", step=step)
        run.log_artifact(b"weights-1", "model", type="model")
        run.log_artifact(b"weights-2", "model", type="model", aliases=["best"])
        ids["train"] = run.id
    with cairn.Run("proj", name="eval", repo=t.repo, **QUIET) as run:
        run.use_artifact("model:best")
        ids["eval"] = run.id
    with cairn.Run("other", name="solo", repo=t.repo, **QUIET) as run:
        ids["solo"] = run.id
    from cairn.cli_target import open_api

    repo, server = (t.repo, None) if t.kind == "local" else (None, t.args[1])
    with open_api(repo, server) as api:
        ids["report"] = api.post("/api/projects/proj/reports", json={
            "name": "Findings", "payload": {"source": "# Findings\n\nLoss falls.\n"},
        }).json()["id"]
    return ids


# ---------------------------------------------------------------------------
# Runs
# ---------------------------------------------------------------------------


def test_ping(target):
    _seed(target)
    out = target.run("ping").output
    health = json.loads(out)
    assert health["status"] == "ok"
    if target.kind == "local":
        assert health["repo"] == str(target.root.resolve())
        assert (health["projects"], health["runs"], health["series"], health["points"]) == (2, 4, 1, 3)
        assert health["artifact_versions"] == 3 and health["reports"] == 1
        assert health["schema_version"] == 2 and health["layout_version"] == "3"
        assert health["served_by"] is None and health["pending_wal_logs"] == 0
    else:
        assert "version" in health and "uptime_sec" in health


def test_list_archive_unarchive_rm(target):
    ids = _seed(target)
    rows = json.loads(target.run("list", "--project", "proj", "--format", "json").output)
    assert {r["name"] for r in rows} == {"prep", "train", "eval"}

    out = target.run("archive", ids["prep"], ids["eval"]).output
    assert f"archived {ids['prep']}" in out and f"archived {ids['eval']}" in out
    names = {r["name"] for r in json.loads(target.run("list", "--format", "json").output)}
    assert names == {"train", "solo"}
    only = json.loads(target.run("list", "--archived", "only", "--format", "json").output)
    assert {r["name"] for r in only} == {"prep", "eval"}

    target.run("unarchive", ids["eval"])
    names = {r["name"] for r in json.loads(target.run("list", "--format", "json").output)}
    assert names == {"train", "eval", "solo"}

    assert f"deleted {ids['solo']}" in target.run("rm", ids["solo"]).output
    names = {r["name"] for r in json.loads(target.run("list", "--format", "json").output)}
    assert names == {"train", "eval"}

    for argv in (["rm", "nope"], ["archive", "nope"]):
        result = target.run(*argv, ok=False)
        assert result.exit_code == 1 and "Traceback" not in result.output
        assert "run nope not found" in result.output
        assert result.output.count("\n") == 1


def test_export_tables(target, tmp_path):
    ids = _seed(target)
    out = tmp_path / "run.json"
    target.run("export", ids["train"], "-o", str(out))
    payload = json.loads(out.read_text())
    assert payload["run"]["run"]["id"] == ids["train"]
    assert [p["scalar_value"] for p in payload["sequences"]["loss"]] == [1.0, 0.5, 1 / 3]
    csv = tmp_path / "run.csv"
    target.run("export", ids["train"], "--format", "csv", "-o", str(csv))
    assert csv.read_text().splitlines()[0] == "run_id,name,step,wall_time,value"
    pytest.importorskip("pandas")
    proj = tmp_path / "proj.csv"
    target.run("export", "--project", "proj", "--format", "csv", "-o", str(proj))
    assert len(proj.read_text().splitlines()) == 4


def test_export_runs_import_runs(target, tmp_path):
    ids = _seed(target)
    archive = tmp_path / "runs.zip"
    out = target.run("export-runs", ids["train"], ids["eval"], "-o", str(archive)).output
    assert "exported 2 run(s)" in out
    with zipfile.ZipFile(archive) as zf:
        assert json.loads(zf.read("manifest.json"))["run_ids"] == [ids["train"], ids["eval"]]

    imported = json.loads(target.run("import-runs", str(archive), "--format", "json").output)
    assert [r["original_id"] for r in imported] == [ids["train"], ids["eval"]]
    assert all(r["new_id"] not in ids.values() for r in imported)

    table = target.run("import-runs", str(archive), "--project", "Copied Runs").output
    assert table.splitlines()[0].split() == ["NEW_ID", "ORIGINAL_ID", "NAME"]
    rows = json.loads(target.run("list", "--project", "copied-runs", "--format", "json").output)
    assert sorted(r["name"] for r in rows) == ["eval", "train"]
    # The registry entries moved with the runs.
    fams = json.loads(target.run("artifact", "ls", "--project", "copied-runs", "--format", "json").output)
    assert {f["name"] for f in fams} == {"model", "data"}

    bad = tmp_path / "bad.zip"
    bad.write_bytes(b"not a zip")
    result = target.run("import-runs", str(bad), ok=False)
    assert result.exit_code == 1 and "Invalid ZIP file" in result.output


def test_open(target):
    ids = _seed(target)
    result = target.run("open", ids["train"], "--no-browser")
    if target.kind == "local":
        # No viewer runs over the repo: the URL it will have, and how to start one.
        assert result.stdout.strip() == f"http://localhost:4301/p/proj/r/{ids['train']}"
        assert f"cairn ui --repo {target.root.resolve()}" in result.stderr
    else:
        assert result.stdout.strip().endswith(f"/p/proj/r/{ids['train']}")


def test_run_url_is_the_open_url(tmp_path):
    """``Run.url`` is the page ``cairn open`` prints: the paired UI port of a
    ``cairn server --ui``, never the ingest port the run writes to."""
    app = create_app(data_dir=tmp_path / "srv", mount_ui=False)
    app.state.ui_port = 54321
    with _serve(app) as url:
        with cairn.Run("proj", name="r", repo=url.replace("http://", "cairn://"), **QUIET) as run:
            assert run.url == f"http://127.0.0.1:54321/p/proj/r/{run.id}"
        opened = CliRunner().invoke(cli.main, ["open", run.id, "--no-browser", "--server", url])
        assert opened.stdout.strip() == run.url
    # A local repo with no viewer running: the URL once `cairn ui` starts.
    root = tmp_path / "repo" / ".cairn"
    with cairn.Run("proj", name="r", repo=str(root), **QUIET) as run:
        assert run.url == f"http://localhost:4301/p/proj/r/{run.id}"


def test_diff_takes_the_target_order(target, tmp_path, monkeypatch):
    ids = _seed(target)
    result = target.run("diff", ids["train"], ok=False)
    assert result.exit_code == 1
    assert "no source snapshot" in result.output


def test_viewer_ls_lists_builtins(target):
    from cairn.server.custom_viewers import builtin_viewers

    builtins = sorted(builtin_viewers())
    assert "cairn.volume" in builtins  # the viewer bundle is installed in dev
    _seed(target)
    out = target.run("viewer", "ls", "--project", "proj").output
    assert "vNone" not in out
    rows = {line.split()[0]: line.split()[1] for line in out.splitlines()[1:]}
    assert {name: rows.get(name) for name in builtins} == {name: "built-in" for name in builtins}


# ---------------------------------------------------------------------------
# Artifacts
# ---------------------------------------------------------------------------


def test_artifact_ls_and_versions(target):
    _seed(target)
    out = target.run("artifact", "ls").output.splitlines()
    assert out[0].split() == ["PROJECT", "NAME", "TYPE", "VERSIONS", "ALIASES", "UPDATED"]
    model = next(line for line in out if " model " in line)
    assert "latest=v2,best=v2" in model and model.split()[3] == "2"
    fams = json.loads(target.run("artifact", "ls", "--project", "proj", "--type", "dataset",
                                 "--format", "json").output)
    assert [f["name"] for f in fams] == ["data"]

    vers = json.loads(target.run("artifact", "versions", "proj/model", "--format", "json").output)
    assert [(v["ref"], v["aliases"]) for v in vers] == [("model:v1", []), ("model:v2", ["latest", "best"])]
    assert vers[0]["run_name"] == "train"
    table = target.run("artifact", "versions", "model", "--project", "proj").output.splitlines()
    assert table[0].split() == ["VERSION", "ALIASES", "TAGS", "SIZE", "FILES", "STEP", "CREATED", "RUN"]

    result = target.run("artifact", "versions", "model", ok=False)
    assert result.exit_code == 2 and "pass --project or PROJECT/model" in result.output
    result = target.run("artifact", "versions", "proj/nope", ok=False)
    assert result.exit_code == 1 and "'nope'" in result.output and result.output.count("\n") == 1


def test_artifact_get(target, tmp_path):
    _seed(target)
    dest = tmp_path / "dl"
    out = target.run("artifact", "get", "proj/model:best", "-o", str(dest))
    assert out.stdout.strip() == str(dest)
    (f,) = [p for p in dest.rglob("*") if p.is_file()]
    assert f.read_bytes() == b"weights-2"
    out = target.run("artifact", "get", "proj/model:v1")
    root = Path(out.stdout.strip())
    assert root == Path("artifacts/model-v1")
    assert [p.read_bytes() for p in root.rglob("*") if p.is_file()] == [b"weights-1"]


def test_artifact_aliases_and_tags(target):
    _seed(target)
    out = target.run("artifact", "alias", "add", "proj/model:v1", "prod").output
    assert out.strip() == "proj/model:v1: aliases prod"
    out = target.run("artifact", "alias", "rm", "proj/model:v1", "prod").output
    assert out.strip() == "proj/model:v1: aliases (none)"
    result = target.run("artifact", "alias", "add", "proj/model:v1", "latest", ok=False)
    assert result.exit_code == 1 and "reserved" in result.output

    assert target.run("artifact", "tag", "add", "model:v2", "good", "--project", "proj").output.strip() \
        == "proj/model:v2: tags good"
    assert target.run("artifact", "tag", "rm", "proj/model:v2", "good").output.strip() \
        == "proj/model:v2: tags (none)"


def test_artifact_rm(target):
    _seed(target)
    result = target.run("artifact", "rm", "proj/model:v2", ok=False)
    assert result.exit_code == 1 and "has aliases" in result.output
    target.run("artifact", "rm", "proj/model:v2", "--force")
    vers = json.loads(target.run("artifact", "versions", "proj/model", "--format", "json").output)
    assert [(v["ref"], v["aliases"]) for v in vers] == [("model:v1", ["latest"])]

    result = target.run("artifact", "rm", "proj/data", ok=False)
    assert result.exit_code == 1 and "has 1 version(s); pass --force" in result.output
    assert "deleted proj/data (1 version(s))" in target.run("artifact", "rm", "proj/data", "--force").output
    names = [f["name"] for f in json.loads(target.run("artifact", "ls", "--format", "json").output)]
    assert names == ["model"]


def test_artifact_lineage(target):
    ids = _seed(target)
    out = target.run("artifact", "lineage", "proj/model:v2").output
    assert out.splitlines() == [
        "proj/model:v2 [model] (latest, best)",
        "upstream (where it came from):",
        f"  └── produced by run train ({ids['train'][:8]}, completed)",
        "      └── used proj/data:v1 [dataset] (latest) as input",
        f"          └── produced by run prep ({ids['prep'][:8]}, completed)",
        "downstream (what came of it):",
        f"  └── used by run eval ({ids['eval'][:8]}, completed) as input",
    ]
    up = target.run("artifact", "lineage", "proj/model:v2", "--direction", "upstream", "--depth", "1").output
    assert up.splitlines() == [
        "proj/model:v2 [model] (latest, best)",
        "upstream (where it came from):",
        f"  └── produced by run train ({ids['train'][:8]}, completed)",
    ]
    graph = json.loads(target.run("artifact", "lineage", "proj/data:v1", "--format", "json").output)
    assert graph["center"] == next(n["id"] for n in graph["nodes"] if n.get("ref") == "data:v1")


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------


def test_reports(target, tmp_path):
    ids = _seed(target)
    rid = ids["report"]
    out = target.run("report", "ls").output.splitlines()
    assert out[0].split() == ["ID", "PROJECT", "NAME", "UPDATED", "BLOCKS"]
    assert out[1].split()[:3] == [rid, "proj", "Findings"]
    rows = json.loads(target.run("report", "ls", "--project", "other", "--format", "json").output)
    assert rows == []

    assert target.run("report", "show", rid).output == "# Findings\n\nLoss falls.\n"
    md = tmp_path / "r.md"
    target.run("report", "export", rid, "-o", str(md))
    assert md.read_text() == "# Findings\n\nLoss falls.\n"

    result = target.run("report", "share", rid, ok=False)
    assert result.exit_code == 1
    assert ("is a local repo: share links need a server with auth" if target.kind == "local"
            else "runs without auth (--no-auth)") in result.output

    assert target.run("report", "rm", rid).output.strip() == f"deleted {rid}"
    result = target.run("report", "show", rid, ok=False)
    assert result.exit_code == 1 and f"report {rid} not found" in result.output


def test_report_shares_on_an_auth_server(tmp_path):
    from cairn.server import auth
    from cairn.server.storage.db import Database

    root = tmp_path / "auth-srv"
    dd = DataDir(root)
    db = Database.open(dd.db_path)
    _tid, token = auth.create_token(db, name="ci", role="write")
    db.close()
    with _serve(create_app(data_dir=root, mount_ui=False, auth_enabled=True)) as url:
        t = Target("server", url, ["--server", url], root)
        with pytest.MonkeyPatch.context() as mp:
            mp.setenv("CAIRN_TOKEN", token)
            from cairn.cli_target import open_api

            with open_api(None, url) as api:
                api.post("/api/projects", json={"name": "proj"})
                rid = api.post("/api/projects/proj/reports", json={
                    "name": "R", "payload": {"source": "hi"},
                }).json()["id"]
            share = t.run("report", "share", rid, "--expires", "7d")
            link = share.stdout.strip()
            assert link.startswith(f"{url}/share/")
            listed = json.loads(t.run("report", "shares", rid, "--format", "json").output)
            assert [s["status"] for s in listed] == ["active"]
            share_id = listed[0]["id"]
            assert share_id in share.stderr
            assert t.run("report", "unshare", rid, share_id).output.strip() == f"revoked {share_id}"
            table = t.run("report", "shares", rid).output.splitlines()
            assert table[1].split()[:2] == [share_id, "revoked"]
        # Without a token: one line saying how to log in.
        result = t.run("report", "shares", rid, ok=False)
        assert result.exit_code == 1 and f"cairn login {url}" in result.output


# ---------------------------------------------------------------------------
# Target resolution, served repos, sync
# ---------------------------------------------------------------------------


def test_lookup_order(tmp_path, monkeypatch):
    """--repo/--server > CAIRN_REPO/CAIRN_SERVER > config file > ./.cairn."""
    a, b, c = (tmp_path / n / ".cairn" for n in "abc")
    for root, project in ((a, "pa"), (b, "pb"), (c, "pc")):
        with cairn.Run(project, repo=str(root), **QUIET):
            pass

    def projects() -> set[str]:
        result = CliRunner().invoke(cli.main, ["list", "--format", "json"])
        assert result.exit_code == 0, result.output
        return {r["project"] for r in json.loads(result.output)}

    config.write_config_file({"repo": str(c)})
    assert projects() == {"pc"}
    monkeypatch.setenv("CAIRN_REPO", str(b))
    assert projects() == {"pb"}
    result = CliRunner().invoke(cli.main, ["list", "--format", "json", "--repo", str(a)])
    assert {r["project"] for r in json.loads(result.output)} == {"pa"}
    monkeypatch.delenv("CAIRN_REPO")
    config.write_config_file({})
    monkeypatch.chdir(a.parent)
    assert projects() == {"pa"}
    result = CliRunner().invoke(cli.main, ["list", "--repo", str(a), "--server", "http://x:1"])
    assert result.exit_code == 2 and "not both" in result.output
    # diff follows the same order (it used to prefer ./.cairn over CAIRN_REPO).
    monkeypatch.setenv("CAIRN_REPO", str(b))
    result = CliRunner().invoke(cli.main, ["diff", "nope"])
    assert result.exit_code == 1 and "run nope not found" in result.output
    result = CliRunner().invoke(cli.main, ["ping"])
    assert json.loads(result.output)["repo"] == str(b.resolve())


def test_missing_local_repo_is_one_line(tmp_path):
    missing = tmp_path / "nowhere" / ".cairn"
    for argv in (["list"], ["ping"], ["rm", "x"], ["report", "ls"], ["artifact", "ls"]):
        result = CliRunner().invoke(cli.main, [*argv, "--repo", str(missing)])
        assert result.exit_code == 1, (argv, result.output)
        assert result.output.startswith(f"Error: no Cairn repo at {missing}")
        assert not missing.exists()


def test_a_served_local_repo_is_reached_through_its_server(tmp_path, ui_app):
    """Writes to a repo a live `cairn ui` holds go to that server; `open`
    finds its viewer."""
    from cairn.cli_target import open_api

    root = tmp_path / "cairn"  # the ui_app fixture's repo
    with cairn.Run("proj", name="r", repo=str(root), **QUIET) as run:
        rid = run.id
    with _serve(ui_app) as url:
        port = int(url.rsplit(":", 1)[1])
        dd = DataDir(root)
        dd.acquire_lock("ui", host="127.0.0.1", port=port)
        dd.add_live_server("ui", host="127.0.0.1", port=port)
        try:
            with open_api(str(root), None) as api:
                assert not api.in_process and api.base == url
            result = CliRunner().invoke(cli.main, ["archive", rid, "--repo", str(root)])
            assert result.exit_code == 0, result.output
            result = CliRunner().invoke(cli.main, ["open", rid, "--repo", str(root), "--no-browser"])
            assert result.exit_code == 0, result.output
            assert result.stdout.strip() == f"http://localhost:{port}/p/proj/r/{rid}"
            health = json.loads(CliRunner().invoke(cli.main, ["ping", "--repo", str(root)]).output)
            assert health["served_by"] == url and health["archived_runs"] == 1
        finally:
            dd.remove_live_server()
            dd.release_lock()


def test_sync_ingests_a_local_repos_wal_logs(tmp_path):
    root = tmp_path / "walrepo" / ".cairn"
    with cairn.Run("proj", name="w", repo=str(root), local_wal=True, **QUIET) as run:
        run.track(1.0, name="loss", step=0)
    assert list((root / "wals").glob("*.wal.jsonl"))
    result = CliRunner().invoke(cli.main, ["sync", "--repo", str(root)])
    assert result.exit_code == 0, result.output
    assert "ingested" in result.output and "sync complete" in result.output
    health = json.loads(CliRunner().invoke(cli.main, ["ping", "--repo", str(root)]).output)
    assert (health["runs"], health["points"]) == (1, 1)
    result = CliRunner().invoke(cli.main, ["sync", "--repo", str(root)])
    assert "nothing to sync" in result.output


def test_sync_replays_server_logs_to_the_target_server(tmp_path):
    """A log that names no server goes to the target server; with a local
    target it is reported, not dropped."""
    from cairn.sdk.wal import WriteAheadLog

    with _serve(create_app(data_dir=tmp_path / "srv", mount_ui=False)) as url:
        import httpx

        rid = httpx.post(f"{url}/api/runs", json={"project": "s"}).json()["run_id"]
        wal = WriteAheadLog(rid, tmp_path / "wal")  # no target recorded
        wal.append("params", {"run_id": rid, "params": {"a": 1}})
        wal.close()
        result = CliRunner().invoke(cli.main, ["sync"])
        assert result.exit_code == 1
        assert "names no server" in result.output and "--server URL" in result.output
        result = CliRunner().invoke(cli.main, ["sync", "--server", url])
        assert result.exit_code == 0, result.output
        assert f"{rid}: replayed 1 op(s) -> {url}" in result.output
        assert httpx.get(f"{url}/api/runs/{rid}").json()["config_doc"] == {"a": 1}


def test_configure_sets_one_target(tmp_path):
    repo = tmp_path / "r" / ".cairn"
    result = CliRunner().invoke(cli.main, ["configure", "--server", "http://gpu:4300"])
    assert result.exit_code == 0
    result = CliRunner().invoke(cli.main, ["configure", "--repo", str(repo)])
    assert result.exit_code == 0
    assert config.load_config_file() == {"repo": str(repo.resolve())}
    CliRunner().invoke(cli.main, ["configure", "--server", "http://gpu:4300"])
    assert config.load_config_file() == {"server": "http://gpu:4300"}


def test_local_commands_see_wal_mode_runs_without_a_sync(tmp_path):
    """As cairn.Reader does, a local command ingests WAL-mode logs first."""
    root = tmp_path / "walrepo" / ".cairn"
    with cairn.Run("proj", name="w", repo=str(root), local_wal=True, **QUIET) as run:
        rid = run.id
    result = CliRunner().invoke(cli.main, ["archive", rid, "--repo", str(root)])
    assert result.exit_code == 0, result.output
    result = CliRunner().invoke(cli.main, ["list", "--archived", "only", "--format", "json", "--repo", str(root)])
    assert [r["id"] for r in json.loads(result.output)] == [rid]
