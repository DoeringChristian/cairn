"""Fault scenarios. Each takes a system kind and returns one result row.

Systems (columns):
  cairn-http   0.6: ``cairn.Run(repo="cairn://…")``: the run writes its run
               directory, the uploader daemon sends it to a ``cairn server``
  mlflow       MLflow client to an ``mlflow server`` (SQLite backend store)
  cairn-local  0.6: ``cairn.Run(repo=<dir>)``: same, to the repo's
               auto-started local daemon server (restarted by the uploader
               itself after a kill)

cairn rows record what arrived through the uploader daemon alone
(``before_sync``) and, separately, after a manual ``cairn sync``.

The training loop is ``bench.worker`` at ``RATE`` steps/s x ``METRICS``
metrics (deterministic values), with a progress file holding the last step
whose track()/log call returned. After the fault, the runner reads every
point back through the API and counts lost / duplicated / reordered /
corrupted points (``bench.readback.verify``); ``lost_accepted`` are lost
points at steps the client had already been told were logged.
"""

from __future__ import annotations

import json
import os
import random
import shutil
import signal
import sqlite3
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any, Callable

import httpx

from bench import common as c
from bench import readback as rb
from bench.systems import System, make_system

from .proxy import FaultProxy

METRICS = 5
RATE = 100  # steps/s -> 500 points/s
DURATION = 40.0  # seconds of logging
FAULT_AT = 10.0
RECOVERY_TIMEOUT = 240.0

SYSTEMS = ["cairn-http", "mlflow", "cairn-local"]
_BACKEND = {"cairn-http": "cairn-http", "mlflow": "mlflow-sqlite", "cairn-local": "cairn-local"}


def _names(prefix: str = "m") -> list[str]:
    return [f"{prefix}{j}" for j in range(METRICS)]


def _read_progress(path: Path) -> int:
    try:
        return int(path.read_text().strip() or -1)
    except (OSError, ValueError):
        return -1


