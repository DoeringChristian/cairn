"""The uploader against a fake server implementing the ingestion protocol:
exactly once under server errors, 409 gaps, 429 Retry-After, dropped
connections, kill -9 of the daemon, and one daemon at a time."""

from __future__ import annotations

#: Test the client alone, without the server stand-in (tests/standin_server.py).
STANDIN = False

import json
import os
import random
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest

from cairn.sdk.runlog.rundir import RunDir
from cairn.sdk.runlog.writer import RunWriter
from cairn.uploader import daemon as agent
from cairn.uploader.client import IngestClient, UploadError
from cairn.uploader.sync import DirSync, LogSync, sync_paths

from .fake_ingest import FakeIngest, flaky


def make_run(base: Path, run_id: str = "r1", *, n: int = 50, server: str = "http://fake",
             label: str | None = None, finish: bool = True, blobs: int = 3) -> RunDir:
    rd = RunDir.for_run(run_id, base)
    if not rd.exists():
        rd.write_meta({"run_id": run_id, "project": "p", "project_id": "p", "endpoint": server})
    w = RunWriter(rd, run_id, label)
    if label is None:
        w.create_run({"run_id": run_id, "project": "p", "project_id": "p"})
    else:
        w.join(label)
    for i in range(n):
        w.add_point({"name": "loss", "step": i, "scalar_value": float(i)})
        if i % 10 == 0:
            w.post_params(run_id, {"i": i})
    for i in range(blobs):
        w.upload_artifact(f"blob {run_id} {label} {i}".encode() * 100, "text/plain")
    if finish:
        if label is None:
            w.finish("completed", 0)
        else:
            w.detach(label)
    w.close()
    return rd


def client_for(fake: FakeIngest) -> IngestClient:
    return IngestClient("http://fake", client=fake.client())


def drive(ds: DirSync, client: IngestClient, *, rounds: int = 10_000) -> int:
    """Step until everything is confirmed, swallowing upload errors."""
    errors = 0
    for _ in range(rounds):
        try:
            ds.step(client)
        except UploadError:
            errors += 1
            continue
        if all(ls.done() for ls in ds.refresh()):
            return errors
    raise AssertionError("did not converge")


def test_uploads_every_record_once_with_blobs_first(tmp_path) -> None:
    rd = make_run(tmp_path)
    fake = FakeIngest()
    ds = DirSync(rd)
    drive(ds, client_for(fake))
    last = rd.log().last_seq()
    fake.assert_exactly_once("r1", "main", last)
    assert rd.log().acked() == last
    assert len(fake.blobs) == 3
    # The payloads arrive flattened: {seq, op, t, ...fields}.
    rec = fake.records[("r1", "main")][0]
    assert rec["op"] == "create_run" and rec["project"] == "p" and "payload" not in rec


def test_labelled_process_logs_are_their_own(tmp_path) -> None:
    make_run(tmp_path)
    rd = make_run(tmp_path, label="rank1", n=20)
    fake = FakeIngest()
    drive(DirSync(rd), client_for(fake))
    fake.assert_exactly_once("r1", "main", rd.log().last_seq())
    fake.assert_exactly_once("r1", "rank1", rd.log("rank1").last_seq())
    assert fake.records[("r1", "rank1")][0]["op"] == "join"


@pytest.mark.parametrize("seed", range(5))
def test_exactly_once_under_faults(tmp_path, seed) -> None:
    rd = make_run(tmp_path, n=400)
    fake = FakeIngest(fault=flaky(0.4, seed=seed))
    ds = DirSync(rd)
    errors = drive(ds, client_for(fake))
    assert errors > 0
    fake.assert_exactly_once("r1", "main", rd.log().last_seq())


def test_small_batches_under_faults(tmp_path) -> None:
    rd = make_run(tmp_path, n=3000)
    fake = FakeIngest(fault=flaky(0.3, seed=7))
    ls = LogSync(rd.log())
    client = client_for(fake)
    while not ls.done():
        try:
            ls.step(client, "r1", max_bytes=2000)
        except UploadError:
            pass
    fake.assert_exactly_once("r1", "main", rd.log().last_seq())


