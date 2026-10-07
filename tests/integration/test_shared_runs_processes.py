"""Shared runs with real processes: a primary and three workers (spawned
interpreters) logging into one run, on a local repo with no server, on a repo
a real ``cairn ui`` serves, and straight to that server over HTTP.

The workers start before the primary creates the run. Every series must hold
exactly the points its process logged, every console line its process label,
every process its ``system.<label>.*`` series; the run's status is the
primary's (a worker failing changes nothing); every log is gone afterwards.
"""

from __future__ import annotations

import multiprocessing as mp
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest

import cairn

REPO_ROOT = Path(__file__).resolve().parents[2]
N = 4  # processes: rank 0 (the primary) and three workers
K = 40  # points each process logs per series
LINES = 5  # console lines each process prints
FAILING_RANK = 2  # this worker raises at the end: the run stays the primary's


def _quiet_child() -> None:
    os.environ["BROWSER"] = "true"  # never a browser tab (conftest sets it too)


def _log_work(run: cairn.Run, rank: int) -> None:
    for step in range(K):
        run.track(float(rank * 1000 + step), f"rank{rank}.loss", step=step)
    if rank == 0:
        for step in range(K):  # a shared metric, logged by rank 0 only
            run.track(1e-3 / (step + 1), "lr", step=step)
    for i in range(LINES):
        print(f"line {i} from rank {rank}", flush=True)
    time.sleep(0.3)  # a few system-metric samples (interval 0.1 s)


def _env_rank_main(target: str, run_id: str, rank: int, joined: list, token: str | None) -> None:
    """One process of the CAIRN_RUN_ID launch: every process gets the id and
    its RANK; ``label="auto"`` makes rank 0 the primary ``rank0`` and the
    others workers ``rankN``."""
    _quiet_child()
    os.environ["CAIRN_RUN_ID"] = run_id
    os.environ["RANK"] = str(rank)
    if token:
        os.environ["CAIRN_TOKEN"] = token
    if rank == 0:
        # Create the run only once every worker has joined (local repos: a
        # worker joins at once and its log waits for the run). Over HTTP a
        # worker's join waits for the run instead: start a little later.
        if target.startswith("cairn://"):
            time.sleep(1.5)
        else:
            for ev in joined:
                assert ev.wait(60), "a worker never joined"
    run = cairn.Run(
        project="shared", label="auto", repo=target, capture_source=False,
        system_metrics_interval=0.1,
    )
    assert (run._label, run._primary) == (f"rank{rank}", rank == 0)
    if rank:
        joined[rank - 1].set()
    with run:
        _log_work(run, rank)
        if rank == FAILING_RANK:
            raise RuntimeError("this worker fails; the run does not")


def _broadcast_primary_main(target: str, run_ids: mp.Queue, copies: int) -> None:
    """torch.distributed-style: rank 0 creates the run and broadcasts its id."""
    _quiet_child()
    with cairn.Run(project="shared", repo=target, capture_source=False,
                   system_metrics_interval=0.1) as run:
        for _ in range(copies):
            run_ids.put(run.id)
        _log_work(run, 0)


def _broadcast_worker_main(target: str, run_ids: mp.Queue, rank: int) -> None:
    _quiet_child()
    run_id = run_ids.get(timeout=60)
    with cairn.attach(run_id, label=f"rank{rank}", repo=target) as run:
        _log_work(run, rank)
        if rank == FAILING_RANK:
            raise RuntimeError("this worker fails; the run does not")


def _run_all(procs: list[mp.Process]) -> dict[str, int | None]:
    for p in procs:
        p.start()
    deadline = time.monotonic() + 120
    for p in procs:
        p.join(timeout=max(0.0, deadline - time.monotonic()))
    codes = {}
    for p in procs:
        if p.is_alive():
            p.kill()
            p.join(5)
        codes[p.name] = p.exitcode
    return codes


def _launch_env(target: str, token: str | None = None) -> tuple[str, dict]:
    ctx = mp.get_context("spawn")
    run_id = cairn.new_run_id()
    joined = [ctx.Event() for _ in range(N - 1)]
    procs = [
        ctx.Process(target=_env_rank_main, args=(target, run_id, r, joined, token),
                    name=f"rank{r}")
        for r in range(N)
    ]
    # Workers first: they are running before the run exists.
    return run_id, _run_all(procs[1:] + procs[:1])


def _launch_broadcast(target: str) -> tuple[str, dict]:
    ctx = mp.get_context("spawn")
    ids = ctx.Queue()
    # One id for each worker, one for this test.
    procs = [ctx.Process(target=_broadcast_primary_main, args=(target, ids, N), name="rank0")]
    procs += [ctx.Process(target=_broadcast_worker_main, args=(target, ids, r), name=f"rank{r}")
              for r in range(1, N)]
    codes = _run_all(procs)
    return ids.get(timeout=10), codes


