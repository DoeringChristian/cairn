"""The repo's ingest lease (``cairn/server/storage/lease.py``)."""

from __future__ import annotations

import json
import multiprocessing as mp
import os
import time

import pytest

from cairn.server.storage import lease as lease_mod


def _write(root, **info) -> dict:
    data = {
        "host": lease_mod.hostname(), "pid": os.getppid(), "token": "x" * 32,
        "mode": "cli", "url": None, "expires_at": time.time() + 30, **info,
    }
    root.mkdir(parents=True, exist_ok=True)
    lease_mod.lease_path(root).write_text(json.dumps(data))
    return data


def test_acquire_writes_and_release_removes(tmp_path):
    lease = lease_mod.acquire(tmp_path, mode="cli")
    info = lease_mod.read_lease(tmp_path)
    assert info["pid"] == os.getpid() and info["mode"] == "cli"
    assert info["expires_at"] > time.time()
    assert lease.valid()
    lease.release()
    assert lease_mod.read_lease(tmp_path) is None
    assert not lease.valid()


def test_shared_within_a_process(tmp_path):
    a = lease_mod.acquire(tmp_path, mode="server", url="http://127.0.0.1:1")
    b = lease_mod.acquire(tmp_path, mode="reader")
    assert a.info["token"] == b.info["token"]
    b.release()
    assert lease_mod.read_lease(tmp_path) is not None  # a still holds it
    a.release()
    assert lease_mod.read_lease(tmp_path) is None


def test_live_holder_blocks_until_wait_runs_out(tmp_path):
    _write(tmp_path)
    t0 = time.monotonic()
    with pytest.raises(lease_mod.LeaseBusy):
        lease_mod.acquire(tmp_path, mode="cli", wait=0.3)
    assert time.monotonic() - t0 >= 0.3


def test_live_server_holder_raises_served(tmp_path):
    _write(tmp_path, url="http://127.0.0.1:9", mode="ui")
    with pytest.raises(lease_mod.ServedByServer) as exc:
        lease_mod.acquire(tmp_path, mode="cli", wait=5)
    assert exc.value.holder["url"] == "http://127.0.0.1:9"
    assert lease_mod.serving_holder(tmp_path)["mode"] == "ui"


def test_dead_pid_on_this_host_is_taken_over_at_once(tmp_path):
    _write(tmp_path, pid=2**22 + 12345)  # no such process
    lease = lease_mod.acquire(tmp_path, mode="cli", wait=0)
    assert lease_mod.read_lease(tmp_path)["pid"] == os.getpid()
    lease.release()


def test_other_host_is_taken_over_only_after_expiry_plus_grace(tmp_path):
    now = time.time()
    _write(tmp_path, host="elsewhere", expires_at=now - lease_mod.GRACE + 5)
    with pytest.raises(lease_mod.LeaseBusy):
        lease_mod.acquire(tmp_path, mode="cli", wait=0.1)
    _write(tmp_path, host="elsewhere", expires_at=now - lease_mod.GRACE - 1)
    lease = lease_mod.acquire(tmp_path, mode="cli", wait=0)
    assert lease_mod.read_lease(tmp_path)["host"] == lease_mod.hostname()
    lease.release()


def test_renewal_extends_and_detects_a_takeover(tmp_path):
    lease = lease_mod.acquire(tmp_path, mode="server")
    held = lease._held
    before = held.info["expires_at"]
    time.sleep(0.01)
    assert held.renew()
    assert lease_mod.read_lease(tmp_path)["expires_at"] > before
    # Someone replaced it (we stalled past expiry): renewing must notice.
    _write(tmp_path, token="y" * 32)
    assert not held.renew()
    assert not lease.valid()
    lease.release()
    assert lease_mod.read_lease(tmp_path)["token"] == "y" * 32  # theirs is untouched


def test_a_holder_past_its_expiry_does_not_renew(tmp_path, monkeypatch):
    lease = lease_mod.acquire(tmp_path, mode="server")
    lease._held.info["expires_at"] = time.time() - 1
    assert not lease._held.renew()
    lease.release()
    # An expired lease is left for a takeover, not removed.
    assert lease_mod.read_lease(tmp_path) is not None


def _compete(root: str, q, hold: float) -> None:
    try:
        lease = lease_mod.acquire(root, mode="cli", wait=0)
    except lease_mod.LeaseBusy:
        q.put("lost")
        return
    q.put("won")
    time.sleep(hold)
    lease.release()


def test_two_processes_compete_one_wins(tmp_path):
    ctx = mp.get_context("spawn")
    q = ctx.Queue()
    procs = [ctx.Process(target=_compete, args=(str(tmp_path), q, 2.0)) for _ in range(4)]
    for p in procs:
        p.start()
    results = sorted(q.get(timeout=60) for _ in procs)
    for p in procs:
        p.join(timeout=30)
    assert results.count("won") == 1, results


def _hold_and_die(root: str, q) -> None:
    lease_mod.acquire(root, mode="cli")
    q.put("held")
    time.sleep(60)


def test_kill_9_holder_is_taken_over(tmp_path):
    ctx = mp.get_context("spawn")
    q = ctx.Queue()
    p = ctx.Process(target=_hold_and_die, args=(str(tmp_path), q))
    p.start()
    assert q.get(timeout=60) == "held"
    with pytest.raises(lease_mod.LeaseBusy):
        lease_mod.acquire(tmp_path, mode="cli", wait=0.2)
    p.kill()
    p.join(timeout=30)
    lease = lease_mod.acquire(tmp_path, mode="cli", wait=5)
    assert lease_mod.read_lease(tmp_path)["pid"] == os.getpid()
    lease.release()
