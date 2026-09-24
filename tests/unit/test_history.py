"""Bulk history (RunQuery.history / Run.history), paged run listing, and
`cairn export --project`."""

from __future__ import annotations

import csv
import json

import pytest
from click.testing import CliRunner

import cairn
from cairn import cli, config
from cairn.sdk import reader as reader_mod

pd = pytest.importorskip("pandas")

_RUN_KW = dict(
    capture_source=False,
    capture_stdout=False,
    capture_env=False,
    capture_system_metrics=False,
)


@pytest.fixture(autouse=True)
def _isolate(monkeypatch, tmp_path):
    from cairn.sdk.capture import stdout as scap

    monkeypatch.setattr(config, "config_file_path", lambda: tmp_path / "config.toml")
    config.reset_configured()
    scap._active_run_id = None
    yield
    scap._active_run_id = None
    config.reset_configured()


def _seed(repo, n=3) -> dict[str, str]:
    """n runs in project "p": loss at steps 0..2 (train) + val loss at 0, lr config."""
    ids = {}
    for i in range(n):
        with cairn.Run(project="p", name=f"r{i}", repo=repo, **_RUN_KW) as run:
            run.config(lr=0.1 * (i + 1))
            for step in range(3):
                run.track(float(i * 10 + step), name="loss", step=step)
            run.track(float(i), name="loss", step=0, context={"subset": "val"})
            run.track(1.0, name="acc", step=2)
            if i == 0:
                run.track(cairn.Text("note"), name="txt", step=0)  # non-scalar: skipped
            ids[f"r{i}"] = run.id
    return ids


def _server_repo(live_server) -> str:
    return "cairn://" + live_server.removeprefix("http://")


@pytest.fixture(params=["local", "http"])
def repo(request, tmp_path):
    if request.param == "local":
        return str(tmp_path / ".cairn")
    return _server_repo(request.getfixturevalue("live_server"))


def test_runquery_history_long_format(repo):
    ids = _seed(repo)
    with cairn.Reader(repo) as reader:
        df = reader.runs("p").history()
    assert list(df.columns) == ["run_id", "run_name", "name", "context", "step", "wall_time", "value"]
    assert len(df) == 3 * (3 + 1 + 1)
    assert str(df["wall_time"].dtype).startswith("datetime64")
    r1 = df[(df.run_id == ids["r1"]) & (df.name == "loss")]
    assert set(r1.run_name) == {"r1"}
    train = r1[r1.context.isna()].sort_values("step")
    assert train.value.tolist() == [10.0, 11.0, 12.0]
    val = r1[r1.context.notna()]
    assert val.context.tolist() == [{"subset": "val"}] and val.value.tolist() == [1.0]

    with cairn.Reader(repo) as reader:
        only = reader.runs("p").filter(lr__gt=0.25).history(keys=["loss"], context={"subset": "val"})
    assert sorted(only.run_name) == ["r2"] and only.value.tolist() == [2.0]


def test_run_history_wide(repo):
    ids = _seed(repo, n=1)
    with cairn.Reader(repo) as reader:
        run = reader.run(ids["r0"])
        with pytest.raises(ValueError, match="several contexts"):
            run.history()
        wide = run.history(keys=["loss", "acc"], context={"subset": "val"})
        assert list(wide.columns) == ["loss"] and wide.loc[0, "loss"] == 0.0
        wide = run.history(["acc"])
    assert wide.index.tolist() == [2] and wide["acc"].tolist() == [1.0]


def test_list_pages_through_all_runs_before_filtering(tmp_path, monkeypatch):
    repo = str(tmp_path / ".cairn")
    ids = _seed(repo, n=5)
    monkeypatch.setattr(reader_mod, "_PAGE", 2)
    with cairn.Reader(repo) as reader:
        assert len(reader.runs("p").list()) == 5
        # The filter matches the OLDEST run, which the newest-first first page misses.
        assert [r.id for r in reader.runs("p").filter(lr__lt=0.15).list()] == [ids["r0"]]
        assert len(reader.runs("p").limit(3).list()) == 3


def test_compare_all_names_with_wall_time(client):
    rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
    client.post(f"/api/runs/{rid}/batch", json={"points": [
        {"name": "a", "step": 0, "wall_time": "2025-01-01T00:00:00Z", "object_type": "scalar", "scalar_value": 1.0},
        {"name": "b", "step": 0, "wall_time": "2025-01-01T00:00:01Z", "object_type": "scalar",
         "scalar_value": 2.0, "context": {"subset": "val"}},
    ]})
    series = client.post("/api/compare", json={"run_ids": [rid]}).json()["series"]
    by_name = {s["name"]: s["points"] for s in series}
    assert set(by_name) == {"a", "b"}
    assert by_name["b"][0]["wall_time"] == "2025-01-01T00:00:01Z"
    assert json.loads(by_name["b"][0]["context"]) == {"subset": "val"}
    assert client.post("/api/compare", json={"run_ids": [rid], "metrics": []}).json() == {"series": []}


def test_export_project_csv_with_filter(live_server, monkeypatch, tmp_path):
    monkeypatch.setenv("CAIRN_SERVER", live_server)
    _seed(_server_repo(live_server))
    out = tmp_path / "p.csv"
    result = CliRunner().invoke(cli.main, [
        "export", "--project", "p", "--filter", "lr__gt=0.15", "--filter", "status=completed",
        "--format", "csv", "--out", str(out),
    ])
    assert result.exit_code == 0, result.output
    with open(out, newline="") as f:
        rows = list(csv.DictReader(f))
    assert list(rows[0]) == ["run_id", "run_name", "name", "context", "step", "wall_time", "value"]
    assert {r["run_name"] for r in rows} == {"r1", "r2"}
    assert len(rows) == 2 * 5
    assert {json.loads(r["context"])["subset"] for r in rows if r["context"]} == {"val"}


def test_export_project_json_and_parquet(live_server, monkeypatch, tmp_path):
    pytest.importorskip("pyarrow")
    monkeypatch.setenv("CAIRN_SERVER", live_server)
    _seed(_server_repo(live_server), n=2)
    runner = CliRunner()
    assert runner.invoke(cli.main, ["export", "--project", "p", "--format", "json", "--out", str(tmp_path / "p.json")]).exit_code == 0
    records = json.loads((tmp_path / "p.json").read_text())
    assert len(records) == 10 and {"run_name", "wall_time"} <= set(records[0])
    assert runner.invoke(cli.main, ["export", "--project", "p", "--format", "parquet", "--out", str(tmp_path / "p.parquet")]).exit_code == 0
    assert len(pd.read_parquet(tmp_path / "p.parquet")) == 10


def test_export_needs_exactly_one_of_run_id_or_project(tmp_path):
    runner = CliRunner()
    both = runner.invoke(cli.main, ["export", "abc", "--project", "p", "--out", str(tmp_path / "x")])
    assert both.exit_code == 2
    stray = runner.invoke(cli.main, ["export", "abc", "--filter", "a=1", "--out", str(tmp_path / "x")])
    assert stray.exit_code == 2
