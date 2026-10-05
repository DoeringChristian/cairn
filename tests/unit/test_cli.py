"""CLI smoke tests using CliRunner."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from click.testing import CliRunner

from cairn import config
from cairn import cli


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


def _seed_two_series_run(live_server) -> str:
    import httpx

    with httpx.Client(base_url=live_server) as c:
        rid = c.post("/api/runs", json={"project": "p"}).json()["run_id"]
        c.post(
            f"/api/runs/{rid}/batch",
            json={
                "points": [
                    {"name": "loss", "step": 0, "wall_time": "2025-01-01T00:00:00Z",
                     "object_type": "scalar", "scalar_value": 0.5},
                    {"name": "loss", "step": 1, "wall_time": "2025-01-01T00:00:01Z",
                     "object_type": "scalar", "scalar_value": 0.25},
                    {"name": "val.loss", "step": 0, "wall_time": "2025-01-01T00:00:02Z",
                     "object_type": "scalar", "scalar_value": 0.75},
                ]
            },
        )
    return rid


def test_export_csv_one_row_per_point(live_server, monkeypatch, tmp_path):
    import csv

    monkeypatch.setenv("CAIRN_SERVER", live_server)
    rid = _seed_two_series_run(live_server)
    out = tmp_path / "run.csv"
    result = CliRunner().invoke(
        cli.main, ["export", rid, "--format", "csv", "--out", str(out)]
    )
    assert result.exit_code == 0, result.output
    with open(out, newline="") as f:
        rows = list(csv.DictReader(f))
    assert list(rows[0]) == ["run_id", "name", "step", "wall_time", "value"]
    assert len(rows) == 3
    val = [r for r in rows if r["name"] == "val.loss"]
    assert len(val) == 1 and float(val[0]["value"]) == 0.75


def test_export_parquet_writes_real_parquet(live_server, monkeypatch, tmp_path):
    pd = pytest.importorskip("pandas")
    pytest.importorskip("pyarrow")

    monkeypatch.setenv("CAIRN_SERVER", live_server)
    rid = _seed_two_series_run(live_server)
    out = tmp_path / "run.parquet"
    result = CliRunner().invoke(
        cli.main, ["export", rid, "--format", "parquet", "--out", str(out)]
    )
    assert result.exit_code == 0, result.output
    assert out.read_bytes()[:4] == b"PAR1"
    df = pd.read_parquet(out)
    assert list(df.columns) == ["run_id", "name", "step", "wall_time", "value"]
    assert len(df) == 3
    assert sorted(df["value"].tolist()) == [0.25, 0.5, 0.75]
    assert set(df["run_id"]) == {rid}


def test_export_without_run_id_is_a_usage_error(tmp_path):
    result = CliRunner().invoke(
        cli.main, ["export", "--format", "csv", "--out", str(tmp_path / "x.csv")]
    )
    assert result.exit_code == 2
    assert "RUN_ID" in result.output


def test_sync_nothing_to_do(tmp_path, monkeypatch):
    runner = CliRunner()
    # Empty WAL dir + empty spill (sync scans the WAL dir).
    from cairn.sdk import transport as t_mod

    monkeypatch.setenv("CAIRN_WAL_DIR", str(tmp_path / "wal"))
    monkeypatch.setattr(t_mod, "default_spill_dir", lambda: tmp_path / "spill")
    monkeypatch.setattr(cli, "default_spill_dir", lambda: tmp_path / "spill")
    result = runner.invoke(cli.main, ["sync"])
    assert result.exit_code == 0
    assert "nothing to sync" in result.output


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


def test_sync_scans_and_replays_orphaned_wals(live_server, monkeypatch, tmp_path):
    """`cairn sync` reconstructs orphaned per-run logs from the WAL dir
    and drains them to each log's recorded target (the old command scanned a
    different directory and could not replay the WAL at all)."""
    import json as _json

    from cairn.sdk.wal import WriteAheadLog

    monkeypatch.setenv("CAIRN_WAL_DIR", str(tmp_path / "wal"))
    monkeypatch.setenv("CAIRN_SERVER", live_server)

    # A run the server knows, with an orphaned un-acked batch in the WAL.
    import httpx

    with httpx.Client(base_url=live_server, timeout=5.0) as c:
        rid = c.post("/api/runs", json={"project": "sync"}).json()["run_id"]
    wal = WriteAheadLog(rid, tmp_path / "wal", target=live_server)
    wal.append(
        "batch",
        {"run_id": rid, "points": [{
            "name": "loss", "step": 0,
            "wall_time": "2026-01-01T00:00:00+00:00",
            "object_type": "scalar", "scalar_value": 0.5,
        }]},
    )
    wal.close()

    runner = CliRunner()
    result = runner.invoke(cli.main, ["sync"])
    assert result.exit_code == 0, result.output
    assert "replayed" in result.output

    with httpx.Client(base_url=live_server, timeout=5.0) as c:
        pts = c.get(f"/api/runs/{rid}/sequences/loss").json()["points"]
    assert len(pts) == 1 and pts[0]["scalar_value"] == 0.5


def test_http_errors_are_one_line_not_tracebacks(live_server, monkeypatch):
    """A 404 from the server is `Error: <detail>`, exit 1, for every client
    command (open/rm used to dump an httpx traceback)."""
    monkeypatch.setenv("CAIRN_SERVER", live_server)
    for argv in (["open", "nope", "--no-browser"], ["rm", "nope"]):
        result = CliRunner().invoke(cli.main, argv)
        assert result.exit_code == 1, result.output
        assert "Traceback" not in result.output
        assert "run nope not found (HTTP 404)" in result.output


def test_unreachable_server_is_one_line(monkeypatch):
    monkeypatch.setenv("CAIRN_SERVER", "http://127.0.0.1:1")
    result = CliRunner().invoke(cli.main, ["list"])
    assert result.exit_code == 1
    assert result.output.startswith("Error: cannot reach http://127.0.0.1:1")


def test_unauthenticated_request_says_how_to_log_in(tmp_path, monkeypatch):
    from cairn.server.app import create_app
    from tests.conftest import _find_free_port
    import threading, time, uvicorn

    app = create_app(data_dir=tmp_path / "authrepo", mount_ui=False, auth_enabled=True)
    port = _find_free_port()
    server = uvicorn.Server(uvicorn.Config(app=app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 10
    while not server.started and time.time() < deadline:
        time.sleep(0.02)
    try:
        url = f"http://127.0.0.1:{port}"
        monkeypatch.setenv("CAIRN_SERVER", url)
        monkeypatch.delenv("CAIRN_TOKEN", raising=False)
        result = CliRunner().invoke(cli.main, ["list"])
        assert result.exit_code == 1
        assert f"Log in with `cairn login {url}`" in result.output
        monkeypatch.setenv("CAIRN_TOKEN", "wrong")
        result = CliRunner().invoke(cli.main, ["list"])
        assert result.exit_code == 1
        assert "rejected CAIRN_TOKEN" in result.output
    finally:
        server.should_exit = True
        thread.join(timeout=10)


def _seed_list_runs(live_server, monkeypatch, tmp_path) -> dict[str, str]:
    """Three runs of `p` (one archived, one failed) and one of `q`, with nested
    config, a summary rule and tags, created a minute apart."""
    import datetime as dt

    import httpx

    import cairn

    monkeypatch.setenv("CAIRN_WAL_DIR", str(tmp_path / "wal"))
    base = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)
    ids = {}
    for i, (name, project, lr, status, tags) in enumerate([
        ("a", "p", 0.1, "completed", ["best"]),
        ("b", "p", 0.01, "failed", []),
        ("c", "p", 0.2, "completed", []),
        ("d", "q", 0.3, "completed", []),
    ]):
        run = cairn.Run(
            project, name=name, tags=tags, repo=live_server, created_at=base + dt.timedelta(minutes=i),
            capture_source=False, capture_stdout=False, capture_env=False, capture_system_metrics=False,
        )
        run.config({"optim": {"lr": lr, "betas": [0.9, 0.99]}})
        for step, v in enumerate([0.5, 0.9 - i * 0.1, 0.4]):
            run.track(v, "val/acc", step, summary="max")
        run.finish(status)
        ids[name] = run.id
    with httpx.Client(base_url=live_server) as c:
        c.post(f"/api/runs/{ids['c']}/archive").raise_for_status()
    return ids


def _table(output: str) -> list[list[str]]:
    return [line.split() for line in output.strip().splitlines()]


def test_list_columns_order_archived_and_formats(live_server, monkeypatch, tmp_path):
    """`cairn list`: full-width ids, newest first, archived runs hidden unless
    asked for, nested-config and final-metric columns, json/csv output."""
    monkeypatch.setenv("CAIRN_SERVER", live_server)
    ids = _seed_list_runs(live_server, monkeypatch, tmp_path)
    run = lambda *argv: CliRunner().invoke(cli.main, ["list", *argv])  # noqa: E731

    result = run()
    assert result.exit_code == 0, result.output
    rows = _table(result.output)
    assert rows[0][:4] == ["ID", "NAME", "PROJECT", "STATUS"]
    # Newest first, archived `c` left out, every id printed whole.
    assert [r[0] for r in rows[1:]] == [ids["d"], ids["b"], ids["a"]]

    rows = _table(run("--archived", "only").output)
    assert [r[0] for r in rows[1:]] == [ids["c"]]
    result = run("--archived", "all", "--project", "p")
    rows = _table(result.output)
    assert "ARCHIVED" in rows[0] and "PROJECT" not in rows[0]
    assert {r[0] for r in rows[1:]} == {ids["a"], ids["b"], ids["c"]}

    # Final value = the max rule; sorted by it, best first.
    result = run("--project", "p", "-c", "config.optim.lr", "-c", "metrics.val/acc",
                 "--sort", "metrics.val/acc")
    rows = _table(result.output)
    assert rows[0][-2:] == ["config.optim.lr", "metrics.val/acc"]
    assert [(r[1], r[-2], r[-1]) for r in rows[1:]] == [("a", "0.1", "0.9"), ("b", "0.01", "0.8")]

    result = run("--filter", "optim__lr__lt=0.05", "--format", "json", "-c", "config.optim")
    data = json.loads(result.output)
    assert [r["id"] for r in data] == [ids["b"]]
    assert data[0]["config.optim"] == {"lr": 0.01, "betas": [0.9, 0.99]}
    assert data[0]["status"] == "failed" and data[0]["created_at"].startswith("2026-01-01T00:01")

    result = run("--format", "csv", "--asc", "--status", "completed")
    lines = result.output.strip().splitlines()
    assert lines[0] == "id,name,project,status,created_at,duration,tags"
    assert [line.split(",")[1] for line in lines[1:]] == ["a", "d"]

    result = run("--where", "config.optim.lr > 0.2")
    assert [r[0] for r in _table(result.output)[1:]] == [ids["d"]]


def test_list_rejects_unknown_columns_and_sort_keys(live_server, monkeypatch):
    monkeypatch.setenv("CAIRN_SERVER", live_server)
    for argv in (["-c", "bogus"], ["--sort", "bogus"], ["--where", "last(("]):
        result = CliRunner().invoke(cli.main, ["list", *argv])
        assert result.exit_code == 2, result.output


def test_export_fetches_sequences_in_series_batches(live_server, monkeypatch, tmp_path):
    """A run's sequences come from batched /series requests (one request per
    200 names, not one per sequence), with the same point fields as before."""
    import httpx

    from cairn.sdk.transport import Transport

    monkeypatch.setenv("CAIRN_SERVER", live_server)
    with httpx.Client(base_url=live_server) as c:
        rid = c.post("/api/runs", json={"project": "p"}).json()["run_id"]
        c.post(f"/api/runs/{rid}/batch", json={"points": [
            {"name": f"m{i:03d}", "step": s, "wall_time": "2025-01-01T00:00:00Z",
             "object_type": "scalar", "scalar_value": float(i + s)}
            for i in range(201) for s in range(2)
        ]}).raise_for_status()
    paths: list[str] = []
    real_get = Transport.get
    monkeypatch.setattr(Transport, "get", lambda self, path, params=None: paths.append(path) or real_get(self, path, params))
    out = tmp_path / "run.json"
    result = CliRunner().invoke(cli.main, ["export", rid, "--out", str(out)])
    assert result.exit_code == 0, result.output
    assert sum(p.endswith("/series") for p in paths) == 2
    assert not any("/sequences/" in p for p in paths)
    seqs = json.loads(out.read_text())["sequences"]
    assert len(seqs) == 201
    assert [(p["step"], p["scalar_value"], p["object_type"]) for p in seqs["m200"]] == [
        (0, 200.0, "scalar"), (1, 201.0, "scalar"),
    ]


def test_empty_exports_warn(live_server, monkeypatch, tmp_path):
    import httpx

    monkeypatch.setenv("CAIRN_SERVER", live_server)
    with httpx.Client(base_url=live_server) as c:
        rid = c.post("/api/runs", json={"project": "p"}).json()["run_id"]
    result = CliRunner().invoke(cli.main, ["export", rid, "--format", "csv", "--out", str(tmp_path / "a.csv")])
    assert result.exit_code == 0
    assert f"warning: run {rid} has no scalar points" in result.output
    pytest.importorskip("pandas")
    result = CliRunner().invoke(cli.main, ["export", "--project", "nope", "--format", "csv", "--out", str(tmp_path / "b.csv")])
    assert result.exit_code == 0, result.output
    assert "no run of project 'nope' matches" in result.output


def test_sync_against_a_down_server_fails_and_keeps_the_log(monkeypatch, tmp_path):
    """A WAL whose server is unreachable used to print `replayed 0 op(s)`
    and `nothing to sync` with exit 0 although every op was still pending."""
    from cairn.sdk.wal import WriteAheadLog

    monkeypatch.setenv("CAIRN_WAL_DIR", str(tmp_path / "wal"))
    monkeypatch.setattr(cli, "default_spill_dir", lambda: tmp_path / "spill")
    wal = WriteAheadLog("r1", tmp_path / "wal", target="http://127.0.0.1:1")
    wal.append("params", {"run_id": "r1", "params": {"a": 1}})
    wal.close()
    result = CliRunner().invoke(cli.main, ["sync"])
    assert result.exit_code == 1, result.output
    assert "r1: FAILED after 0 op(s)" in result.output
    assert "sync incomplete" in result.output
    assert (tmp_path / "wal" / "r1.wal.jsonl").exists()


def test_login_to_an_auth_off_server_saves_nothing(live_server):
    """It used to report `Logged in ... as None (role=admin)` and save the
    pasted token for a server that ignores tokens."""
    result = CliRunner().invoke(cli.main, ["login", live_server, "--token", "whatever"])
    assert result.exit_code == 0, result.output
    assert "runs without auth" in result.output
    assert config.saved_tokens() == {}


def test_network_urls_only_for_reachable_binds(monkeypatch):
    monkeypatch.setattr(cli, "_lan_ip", lambda: "10.0.0.5")
    assert cli._network_host("0.0.0.0") == "10.0.0.5"
    assert cli._network_host("127.0.0.1") is None
    assert cli._network_host("localhost") is None
    assert cli._network_host("192.168.1.7") == "192.168.1.7"


def test_open_points_at_the_paired_ui_port(app, monkeypatch):
    """Against the ingest port of `cairn server --ui`, `cairn open` used to
    print an ingest-port URL (a JSON blob); it now uses the UI port."""
    import threading, time

    import httpx
    import uvicorn

    from tests.conftest import _find_free_port

    port = _find_free_port()
    app.state.ui_port = 4999
    server = uvicorn.Server(uvicorn.Config(app=app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 10
    while not server.started and time.time() < deadline:
        time.sleep(0.02)
    try:
        url = f"http://127.0.0.1:{port}"
        rid = httpx.post(f"{url}/api/runs", json={"project": "p"}).json()["run_id"]
        monkeypatch.setenv("CAIRN_SERVER", url)
        result = CliRunner().invoke(cli.main, ["open", rid, "--no-browser"])
        assert result.exit_code == 0, result.output
        assert f"http://127.0.0.1:4999/p/p/r/{rid}" in result.output
        assert "not serving the viewer" not in result.output
        del app.state.ui_port
        result = CliRunner().invoke(cli.main, ["open", rid, "--no-browser"])
        assert f"{url}/p/p/r/{rid}" in result.output
        assert "not serving the viewer" in result.output
    finally:
        server.should_exit = True
        thread.join(timeout=10)


def test_token_commands_need_an_existing_repo(tmp_path):
    """`cairn token list` in a directory without a repo used to create one."""
    missing = tmp_path / "nowhere" / ".cairn"
    for argv in (["list"], ["create", "--name", "x"], ["revoke", "x"]):
        result = CliRunner().invoke(cli.main, ["token", *argv, "--repo", str(missing)])
        assert result.exit_code == 1, result.output
        assert "no Cairn repo at" in result.output
    assert not missing.exists()


def test_token_list_shows_expiry_and_revoked(tmp_path):
    repo = tmp_path / ".cairn"
    assert CliRunner().invoke(cli.main, ["init", str(tmp_path)]).exit_code == 0
    runner = CliRunner()
    assert runner.invoke(cli.main, ["token", "create", "--name", "ci", "--expires", "2099-01-01T00:00:00", "--repo", str(repo)]).exit_code == 0
    assert runner.invoke(cli.main, ["token", "create", "--name", "dev", "--repo", str(repo)]).exit_code == 0
    assert runner.invoke(cli.main, ["token", "revoke", "dev", "--repo", str(repo)]).exit_code == 0
    out = runner.invoke(cli.main, ["token", "list", "--repo", str(repo)]).output
    lines = {line.split()[0]: line for line in out.splitlines()[1:]}
    assert "active" in lines["ci"] and "2099-01-01" in lines["ci"]
    assert "revoked" in lines["dev"] and lines["dev"].endswith("never")


def test_unconfigured_default_server_error_says_so(monkeypatch):
    monkeypatch.delenv("CAIRN_SERVER", raising=False)
    monkeypatch.delenv("CAIRN_REPO", raising=False)
    monkeypatch.setattr(config, "DEFAULT_SERVER", "http://127.0.0.1:1")
    result = CliRunner().invoke(cli.main, ["ping"])
    assert result.exit_code == 1
    assert "No server is configured" in result.output
