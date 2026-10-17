"""The data commands of the CLI on BOTH targets: a local repo (no server)
and a live server. Every test runs with HOME, the XDG dirs, the config file,
the run directories and the working directory inside tmp_path, so the
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
from cairn.backend.storage.datadir import DataDir
from tests.conftest import _find_free_port, ingest_repo

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
    monkeypatch.setenv("CAIRN_DIR", str(tmp_path / "rundirs"))
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
    with _serve(create_app(data_dir=root, mount_ui=False, auth_enabled=False)) as url:
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
    return ids


# ---------------------------------------------------------------------------
# Runs
# ---------------------------------------------------------------------------


def test_viewer_ls_lists_builtins(target):
    from cairn.backend.custom_viewers import builtin_viewers

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
    model = next(line for line in out if "model" in line.split())
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


# ---------------------------------------------------------------------------
# Target resolution, served repos, sync
# ---------------------------------------------------------------------------


def test_sync_uploads_run_directories_logged_while_the_server_was_down(tmp_path):
    """A run logs into its directory with its server down; `cairn sync
    --server URL --clean` uploads it (once) and then removes the directory."""
    from cairn.sdk.runlog.rundir import RunDir

    with cairn.Run("proj", name="offline", server="http://127.0.0.1:9", **QUIET) as run:
        run.config(a=1)
        for step in range(5):
            run.track(float(step), name="loss", step=step)
    rd = RunDir.for_run(run.id)
    assert rd.exists() and rd.log().acked() == 0
    with _serve(create_app(data_dir=tmp_path / "srv", mount_ui=False, auth_enabled=False)) as url:
        import httpx

        for _ in range(2):  # the second sync sends nothing again
            result = CliRunner().invoke(cli.main, ["sync", str(rd.path), "--server", url])
            assert result.exit_code == 0, result.output
            assert f"{run.id}: uploaded" in result.output
        body = httpx.get(f"{url}/api/runs/{run.id}").json()
        assert body["run"]["status"] == "completed" and body["config_doc"] == {"a": 1}
        pts = httpx.get(f"{url}/api/runs/{run.id}/sequences/loss").json()["points"]
        assert [p["step"] for p in pts] == [0, 1, 2, 3, 4]
        result = CliRunner().invoke(cli.main, ["sync", str(rd.path), "--server", url, "--clean"])
        assert result.exit_code == 0, result.output
        assert "removed 1 run directory" in result.output
    assert not rd.path.exists()
