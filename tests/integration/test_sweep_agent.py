"""`cairn sweep create` + `cairn agent` end to end: a toy training script
that logs a metric, run per trial as a real subprocess, against a direct
repo and against a live server."""

from __future__ import annotations

import os
import subprocess
import sys
import textwrap
import time

import pytest

import cairn

TOY = textwrap.dedent("""
    import argparse
    import sys

    import cairn

    p = argparse.ArgumentParser()
    p.add_argument("--lr", type=float, required=True)
    p.add_argument("--layers", type=int, required=True)
    p.add_argument("--tag", required=True)
    a = p.parse_args()
    with cairn.Run(project="toy", capture_source=False, capture_stdout=False,
                   capture_env=False, capture_system_metrics=False) as run:
        for step in range(3):
            run.track(a.lr * a.layers * (3 - step), name="loss", step=step)
    sys.exit(1 if a.layers == 3 else 0)
""")


def _cli(*args: str, env: dict | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "cairn", *args], capture_output=True, text=True,
        env={**os.environ, **(env or {})}, timeout=120,
    )


@pytest.fixture(params=["direct", "server"])
def repo(request, tmp_path):
    if request.param == "server":
        return request.getfixturevalue("live_server").replace("http://", "cairn://")
    return str(tmp_path / ".cairn")


def test_agent_runs_the_command_per_trial(repo, tmp_path):
    script = tmp_path / "toy.py"
    script.write_text(TOY)
    (tmp_path / "sweep.yaml").write_text(textwrap.dedent(f"""
        project: toy
        name: toy grid
        method: grid
        metric: {{name: loss, goal: minimize}}
        program: {script}
        parameters:
          lr: {{values: [0.1, 0.2]}}
          layers: {{values: [1, 3]}}
          tag: hello world
    """))
    created = _cli("sweep", "create", str(tmp_path / "sweep.yaml"), "--repo", repo)
    assert created.returncode == 0, created.stderr
    sweep_id = created.stdout.split()[2]

    # The subprocess resolves the repo from CAIRN_REPO, which only the agent sets.
    env = {"CAIRN_REPO": "", "CAIRN_SERVER": ""}
    first = _cli("agent", sweep_id, "--repo", repo, "--count", "3", env=env)
    assert first.returncode == 0, first.stderr + first.stdout
    assert first.stdout.count("completed") == 2 and first.stdout.count("failed") == 1
    rest = _cli("agent", sweep_id, "--repo", repo, env=env)
    assert rest.returncode == 0, rest.stderr
    assert "is finished; stopping" in rest.stdout

    listed = _cli("sweep", "ls", "--repo", repo)
    assert sweep_id in listed.stdout and "finished" in listed.stdout

    info = cairn.Sweep(sweep_id, repo=repo).info()
    trials = info["trials"]
    assert [(t["params"]["lr"], t["params"]["layers"]) for t in trials] == [
        (0.1, 1), (0.1, 3), (0.2, 1), (0.2, 3),
    ]
    assert [t["status"] for t in trials] == ["completed", "failed", "completed", "failed"]
    # The value is the run's last "loss" point: lr * layers * 1.
    for t in trials:
        assert t["run_id"] and t["value"] == pytest.approx(t["params"]["lr"] * t["params"]["layers"])
    assert info["best"]["params"] == {"lr": 0.1, "layers": 1, "tag": "hello world"}

    reader = cairn.Reader(repo=repo)
    try:
        runs = reader.runs("toy").list()
        assert {r.id for r in runs} == {t["run_id"] for t in trials}
        for r in runs:
            assert r._raw["sweep_id"] == sweep_id
            assert r.config["tag"] == "hello world"
        # Unnamed runs take their trial's name: <sweep name>-<n>.
        names = {r.id: r.name for r in runs}
        assert [names[t["run_id"]] for t in trials] == [f"toy grid-{i}" for i in (1, 2, 3, 4)]
    finally:
        reader.close()


def test_agent_refuses_a_sweep_without_command(tmp_path):
    repo = str(tmp_path / ".cairn")
    sw = cairn.sweep({"a": 1}, project="toy", repo=repo)
    out = _cli("agent", sw.id, "--repo", repo)
    assert out.returncode != 0 and "has no command" in out.stderr


def test_create_checks_the_file(tmp_path):
    repo = str(tmp_path / ".cairn")
    cases = {
        "project: p\nprogram: t.py\nparameters: {a: 1}\nearly_terminate: {type: hyperband}\n":
            "'early_terminate' is not supported yet",
        "project: p\nprogram: t.py\nparameters: {a: 1}\nentity: me\n": "unknown sweep key 'entity'",
        "project: p\nparameters: {a: 1}\n": "set `program:`",
        "program: t.py\nparameters: {a: 1}\n": "no project",
    }
    for text, error in cases.items():
        (tmp_path / "sweep.yaml").write_text(text)
        out = _cli("sweep", "create", str(tmp_path / "sweep.yaml"), "--repo", repo)
        assert out.returncode != 0 and error in out.stderr, (text, out.stderr)


# Loops until its run is asked to stop, then exits cleanly.
LOOPER = textwrap.dedent("""
    import time

    import cairn

    cairn.Run._HEARTBEAT_INTERVAL = 0.1
    with cairn.Run(project="toy", stop_mode="flag", capture_source=False, capture_stdout=False,
                   capture_env=False, capture_system_metrics=False) as run:
        while not run.should_stop:
            time.sleep(0.05)
""")


def test_cancel_ends_the_running_trial(repo, tmp_path):
    script = tmp_path / "looper.py"
    script.write_text(LOOPER)
    (tmp_path / "sweep.yaml").write_text(textwrap.dedent(f"""
        project: toy
        program: {script}
        parameters:
          x: {{min: 0.0, max: 1.0}}
    """))
    created = _cli("sweep", "create", str(tmp_path / "sweep.yaml"), "--repo", repo)
    assert created.returncode == 0, created.stderr
    sweep_id = created.stdout.split()[2]
    sw = cairn.Sweep(sweep_id, repo=repo)

    agent = subprocess.Popen(
        [sys.executable, "-m", "cairn", "agent", sweep_id, "--repo", repo],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        env={**os.environ, "CAIRN_REPO": "", "CAIRN_SERVER": ""},
    )
    try:
        deadline = time.monotonic() + 60
        while not any(t["run_id"] for t in sw.trials):
            assert time.monotonic() < deadline and agent.poll() is None
            time.sleep(0.1)
        cancelled = _cli("sweep", "cancel", sweep_id, "--repo", repo)
        assert cancelled.returncode == 0 and "cancelled" in cancelled.stdout, cancelled.stderr
        out, err = agent.communicate(timeout=60)
    finally:
        agent.kill()
    assert agent.returncode == 0, err
    assert "killed" in out and f"sweep {sweep_id} is cancelled; stopping" in out

    (trial,) = sw.trials
    assert trial["status"] == "killed"
    reader = cairn.Reader(repo=repo)
    try:
        assert reader.run(trial["run_id"]).status == "stopped"
    finally:
        reader.close()
