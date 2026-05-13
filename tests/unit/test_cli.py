"""CLI smoke tests using CliRunner."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from click.testing import CliRunner

from cairn import cli, config


@pytest.fixture(autouse=True)
def _isolate_config(monkeypatch, tmp_path):
    # Redirect config path and spill dir so tests don't touch user state.
    monkeypatch.setattr(
        config, "config_file_path", lambda: tmp_path / "config.toml"
    )
    config.reset_configured()
    yield
    config.reset_configured()


def test_ping_against_live_server(live_server, monkeypatch):
    monkeypatch.setenv("CAIRN_SERVER", live_server)
    runner = CliRunner()
    result = runner.invoke(cli.main, ["ping"])
    assert result.exit_code == 0, result.output
    assert '"status": "ok"' in result.output


def test_list_empty(live_server, monkeypatch):
    monkeypatch.setenv("CAIRN_SERVER", live_server)
    runner = CliRunner()
    result = runner.invoke(cli.main, ["list"])
    assert result.exit_code == 0
    assert "(no runs)" in result.output


def test_list_after_creating_a_run(live_server, monkeypatch):
    import httpx

    monkeypatch.setenv("CAIRN_SERVER", live_server)
    with httpx.Client(base_url=live_server) as c:
        c.post("/api/runs", json={"project": "p", "name": "r1"})
    runner = CliRunner()
    result = runner.invoke(cli.main, ["list"])
    assert result.exit_code == 0
    assert "r1" in result.output or "p" in result.output  # some project/name in output


def test_configure_writes_toml(monkeypatch, tmp_path):
    runner = CliRunner()
    result = runner.invoke(
        cli.main, ["configure", "--server", "http://gpubox.local:4300"]
    )
    assert result.exit_code == 0, result.output
    path = config.config_file_path()
    assert path.exists()
    data = config.load_config_file()
    assert data["server"] == "http://gpubox.local:4300"


def test_rm_deletes_run(live_server, monkeypatch):
    import httpx

    monkeypatch.setenv("CAIRN_SERVER", live_server)
    with httpx.Client(base_url=live_server) as c:
        rid = c.post("/api/runs", json={"project": "p"}).json()["run_id"]
    runner = CliRunner()
    result = runner.invoke(cli.main, ["rm", rid])
    assert result.exit_code == 0
    # Verify
    with httpx.Client(base_url=live_server) as c:
        assert c.get(f"/api/runs/{rid}").status_code == 404


def test_open_prints_url(live_server, monkeypatch):
    import httpx

    monkeypatch.setenv("CAIRN_SERVER", live_server)
    with httpx.Client(base_url=live_server) as c:
        rid = c.post("/api/runs", json={"project": "p"}).json()["run_id"]
    # monkeypatch webbrowser to avoid actually opening one
    monkeypatch.setattr("webbrowser.open", lambda _url: False)
    runner = CliRunner()
    result = runner.invoke(cli.main, ["open", rid, "--no-browser"])
    assert result.exit_code == 0, result.output
    assert rid in result.output


def test_export_json(live_server, monkeypatch, tmp_path):
    import httpx

    monkeypatch.setenv("CAIRN_SERVER", live_server)
    with httpx.Client(base_url=live_server) as c:
        rid = c.post("/api/runs", json={"project": "p"}).json()["run_id"]
        c.post(
            f"/api/runs/{rid}/batch",
            json={
                "points": [
                    {
                        "name": "loss",
                        "step": 0,
                        "wall_time": "2025-01-01T00:00:00Z",
                        "object_type": "scalar",
                        "scalar_value": 0.5,
                    }
                ]
            },
        )
    out = tmp_path / "run.json"
    runner = CliRunner()
    result = runner.invoke(
        cli.main, ["export", rid, "--format", "json", "--out", str(out)]
    )
    assert result.exit_code == 0, result.output
    payload = json.loads(out.read_text())
    assert payload["run"]["run"]["id"] == rid
    assert "loss" in payload["sequences"]


def test_sync_empty_spill(tmp_path, monkeypatch):
    runner = CliRunner()
    # Point spill to empty tmp.
    from cairn.sdk import transport as t_mod

    monkeypatch.setattr(t_mod, "default_spill_dir", lambda: tmp_path / "spill")
    monkeypatch.setattr(cli, "default_spill_dir", lambda: tmp_path / "spill")
    result = runner.invoke(cli.main, ["sync"])
    assert result.exit_code == 0
    assert "no spill" in result.output


def test_ping_unreachable_exits_nonzero(monkeypatch):
    monkeypatch.setenv("CAIRN_SERVER", "http://127.0.0.1:1")  # port 1 ≈ refused
    runner = CliRunner()
    result = runner.invoke(cli.main, ["ping"])
    assert result.exit_code != 0


def test_diff_against_local_snapshot(tmp_path, monkeypatch):
    import cairn

    project = tmp_path / "proj"
    project.mkdir()
    # pyproject.toml is a project-root marker, so capture anchors here.
    (project / "pyproject.toml").write_text("[project]\nname='t'\n")
    train = project / "train.py"
    train.write_text("lr = 1e-3\nepochs = 50\n")

    monkeypatch.chdir(project)
    repo = project / ".cairn"

    run = cairn.Run(
        project="diff-test",
        repo=str(repo),
        capture_stdout=False,
        capture_env=False,
        capture_system_metrics=False,
    )
    rid = run.id
    run.finish()

    # Edit a file after the snapshot was taken.
    train.write_text("lr = 1e-3\nepochs = 100\n")

    runner = CliRunner()
    result = runner.invoke(cli.main, ["diff", rid, "--repo", str(repo)])
    assert result.exit_code == 0, result.output
    assert "M  train.py" in result.output
    assert "epochs = 50" in result.output  # snapshot side
    assert "epochs = 100" in result.output  # cwd side

    # --summary skips the unified diff body.
    result_summary = runner.invoke(
        cli.main, ["diff", rid, "--repo", str(repo), "--summary"]
    )
    assert result_summary.exit_code == 0
    assert "M  train.py" in result_summary.output
    assert "epochs" not in result_summary.output

    # No changes after reverting.
    train.write_text("lr = 1e-3\nepochs = 50\n")
    result_clean = runner.invoke(cli.main, ["diff", rid, "--repo", str(repo)])
    assert result_clean.exit_code == 0
    assert "(no changes)" in result_clean.output

    # Unknown run id → exit 1.
    result_missing = runner.invoke(cli.main, ["diff", "nope", "--repo", str(repo)])
    assert result_missing.exit_code == 1