def _check(target: str, run_id: str, codes: dict, *, primary_label: str | None) -> None:
    assert codes == {f"rank{r}": (1 if r == FAILING_RANK else 0) for r in range(N)}, codes
    reader = cairn.Reader(repo=target)
    run = reader.run(run_id)
    assert run.status == "completed"  # the primary's, though a worker failed
    assert [r.id for r in reader.runs(project="shared")] == [run_id]
    for rank in range(N):
        points = run.sequence(f"rank{rank}.loss").points
        assert [p.step for p in points] == list(range(K)), rank
        assert [p.scalar_value for p in points] == [float(rank * 1000 + s) for s in range(K)]
    assert len(run.sequence("lr").points) == K
    names = {s.name for s in run.sequences()}
    labels = [primary_label, *(f"rank{r}" for r in range(1, N))]
    for label in labels:
        prefix = "system." if label is None else f"system.{label}."
        assert f"{prefix}cpu.util_percent" in names, (label, sorted(names))
    lines = run.logs()
    for rank, label in enumerate(labels):
        mine = [ln for ln in lines if ln.label == label and "from rank" in ln.content]
        assert [ln.content for ln in mine] == [f"line {i} from rank {rank}" for i in range(LINES)]
        assert sorted(ln.line_no for ln in mine) == sorted({ln.line_no for ln in mine})
    assert {ln.label for ln in lines} == set(labels)


def _wals(repo: Path) -> list[str]:
    return sorted(p.name for p in (repo / "wals").glob("*.wal.jsonl"))


def _wait_ingested(repo: Path, timeout: float = 30.0) -> None:
    deadline = time.monotonic() + timeout
    while _wals(repo):
        assert time.monotonic() < deadline, f"logs not ingested: {_wals(repo)}"
        time.sleep(0.1)


# ---- a local repo, no server ---------------------------------------------------


@pytest.mark.timeout(240)
def test_env_launch_on_a_local_repo(tmp_path):
    repo = tmp_path / ".cairn"
    run_id, codes = _launch_env(str(repo))
    logs = _wals(repo)
    assert f"{run_id}~rank0.wal.jsonl" in logs and f"{run_id}~rank1.wal.jsonl" in logs
    _check(str(repo), run_id, codes, primary_label="rank0")  # the Reader ingests
    assert _wals(repo) == []


@pytest.mark.timeout(240)
def test_broadcast_attach_on_a_local_repo(tmp_path):
    repo = tmp_path / ".cairn"
    run_id, codes = _launch_broadcast(str(repo))
    _check(str(repo), run_id, codes, primary_label=None)
    assert _wals(repo) == []


# ---- a served repo, and HTTP to its server ---------------------------------------


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def served_repo(tmp_path):
    """A real ``cairn ui --no-open-browser`` over tmp/.cairn: (repo, port)."""
    subprocess.check_call([sys.executable, "-m", "cairn", "init", str(tmp_path)],
                          cwd=str(REPO_ROOT), timeout=60)
    repo = tmp_path / ".cairn"
    port = _free_port()
    proc = subprocess.Popen(
        [sys.executable, "-m", "cairn", "ui", "--repo", str(repo), "--host", "127.0.0.1",
         "--port", str(port), "--no-open-browser"],
        cwd=str(REPO_ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        deadline = time.monotonic() + 20
        while True:
            try:
                if httpx.get(f"http://127.0.0.1:{port}/api/health", timeout=1).status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            if time.monotonic() > deadline:
                pytest.fail("cairn ui never became ready")
            time.sleep(0.1)
        yield repo, port
    finally:
        proc.send_signal(signal.SIGINT)
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)


@pytest.mark.timeout(240)
def test_env_launch_on_a_served_repo(served_repo):
    repo, _port = served_repo
    run_id, codes = _launch_env(str(repo))
    _wait_ingested(repo)  # the server's ingest loop, nobody else
    _check(str(repo), run_id, codes, primary_label="rank0")


@pytest.mark.timeout(240)
def test_broadcast_attach_on_a_served_repo(served_repo):
    repo, _port = served_repo
    run_id, codes = _launch_broadcast(str(repo))
    _wait_ingested(repo)
    _check(str(repo), run_id, codes, primary_label=None)


@pytest.mark.timeout(240)
def test_env_launch_over_http(served_repo, monkeypatch):
    repo, port = served_repo
    token = (repo / "auth" / "local.token").read_text().strip()
    monkeypatch.setenv("CAIRN_TOKEN", token)
    url = f"cairn://127.0.0.1:{port}"
    run_id, codes = _launch_env(url, token)
    _check(url, run_id, codes, primary_label="rank0")
    # Every process's client-side log was delivered and removed.
    wal_dir = Path(os.environ["CAIRN_CACHE_DIR"]) / "wal"
    left = sorted(p.name for p in wal_dir.glob(f"{run_id}*")) if wal_dir.exists() else []
    assert left == []