class Case:
    """One system under one fault: server, optional proxy, worker processes."""

    def __init__(self, system: str, work: Path, *, proxy: bool = False, server_root: Path | None = None) -> None:
        self.system = system
        self.work = work
        if work.exists():
            shutil.rmtree(work)
        work.mkdir(parents=True)
        self.sysm: System = make_system(_BACKEND[system], server_root or work)
        self.sysm.work = work if server_root is None else server_root
        # keep the server's log beside the case (not on a volume under test)
        self.sysm.server.log_path = work / f"server-{self.sysm.server.port}.log"
        self.env = c.isolated_env(work)
        self.proxy: FaultProxy | None = None
        self.target = self.sysm.target
        self.server_up_t: float | None = None
        if proxy and system != "cairn-local":
            pport = c.free_port(4580, 4589)
            self._pport = pport
        self._want_proxy = proxy and system != "cairn-local"
        self.procs: list[tuple[subprocess.Popen, Path, dict]] = []

    def start_server(self) -> float:
        t = self.sysm.server.start()
        if self._want_proxy and self.proxy is None:
            self.proxy = FaultProxy(self._pport, self.sysm.server.port)
            scheme = "cairn" if self.system.startswith("cairn") else "http"
            self.target = f"{scheme}://127.0.0.1:{self._pport}"
        return t

    def spawn(self, name: str, *, steps: int | None = None, prefix: str = "m", run_id: str | None = None,
              label: str | None = None, primary: bool = True, rate: float = RATE, deadline: float | None = None,
              extra: dict | None = None) -> None:
        prog = self.work / f"progress-{name}.txt"
        a = self.sysm.worker_args(project="faults", name=name, metrics=METRICS,
                                  steps=steps if steps is not None else int(RATE * DURATION),
                                  rate=rate, progress=str(prog), prefix=prefix, catch=True,
                                  deadline=deadline if deadline is not None else DURATION * 4)
        a["target"] = self.target
        if run_id:
            a.update(run_id=run_id, label=label, primary=primary)
        a.update(extra or {})
        if self.system == "mlflow":
            a["backend"] = "mlflow"
        out = open(self.work / f"worker-{name}.out", "w")  # noqa: SIM115
        p = subprocess.Popen([self.sysm.python, "-m", "bench.worker", json.dumps(a)], env=self.env,
                             cwd=c.work_cwd(), stdout=out, stderr=subprocess.STDOUT, start_new_session=True)
        self.procs.append((p, prog, a))

    def wait_workers(self, timeout: float) -> list[dict]:
        out = []
        deadline = time.monotonic() + timeout
        for p, _prog, _a in self.procs:
            try:
                p.wait(timeout=max(1, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                os.killpg(p.pid, signal.SIGKILL)
                p.wait()
        for i, (p, prog, a) in enumerate(self.procs):
            res = {"killed": p.returncode in (-9, 137) or p.returncode is None}
            try:
                lines = (self.work / f"worker-{a['name']}.out").read_text().strip().splitlines()
                for line in reversed(lines):
                    if line.startswith("{"):
                        res.update(json.loads(line))
                        break
            except (OSError, json.JSONDecodeError):
                pass
            res["progress_last"] = _read_progress(prog)
            res["name"] = a["name"]
            res["prefix"] = a.get("prefix", "m")
            out.append(res)
        return out

    def _follow(self) -> None:
        """cairn-local: the auto-started server may have been restarted (by
        the uploader) on another port."""
        srv = self.sysm.server
        if isinstance(srv, c.LocalRepoServer) and srv.refresh():
            self.sysm.read_url = srv.url

    def run_id_of(self, name: str, timeout: float = 30.0) -> str | None:
        from bench.scenarios import _discover

        t0 = time.monotonic()
        while time.monotonic() - t0 < timeout:
            self._follow()
            rid = _discover(self.sysm, "faults", name)
            if rid:
                return rid
            time.sleep(0.25)
        return None

    def readback(self, run_id: str, prefix: str = "m") -> dict[str, list[tuple[int, float]]]:
        self._follow()
        return rb.points(self.sysm.read_kind, self.sysm.read_url, run_id, _names(prefix))

    def status(self, run_id: str) -> str | None:
        self._follow()
        if self.sysm.read_kind == "mlflow":
            return rb.mlflow_status(self.sysm.read_url, run_id)
        return rb.cairn_status(self.sysm.read_url, run_id)

    def wait_complete(self, run_id: str, upto: int, prefix: str = "m", timeout: float = RECOVERY_TIMEOUT,
                      since: float | None = None) -> float | None:
        """Seconds (from ``since``) until every point at steps <= ``upto`` is
        readable; None on timeout or when some never arrive."""
        since = since or time.monotonic()
        while time.monotonic() - since < timeout:
            try:
                got = self.readback(run_id, prefix)
                v = rb.verify(got, _names(prefix), range(0, upto + 1))
                if v["lost"] == 0:
                    return time.monotonic() - since
            except (httpx.HTTPError, ValueError, KeyError):
                pass
            time.sleep(0.5)
        return None

    def close(self) -> None:
        for p, _, _ in self.procs:
            if p.poll() is None:
                try:
                    os.killpg(p.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        c.stop_uploaders(self.work)
        if self.proxy:
            self.proxy.close()
        self.sysm.server.stop()


def _sync_leftovers(case: Case, rid: str | None, w: dict, row: dict[str, Any]) -> None:
    """cairn (0.6): record what the uploader daemon delivered on its own
    (``before_sync``), then run ``cairn sync`` over the run directories (the
    manual recovery) and let the caller verify after."""
    if not case.system.startswith("cairn") or not rid:
        return
    row["before_sync"] = {k: v for k, v in _verify_row(case, w, rid).items()
                          if k in ("lost", "lost_accepted", "present", "duplicated", "corrupted")}
    pend = []
    for meta in (case.work / "cairn-runs" / "runs").glob("*/run.json"):
        d = meta.parent
        try:
            acked = json.loads((d / "acked").read_text())
        except (OSError, ValueError):
            acked = None
        pend.append({"run": d.name, "acked": acked, "finished": (d / "FINISHED").exists()})
    row["run_dirs_before_sync"] = pend
    cmd = [c.cairn_bin(), "sync", str(case.work / "cairn-runs")]
    if case.system == "cairn-http":
        cmd += ["--server", case.sysm.read_url]
    t0 = time.monotonic()
    r = subprocess.run(cmd, env=case.env, capture_output=True, text=True, timeout=300, cwd=c.work_cwd())
    row["sync_s"] = time.monotonic() - t0
    row["sync_output"] = (r.stdout + r.stderr)[-300:]


def _client_summary(w: dict) -> dict[str, Any]:
    lat = w.get("step_latency") or {}
    return {
        "client_raised": w.get("errors", 0), "client_first_errors": w.get("first_errors", [])[:2],
        "client_error": w.get("error"), "finish_error": w.get("finish_error"),
        "client_killed": w.get("killed"),
        "loop_blocked_s": lat.get("blocked_s"), "max_step_ms": lat.get("max_ms"),
        "steps_over_100ms": lat.get("over_100ms"), "finish_s": w.get("t_finish"),
        "steps_logged": (w.get("last_step", w.get("progress_last", -1)) + 1),
        "loop_s": w.get("t_loop"),
    }


def _verify_row(case: Case, w: dict, run_id: str | None, prefix: str = "m") -> dict[str, Any]:
    last = w.get("last_step")
    if last is None:
        last = w.get("progress_last", -1)
    accepted = w.get("progress_last", last)
    if run_id is None:
        return {"readable": False, "note": "run not found"}
    try:
        got = case.readback(run_id, prefix)
        v = rb.verify(got, _names(prefix), range(0, last + 1), accepted_last=accepted)
        v["readable"] = True
    except Exception as exc:  # noqa: BLE001
        v = {"readable": False, "read_error": f"{type(exc).__name__}: {str(exc)[:200]}"}
    v["final_status"] = case.status(run_id)
    return v


# ---------------------------------------------------------------- live faults

def _live(system: str, work: Path, *, proxy: bool, fault: Callable[[Case], None],
          restore: Callable[[Case], None] | None, fault_len: float, rate: float = RATE,
          deadline: float | None = None) -> dict[str, Any]:
    """Generic: start, log, fault at FAULT_AT, restore after ``fault_len``,
    wait for the worker, measure recovery, verify."""
    case = Case(system, work, proxy=proxy)
    row: dict[str, Any] = {"system": system}
    try:
        case.start_server()
        case.spawn("w", rate=rate, deadline=deadline)
        time.sleep(FAULT_AT)
        rid = case.run_id_of("w")
        fault(case)
        row["fault_at_step"] = _read_progress(case.procs[0][1])
        time.sleep(fault_len)
        t_restore = time.monotonic()
        upto = _read_progress(case.procs[0][1])
        if restore:
            restore(case)
        rid = rid or case.run_id_of("w", 60)
        row["recovery_s"] = case.wait_complete(rid, upto, since=t_restore) if rid else None
        w = case.wait_workers(DURATION * 6)[0]
        rid = rid or w.get("run_id")
        # let the uploader daemon finish (its backoff reaches 60 s)
        if rid:
            case.wait_complete(rid, w.get("progress_last", -1), timeout=90)
        _sync_leftovers(case, rid, w, row)
        row.update(_client_summary(w))
        row.update(_verify_row(case, w, rid))
    except Exception as exc:  # noqa: BLE001
        row["error"] = f"{type(exc).__name__}: {exc}"
    finally:
        case.close()
    return row


def server_kill9(system: str, work: Path) -> dict[str, Any]:
    """kill -9 the server mid-run; restart it 5 s later on the same storage."""
    def fault(case: Case) -> None:
        case.sysm.server.kill9()

    def restore(case: Case) -> None:
        # cairn-local: nothing; the uploader daemon starts the repo's server again
        if case.system != "cairn-local":
            case.sysm.server.start()

    return _live(system, work, proxy=False, fault=fault, restore=restore, fault_len=5.0)


def unreachable_30s(system: str, work: Path) -> dict[str, Any]:
    """The server is unreachable for 30 s: the proxy resets every connection."""
    if system == "cairn-local":
        return {"system": system, "na": "no network between the run and its repo"}
    return _live(system, work, proxy=True, fault=lambda cs: cs.proxy.down("reset"),
                 restore=lambda cs: cs.proxy.up(), fault_len=30.0)


def partition_30s(system: str, work: Path) -> dict[str, Any]:
    """A 30 s partition: packets go nowhere (connections hang, no RST)."""
    if system == "cairn-local":
        return {"system": system, "na": "no network between the run and its repo"}
    return _live(system, work, proxy=True, fault=lambda cs: cs.proxy.down("blackhole"),
                 restore=lambda cs: cs.proxy.up(), fault_len=30.0)


def slow_server(system: str, work: Path) -> dict[str, Any]:
    """+250 ms per forwarded chunk each way for the whole run (a slow link /
    overloaded server); the loop wants RATE steps/s for DURATION s."""
    if system == "cairn-local":
        return {"system": system, "na": "no network between the run and its repo"}
    case = Case(system, work, proxy=True)
    row: dict[str, Any] = {"system": system, "added_latency_ms_per_chunk": 250}
    try:
        case.start_server()
        case.proxy.latency = 0.25
        case.spawn("w", deadline=DURATION)
        w = case.wait_workers(DURATION * 10)[0]
        rid = w.get("run_id") or case.run_id_of("w")
        case.proxy.latency = 0.0
        if rid:
            case.wait_complete(rid, w.get("progress_last", -1), timeout=60)
        row.update(_client_summary(w))
        row["achieved_steps_per_s"] = (w.get("last_step", -1) + 1) / w["t_loop"] if w.get("t_loop") else None
        row["target_steps_per_s"] = RATE
        row.update(_verify_row(case, w, rid))
    except Exception as exc:  # noqa: BLE001
        row["error"] = f"{type(exc).__name__}: {exc}"
    finally:
        case.close()
    return row


def client_kill9(system: str, work: Path) -> dict[str, Any]:
    """kill -9 the training process mid-run; the uploader daemon sends what
    the run directory holds; then (cairn) ``cairn sync``."""
    case = Case(system, work)
    row: dict[str, Any] = {"system": system}
    try:
        case.start_server()
        case.spawn("w")
        time.sleep(FAULT_AT)
        p, prog, _a = case.procs[0]
        os.killpg(p.pid, signal.SIGKILL)
        t_kill = time.monotonic()
        w = case.wait_workers(30)[0]
        rid = case.run_id_of("w")
        row["killed_at_step"] = w["progress_last"]
        # what arrives on its own (the uploader daemon)
        row["complete_without_sync_s"] = case.wait_complete(rid, w["progress_last"], timeout=60, since=t_kill) if rid else None
        _sync_leftovers(case, rid, w, row)
        row.update(_client_summary(w))
        row.update(_verify_row(case, w, rid))
    except Exception as exc:  # noqa: BLE001
        row["error"] = f"{type(exc).__name__}: {exc}"
    finally:
        case.close()
    return row


# ---------------------------------------------------------------- disk full

class SmallVolume:
    """A size-limited HFS+ volume (sparse disk image) mounted under ``work``."""

    def __init__(self, work: Path, size_mb: int = 64) -> None:
        self.work = work
        self.image = work / "vol.sparseimage"
        self.mnt = work / "mnt"
        self.mnt.mkdir(parents=True, exist_ok=True)
        subprocess.run(["hdiutil", "create", "-quiet", "-size", f"{size_mb}m", "-fs", "HFS+", "-volname", "cbfull",
                        "-type", "SPARSE", str(work / "vol")], check=True)
        subprocess.run(["hdiutil", "attach", "-quiet", "-nobrowse", "-mountpoint", str(self.mnt), str(self.image)],
                       check=True)
        self.filler = self.mnt / "filler.bin"

    def free(self) -> int:
        return shutil.disk_usage(self.mnt).free

    def fill(self, leave: int) -> None:
        n = max(0, self.free() - leave)
        with open(self.filler, "wb") as fh:
            chunk = b"\0" * (1 << 20)
            while n > 0:
                k = min(n, len(chunk))
                try:
                    fh.write(chunk[:k])
                except OSError:
                    break
                n -= k

    def release(self) -> None:
        self.filler.unlink(missing_ok=True)

    def close(self) -> None:
        subprocess.run(["hdiutil", "detach", "-quiet", "-force", str(self.mnt)], capture_output=True)


def disk_full(system: str, work: Path) -> dict[str, Any]:
    """The server's storage (cairn-local: the whole repo) is on a 64 MB volume
    filled to ~1.5 MB free; the run logs scalars plus a 128 px image every 10
    steps until the disk is full; at t=25 s the filler is deleted."""
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    vol = SmallVolume(work)
    row: dict[str, Any] = {"system": system, "volume_mb": 64}
    case = None
    try:
        case = Case(system, work / "case", server_root=vol.mnt / "srv")
        case.start_server()
        time.sleep(2)
        vol.fill(1_500_000)
        row["free_before_bytes"] = vol.free()
        case.spawn("w", extra={"media_every": 10, "media_px": 128})
        time.sleep(25)
        row["free_at_release_bytes"] = vol.free()
        upto = _read_progress(case.procs[0][1])
        vol.release()
        t_rel = time.monotonic()
        rid = case.run_id_of("w", 30)
        row["server_alive_at_release"] = case.sysm.server.alive()
        row["recovery_s"] = case.wait_complete(rid, upto, since=t_rel, timeout=90) if rid else None
        w = case.wait_workers(DURATION * 6)[0]
        rid = rid or w.get("run_id")
        if rid:
            case.wait_complete(rid, w.get("progress_last", -1), timeout=60)
        _sync_leftovers(case, rid, w, row)
        row.update(_client_summary(w))
        row.update(_verify_row(case, w, rid))
        row["server_alive_at_end"] = case.sysm.server.alive()
        try:
            text = case.sysm.server.log_path.read_text(errors="replace")
            errs: dict[str, int] = {}
            for line in text.splitlines():
                if any(k in line for k in ("Error", "error", "not ingesting", "lease")):
                    key = line.strip()[:160]
                    errs[key] = errs.get(key, 0) + 1
            row["server_log_errors"] = sorted(errs.items(), key=lambda kv: -kv[1])[:8]
        except OSError:
            pass
    except Exception as exc:  # noqa: BLE001
        row["error"] = f"{type(exc).__name__}: {exc}"
    finally:
        if case:
            case.close()
        vol.close()
    return row


# ---------------------------------------------------------------- torn writes

def _truncate_trials(path: Path, seeds: int, work: Path, prepare_copy: Callable[[Path], Path],
                     check: Callable[[Path, int], dict[str, Any]],
                     offsets: list[int] | None = None) -> list[dict[str, Any]]:
    """For ``seeds`` random offsets into ``path`` (seeded): copy the state
    (``prepare_copy`` -> the copy's root), ``check(root, offset)`` (which
    truncates the copy's file and inspects the result)."""
    size = path.stat().st_size
    rng = random.Random(1234)
    out = []
    offs = offsets if offsets is not None else [rng.randrange(0, max(1, size)) for _ in range(seeds)]
    for k, off in enumerate(offs):
        root = prepare_copy(work / f"trial{k}")
        out.append({"offset": off, "size": size, **check(root, off)})
        shutil.rmtree(root, ignore_errors=True)
    return out


def _sqlite_integrity(db: Path) -> str:
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=5)
        r = con.execute("PRAGMA quick_check").fetchall()
        con.close()
        return "ok" if r == [("ok",)] else f"{len(r)} problems: {str(r[0])[:120]}"
    except sqlite3.Error as exc:
        return f"error: {exc}"


def torn_writes(system: str, work: Path, seeds: int = 8) -> dict[str, Any]:
    """Truncate a store's files at random offsets, on copies, then restart /
    read. Targets: cairn-local — the run's unapplied log (``wals/*.wal.jsonl``)
    and the SQLite database; cairn-http — the client's pending write-ahead log
    (replayed by ``cairn sync``) and the server database; mlflow — its SQLite
    database. Each trial reports whether the server started, whether reads
    worked, ``PRAGMA quick_check``, and lost/corrupted points against what the
    intact copy held."""
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    out: dict[str, Any] = {"system": system, "targets": {}}
    steps = 2000

    def run_base(name: str, *, kill_server_after: float | None = None,
                 rate: float = 0) -> tuple[Case, dict, str | None]:
        case = Case(system, work / name)
        case.env["CAIRN_FINISH_TIMEOUT"] = "3"
        case.start_server()
        case.spawn("w", steps=steps, rate=rate)
        if kill_server_after is not None:
            time.sleep(kill_server_after)
            case.sysm.server.kill9()
        w = case.wait_workers(600)[0]
        rid = w.get("run_id")
        if rid and kill_server_after is None and system != "mlflow":
            case.wait_complete(rid, w.get("last_step", -1), timeout=60)
        c.stop_uploaders(case.work)  # nothing may write the state being copied
        return case, w, rid

    def check_with_server(base_case: Case, rel: str, rid: str, last: int, *, sync: bool = False,
                          control: bool = False):
        def prepare(dst: Path) -> Path:
            if dst.exists():
                shutil.rmtree(dst)
            shutil.copytree(base_case.work, dst, symlinks=True,
                            ignore=shutil.ignore_patterns("*.open-lock", "ingest.lease", "*.log"))
            return dst

        def check(root: Path, off: int) -> dict[str, Any]:
            f = root / rel
            with open(f, "r+b") as fh:
                fh.truncate(off)
            res: dict[str, Any] = {}
            if f.suffix == ".db" or f.name.endswith(".db"):
                res["quick_check"] = _sqlite_integrity(f)
            # a fresh server over the copy
            # the original port: a client log names the server it replays to
            port = base_case.sysm.server.port
            if system == "mlflow":
                srv = c.mlflow_server("sqlite", root, port)
            else:
                srv = c.cairn_server(root / "repo", root, port)
            try:
                srv.start(timeout=30)
                res["server_started"] = True
            except Exception as exc:  # noqa: BLE001
                res["server_started"] = False
                res["start_error"] = str(exc)[:200]
                try:
                    res["server_log_tail"] = srv.log_path.read_text()[-300:]
                except OSError:
                    pass
                srv.kill9()
                return res
            try:
                if sync:
                    env = c.isolated_env(root, CAIRN_UPLOADER="off")
                    r = subprocess.run([c.cairn_bin(), "sync", str(root / "cairn-runs"), "--server", srv.url],
                                       env=env, capture_output=True, text=True, timeout=300, cwd=c.work_cwd())
                    res["sync_rc"] = r.returncode
                    res["sync_tail"] = (r.stdout + r.stderr)[-200:]
                kind = "mlflow" if system == "mlflow" else "cairn"
                got = rb.points(kind, srv.url, rid, _names())
                v = rb.verify(got, _names(), range(0, last + 1))
                res.update(v)
                res["readable"] = True
            except Exception as exc:  # noqa: BLE001
                res["readable"] = False
                res["read_error"] = f"{type(exc).__name__}: {str(exc)[:200]}"
            finally:
                srv.kill9()
            return res

        target = base_case.work / rel
        if not target.exists():
            return [{"error": f"no {rel}"}]
        return _truncate_trials(target, seeds, work / f"trials-{rel.replace('/', '_')}", prepare, check,
                                offsets=[target.stat().st_size] if control else None)

    def _wal_target(case: Case, rel: str, rid: str, last: int) -> None:
        """The SQLite WAL file, when the stopped server left one with frames."""
        f = case.work / rel
        out.setdefault("db_files", {})[rel] = f.stat().st_size if f.exists() else None
        db = case.work / rel.removesuffix("-wal")
        out["db_files"][str(db.relative_to(case.work))] = db.stat().st_size if db.exists() else None
        if f.exists() and f.stat().st_size > 0:
            out["targets"]["database_wal_file"] = check_with_server(case, rel, rid, last)

    try:
        if system == "cairn-local":
            out["na"] = ("same files as cairn-http (run directory log segment + the server's cairn.db); "
                         "measured there")
            return out
        elif system == "cairn-http":
            # 1) the run directory's log segment with records the server never
            #    acked: the server is killed 3 s in, the run keeps logging and
            #    finish() gives up after 3 s; the uploader is stopped; each trial
            #    truncates the segment, starts a server on the copy and runs
            #    `cairn sync` on the copy's run directory
            case, w, rid = run_base("wal", kill_server_after=3.0, rate=200)
            segs = sorted((case.work / "cairn-runs" / "runs").glob("*/log/*.seg"))
            out["run_log_segments"] = [str(p.relative_to(case.work)) for p in segs]
            try:
                out["acked_at_copy"] = json.loads(next((case.work / "cairn-runs" / "runs").glob("*/acked")).read_text())
            except (StopIteration, OSError, ValueError):
                out["acked_at_copy"] = None
            if segs and rid:
                rel = str(segs[0].relative_to(case.work))
                out["targets"]["run_log"] = check_with_server(case, rel, rid, w["last_step"], sync=True)
                out["targets"]["run_log_untruncated_control"] = check_with_server(
                    case, rel, rid, w["last_step"], sync=True, control=True)
            case.close()
            # 2) the server database after a clean stop
            case, w, rid = run_base("db")
            case.sysm.server.stop()
            out["targets"]["database"] = check_with_server(case, "repo/cairn.db", rid, w["last_step"])
            _wal_target(case, "repo/cairn.db-wal", rid, w["last_step"])
            case.close()
        else:
            case, w, rid = run_base("db")
            case.sysm.server.stop()
            out["targets"]["database"] = check_with_server(case, "mlflow.db", rid, w["last_step"])
            _wal_target(case, "mlflow.db-wal", rid, w["last_step"])
            case.close()
    except Exception as exc:  # noqa: BLE001
        out["error"] = f"{type(exc).__name__}: {exc}"
    # roll-up per target
    for name, trials in out["targets"].items():
        out.setdefault("summary", {})[name] = {
            "trials": len(trials),
            "server_failed_to_start": sum(1 for t in trials if t.get("server_started") is False),
            "unreadable": sum(1 for t in trials if t.get("server_started") and not t.get("readable")),
            "quick_check_failed": sum(1 for t in trials if t.get("quick_check", "ok") != "ok"),
            "with_loss": sum(1 for t in trials if (t.get("lost") or 0) > 0),
            "points_lost_total": sum(t.get("lost") or 0 for t in trials),
            "corrupted_total": sum(t.get("corrupted") or 0 for t in trials),
            "duplicated_total": sum(t.get("duplicated") or 0 for t in trials),
        }
    return out


# ---------------------------------------------------------------- concurrency

def concurrent(system: str, work: Path) -> dict[str, Any]:
    """(a) 8 clients, 8 runs, flat out (2000 steps each); (b) 2 processes
    logging to the same run (different metric names; cairn: the second joins
    as ``primary=False`` with a label; MLflow: both ``start_run(run_id=)``)."""
    row: dict[str, Any] = {"system": system}
    case = Case(system, work / "eight")
    try:
        case.start_server()
        for i in range(8):
            case.spawn(f"c{i}", steps=2000, rate=0)
        ws = case.wait_workers(900)
        agg = {"lost": 0, "duplicated": 0, "corrupted": 0, "reordered": 0, "expected": 0, "raised": 0,
               "unreadable": 0}
        for w in ws:
            rid = w.get("run_id") or case.run_id_of(w["name"])
            if rid:
                case.wait_complete(rid, w.get("last_step", -1), timeout=120)
            v = _verify_row(case, w, rid)
            for k in ("lost", "duplicated", "corrupted", "reordered", "expected"):
                agg[k] += v.get(k) or 0
            agg["raised"] += w.get("errors", 0) + (1 if w.get("error") else 0)
            agg["unreadable"] += 0 if v.get("readable") else 1
        agg["max_loop_blocked_s"] = max(((w.get("step_latency") or {}).get("blocked_s") or 0) for w in ws)
        row["eight_runs"] = agg
    except Exception as exc:  # noqa: BLE001
        row["eight_runs"] = {"error": f"{type(exc).__name__}: {exc}"}
    finally:
        case.close()

    case = Case(system, work / "same")
    try:
        case.start_server()
        if system == "mlflow":
            cl = httpx.Client(base_url=case.sysm.read_url, timeout=30)
            exp = cl.post("/api/2.0/mlflow/experiments/create", json={"name": "faults"}).json()["experiment_id"]
            rid = cl.post("/api/2.0/mlflow/runs/create", json={"experiment_id": exp, "run_name": "shared"}).json()["run"]["info"]["run_id"]
            case.spawn("a", steps=2000, prefix="a", run_id=rid, rate=200)
            case.spawn("b", steps=2000, prefix="b", run_id=rid, rate=200)
        else:
            rid = uuid.uuid4().hex
            case.spawn("a", steps=2000, prefix="a", run_id=rid, primary=True, rate=200)
            time.sleep(2)
            case.spawn("b", steps=2000, prefix="b", run_id=rid, label="rank1", primary=False, rate=200)
        ws = case.wait_workers(900)
        res = {}
        for w in ws:
            case.wait_complete(rid, w.get("last_step", -1), prefix=w["prefix"], timeout=120)
            v = _verify_row(case, w, rid, w["prefix"])
            res[w["name"]] = {**{k: v.get(k) for k in ("expected", "lost", "duplicated", "corrupted", "reordered",
                                                       "readable", "final_status")},
                              "raised": w.get("errors", 0), "error": w.get("error")}
        row["same_run_two_processes"] = res
    except Exception as exc:  # noqa: BLE001
        row["same_run_two_processes"] = {"error": f"{type(exc).__name__}: {exc}"}
    finally:
        case.close()
    return row


SCENARIOS: dict[str, Callable[[str, Path], dict[str, Any]]] = {
    "server_kill9": server_kill9,
    "unreachable_30s": unreachable_30s,
    "partition_30s": partition_30s,
    "slow_server": slow_server,
    "client_kill9": client_kill9,
    "disk_full": disk_full,
    "torn_writes": torn_writes,
    "concurrent": concurrent,
}