def test_409_gap_resends_what_the_server_lost(tmp_path) -> None:
    rd = make_run(tmp_path, finish=False)
    fake = FakeIngest()
    client = client_for(fake)
    ds = DirSync(rd)
    drive(ds, client)
    # The server restores a backup from before the last 5 records.
    key = ("r1", "main")
    keep = fake.applied[key] - 5
    fake.applied[key] = keep
    fake.records[key] = fake.records[key][:keep]
    for k in [k for k in fake.apply_counts if k[2] > keep]:
        del fake.apply_counts[k]
    w = RunWriter(rd, "r1")
    w.post_params("r1", {"late": True})
    w.finish("completed", 0)
    w.close()
    drive(ds, client)  # POST from the cached seq -> 409 -> continue from the server's
    fake.assert_exactly_once("r1", "main", rd.log().last_seq())
    assert rd.log().acked() == rd.log().last_seq()


def test_a_fresh_session_trusts_the_servers_applied_seq(tmp_path) -> None:
    rd = make_run(tmp_path)
    rd.log().set_acked(10_000)  # a stale/bogus acked file
    fake = FakeIngest()
    drive(DirSync(rd), client_for(fake))
    fake.assert_exactly_once("r1", "main", rd.log().last_seq())


def test_log_starting_after_the_server_is_refused(tmp_path) -> None:
    rd = RunDir.for_run("r9", tmp_path)
    rd.write_meta({"run_id": "r9", "endpoint": "http://fake"})
    w = RunWriter(rd, "r9", base_seq=100)
    w.resume_run()
    w.close()
    with pytest.raises(UploadError, match="starts at 101") as info:
        LogSync(rd.log()).step(client_for(FakeIngest()), "r9")
    assert info.value.rejected


def test_429_retry_after_is_honoured(tmp_path) -> None:
    rd = make_run(tmp_path, n=5)
    calls = {"n": 0}

    def fault(method: str, path: str):
        calls["n"] += 1
        return ("status", 429, {"Retry-After": "7"}) if calls["n"] == 1 else None

    fake = FakeIngest(fault=fault)
    with pytest.raises(UploadError) as info:
        DirSync(rd).step(client_for(fake))
    assert info.value.retry_after == 7.0 and not info.value.rejected
    ep = agent._Endpoint("http://fake", None)
    ep.failed(info.value)
    assert 6.5 < ep.not_before - time.monotonic() <= 7.0


def test_backoff_grows_to_a_cap() -> None:
    ep = agent._Endpoint("http://fake", None)
    waits = []
    for _ in range(10):
        ep.failed(UploadError("down"))
        waits.append(ep.backoff)
    assert waits[:3] == [1.0, 2.0, 4.0] and waits[-1] == agent.BACKOFF_MAX
    ep.ok()
    assert ep.backoff == 0.0
    ep.failed(UploadError("bad request", rejected=True))
    assert ep.backoff == agent.BACKOFF_MAX


def test_sync_paths_reports_failures(tmp_path) -> None:
    rd = make_run(tmp_path)
    fake = FakeIngest(fault=lambda m, p: ("status", 500, {}))
    out = sync_paths([rd], client_for=lambda _rd: client_for(fake))
    assert "500" in out[rd.path]
    fake.fault = None
    out = sync_paths([rd], client_for=lambda _rd: client_for(fake))
    assert out[rd.path] is None
    fake.assert_exactly_once("r1", "main", rd.log().last_seq())


def test_missing_blob_does_not_block_the_log(tmp_path) -> None:
    rd = make_run(tmp_path, blobs=1)
    for p in rd.blobs_dir.iterdir():
        p.unlink()
    fake = FakeIngest()
    drive(DirSync(rd), client_for(fake))
    assert fake.applied[("r1", "main")] == rd.log().last_seq()


# ---- the daemon --------------------------------------------------------------------


def test_daemon_round_uploads_and_unregisters(tmp_path) -> None:
    served = FakeIngest().serve()
    try:
        rd = make_run(tmp_path / "cd", server=served.url)
        base = tmp_path / "agent"
        agent.register(rd.path, base)
        d = agent.Daemon(base)
        for _ in range(20):
            d.once()
            if not agent.registered(base):
                break
        assert not agent.registered(base)
        served.fake.assert_exactly_once("r1", "main", rd.log().last_seq())
    finally:
        served.close()


