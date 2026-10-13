"""Fault test (0.6 spec §2, §3, §10): a training process killed with SIGKILL
mid-run loses nothing it group-committed, and the uploader daemon it started
keeps uploading after it died, exactly once.

The trainer (a subprocess) logs one point per step and notes when it logged
each one. The test kills it at a random moment, waits for the daemon to
settle, and checks:

* the run's log on disk is a gap-free prefix of what the trainer logged,
  and holds every step logged more than one group-commit interval (plus
  slack for a loaded machine) before the kill;
* the server holds exactly the points of that log, each once: against a
  fake server that counts every apply (and fails some requests), and
  against the app applying the records into its database.
"""

from __future__ import annotations

import os
import random
import signal
import subprocess
import sys
import textwrap
import time
from pathlib import Path

import pytest

from cairn.sdk.runlog.log import scan
from cairn.sdk.runlog.rundir import RunDir
from cairn.uploader import daemon as agent
from tests.unit.fake_ingest import FakeIngest, flaky

#: Group commit interval the trainer runs with, and the slack on top of it a
#: busy test machine gets before a point counts as "committed before the kill".
INTERVAL_MS = 100
SLACK_S = 0.5

TRAINER = textwrap.dedent("""
    import sys, time, cairn
    run = cairn.Run("faults", server=sys.argv[1], capture_system_metrics=False,
                    capture_source=False, capture_stdout=False, capture_env=False)
    out = open(sys.argv[2], "w", buffering=1)
    out.write(f"RUN {run.id}\\n")
    step = 0
    while True:
        run.track(float(step), "loss", step=step)
        out.write(f"{step} {time.time()}\\n")
        step += 1
        if step % 50 == 0:
            time.sleep(0.002)
""")


def _env(tmp_path: Path) -> dict[str, str]:
    return {
        **os.environ,
        "BROWSER": "true",
        "CAIRN_DIR": str(tmp_path / "cd"),
        "CAIRN_AGENT_DIR": str(tmp_path / "agent"),
        "CAIRN_UPLOADER": "on",
        "CAIRN_AGENT_IDLE_EXIT": "2",
        "CAIRN_SYNC_INTERVAL_MS": str(INTERVAL_MS),
    }


def _kill_trainer(tmp_path: Path, url: str, seed: int) -> tuple[str, dict[int, float], float]:
    """Start the trainer, SIGKILL it at a random moment; returns (run id,
    {step: time logged}, time of the kill)."""
    progress = tmp_path / "progress.txt"
    p = subprocess.Popen([sys.executable, "-c", TRAINER, url, str(progress)], env=_env(tmp_path))
    try:
        deadline = time.monotonic() + 30
        while not (progress.exists() and progress.read_text().count("\n") > 200):
            assert p.poll() is None, "the trainer died"
            assert time.monotonic() < deadline, "the trainer did not start"
            time.sleep(0.02)
        time.sleep(random.Random(seed).uniform(1.0, 3.0))
        t_kill = time.time()
        p.send_signal(signal.SIGKILL)
    finally:
        p.kill()
        p.wait()
    lines = progress.read_text().splitlines()
    run_id = lines[0].split()[1]
    logged = {}
    for line in lines[1:]:
        parts = line.split()
        if len(parts) == 2:  # the last line may be cut off
            logged[int(parts[0])] = float(parts[1])
    return run_id, logged, t_kill


def _wait_uploaded(tmp_path: Path, timeout: float = 120.0) -> None:
    """The daemon drops a directory from its registry once the server
    confirmed all of it and no writer is left; then it exits when idle."""
    base = tmp_path / "agent"
    deadline = time.monotonic() + timeout
    while agent.registered(base):
        assert time.monotonic() < deadline, f"not uploaded: {agent.read_status(tmp_path / 'cd')}"
        time.sleep(0.1)
    while agent.is_running(base) and time.monotonic() < deadline:
        time.sleep(0.1)


def _committed_steps(tmp_path: Path, run_id: str, logged: dict[int, float], t_kill: float) -> list[int]:
    """The steps of the run's log on disk, checked against what the trainer
    logged and when."""
    recs = scan(tmp_path / "cd" / "runs" / run_id / "log").records
    steps = [pt["step"] for r in recs if r["op"] == "batch" for pt in r["points"]]
    assert steps == list(range(len(steps))), "the log is not a gap-free, duplicate-free prefix"
    assert len(steps) <= len(logged) + 1  # the last step may be logged, not yet noted
    must = [s for s, t in logged.items() if t < t_kill - INTERVAL_MS / 1000 - SLACK_S]
    assert must, "killed too early to check anything"
    assert max(must) < len(steps), (
        f"step {max(must)} was logged {t_kill - logged[max(must)]:.2f} s before the kill "
        f"but is not in the log (it ends at step {len(steps) - 1})")
    assert not any(r["op"] == "finish" for r in recs)  # SIGKILL: no finish
    return steps


@pytest.mark.slow
@pytest.mark.timeout(240)
@pytest.mark.parametrize("seed", [1, 2, 3])
def test_kill_9_trainer_fake_server(tmp_path, seed) -> None:
    fake = FakeIngest(fault=flaky(0.1, seed=seed, kinds=("500", "429", "drop", "drop_after")))
    served = fake.serve()
    try:
        run_id, logged, t_kill = _kill_trainer(tmp_path, served.url, seed)
        _wait_uploaded(tmp_path)
        steps = _committed_steps(tmp_path, run_id, logged, t_kill)
        rd = RunDir.for_run(run_id, tmp_path / "cd")
        last = rd.log().last_seq()
        fake.assert_exactly_once(run_id, "main", last)  # every record applied once
        assert rd.log().acked() == last
        on_server = [pt["step"] for r in fake.records[(run_id, "main")] if r["op"] == "batch"
                     for pt in r["points"]]
        assert on_server == steps
    finally:
        served.close()


@pytest.mark.slow
@pytest.mark.timeout(240)
def test_kill_9_trainer_into_the_database(tmp_path, app, live_server) -> None:
    run_id, logged, t_kill = _kill_trainer(tmp_path, live_server, seed=7)
    _wait_uploaded(tmp_path)
    steps = _committed_steps(tmp_path, run_id, logged, t_kill)
    rows = app.state.db.read_columns(
        "SELECT step FROM sequences WHERE run_id = ? AND name = 'loss' ORDER BY step", [run_id])
    assert [r["step"] for r in rows] == steps
    status = app.state.db.read_one("SELECT status FROM runs WHERE id = ?", [run_id])[0]
    assert status == "running"  # no finish record: the server's crash detection decides