def test_daemon_keeps_a_live_run_registered(tmp_path) -> None:
    served = FakeIngest().serve()
    try:
        rd = make_run(tmp_path / "cd", server=served.url, finish=False)
        w = RunWriter(rd, "r1")  # a live writer holds the log
        base = tmp_path / "agent"
        agent.register(rd.path, base)
        d = agent.Daemon(base)
        for _ in range(5):
            d.once()
        assert agent.registered(base)
        w.finish("completed", 0)
        w.close()
        for _ in range(5):
            d.once()
        assert not agent.registered(base)
        served.fake.assert_exactly_once("r1", "main", rd.log().last_seq())
    finally:
        served.close()


def test_daemon_records_status_when_the_server_is_down(tmp_path) -> None:
    rd = make_run(tmp_path / "cd", server="http://127.0.0.1:9")
    base = tmp_path / "agent"
    agent.register(rd.path, base)
    agent.Daemon(base).once()
    status = agent.read_status(rd.path, base)
    assert status and status["error"]
    assert agent.registered(base)


def test_one_daemon_at_a_time(tmp_path) -> None:
    base = tmp_path / "agent"
    fd = agent.try_lock(base / "agent.lock")  # another daemon
    try:
        assert agent.is_running(base)
        assert agent.Daemon(base).run() == 1
        assert agent.ensure_running(base) is False
    finally:
        os.close(fd)
    assert not agent.is_running(base)


def _daemon_env(base: Path, **extra: str) -> dict[str, str]:
    return {**os.environ, "CAIRN_AGENT_DIR": str(base), **extra}


def test_spawned_daemons_exclude_each_other_and_exit_when_idle(tmp_path) -> None:
    base = tmp_path / "agent"
    env = _daemon_env(base, CAIRN_AGENT_IDLE_EXIT="1.5")
    cmd = [sys.executable, "-m", "cairn", "sync", "--daemon"]
    a = subprocess.Popen(cmd, env=env)
    deadline = time.monotonic() + 15
    while not agent.is_running(base):
        assert time.monotonic() < deadline
        time.sleep(0.05)
    b = subprocess.run(cmd, env=env, timeout=15)
    assert b.returncode == 1  # the lock is held
    assert a.wait(timeout=20) == 0  # idle exit
    assert not agent.is_running(base)


def test_kill_9_at_random_points_then_restart(tmp_path) -> None:
    """The uploader killed at random moments and restarted, again and again,
    while the server drops connections and errors: every record arrives
    exactly once."""
    fake = FakeIngest(fault=flaky(0.15, seed=3))
    served = fake.serve()
    try:
        base = tmp_path / "agent"
        dirs = [make_run(tmp_path / "cd", f"run{i}", n=1500, server=served.url, blobs=5)
                for i in range(3)]
        for rd in dirs:
            agent.register(rd.path, base)
        env = _daemon_env(base, CAIRN_AGENT_IDLE_EXIT="2")
        cmd = [sys.executable, "-m", "cairn", "sync", "--daemon"]
        rng = random.Random(11)
        kills = 0
        deadline = time.monotonic() + 120
        while agent.registered(base):
            assert time.monotonic() < deadline, "did not finish"
            p = subprocess.Popen(cmd, env=env)
            time.sleep(rng.uniform(0.05, 0.6))
            if p.poll() is None:
                p.send_signal(signal.SIGKILL)
                kills += 1
            p.wait()
            # Its lock dies with it.
        assert kills >= 3
        for rd in dirs:
            fake.assert_exactly_once(rd.run_id, "main", rd.log().last_seq())
            assert rd.log().acked() == rd.log().last_seq()
    finally:
        served.close()


def test_status_file_is_json(tmp_path) -> None:
    base = tmp_path / "agent"
    rd = make_run(tmp_path / "cd")
    agent.register(rd.path, base)
    d = agent.Daemon(base)
    d._status(rd.path, "boom")
    assert json.loads(agent.status_path(rd.path, base).read_text())["error"] == "boom"
