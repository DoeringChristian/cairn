"""Shared plumbing for the benchmark and fault suites.

Everything a scenario needs to stand up a system under test and measure it:

* isolated environments (``HOME``, cairn cache/WAL dirs, no inherited
  ``CAIRN_*``/``MLFLOW_*`` settings, ``BROWSER=true``) so a benchmark never
  touches the user's ``~/.cairn`` / config / caches;
* the three systems: a ``cairn server`` over a repo directory, an MLflow
  tracking server (SQLite, or Postgres in a podman container);
* the Python interpreters: cairn's (the one running this module), MLflow's
  (a venv with ``mlflow`` installed, created on demand with ``uv``) and
  Playwright's (likewise);
* process memory sampling, percentiles, machine info, JSON results.

Nothing here imports cairn or mlflow: workers do, in their own processes.
"""

from __future__ import annotations

import json
import os
import platform
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator

import httpx
import psutil

REPO_ROOT = Path(__file__).resolve().parent.parent  # the harness (bench/, faults/)


def bench_root() -> Path:
    """Where data, servers and helper venvs live (``BENCH_ROOT``; default
    ``<tmp>/cairn-bench``). Never the user's home."""
    root = Path(os.environ.get("BENCH_ROOT") or Path(os.environ.get("TMPDIR", "/tmp")) / "cairn-bench")
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


# ---------------------------------------------------------------- interpreters

# The cairn under test: a checkout (``--cairn PATH`` / ``BENCH_CAIRN``) whose
# ``.venv`` runs the clients, ``cairn server``/``ui`` and ``cairn sync``, or an
# interpreter given directly (``BENCH_CAIRN_PYTHON``). Default: the
# interpreter running the harness (this checkout's ``uv run`` environment).
CAIRN_CHECKOUT = REPO_ROOT
CAIRN_PY = sys.executable


def configure_cairn(checkout: str | Path | None = None, python: str | None = None) -> None:
    """Point the suites at another cairn checkout (or interpreter).

    ``checkout``'s ``.venv`` is created with ``uv sync --extra ui`` when it
    does not exist. Workers and servers then import that checkout's cairn:
    the harness itself reaches them through ``harness_path()``, a directory
    holding only ``bench``/``faults``, so the harness checkout's own
    ``cairn`` package never shadows the one under test."""
    global CAIRN_CHECKOUT, CAIRN_PY
    checkout = checkout or os.environ.get("BENCH_CAIRN") or None
    python = python or os.environ.get("BENCH_CAIRN_PYTHON") or None
    if checkout:
        CAIRN_CHECKOUT = Path(checkout).expanduser().resolve()
        if not (CAIRN_CHECKOUT / "cairn").is_dir():
            raise SystemExit(f"{CAIRN_CHECKOUT} is not a cairn checkout (no cairn/ package)")
        if not python:
            py = CAIRN_CHECKOUT / ".venv" / "bin" / "python"
            if not py.exists():
                r = subprocess.run(["uv", "sync", "--project", str(CAIRN_CHECKOUT), "--extra", "ui"])
                if r.returncode != 0:
                    subprocess.run(["uv", "sync", "--project", str(CAIRN_CHECKOUT)], check=True)
            python = str(py)
    if python:
        CAIRN_PY = python
    os.environ["BENCH_CAIRN_PYTHON"] = CAIRN_PY  # child orchestrators inherit the choice
    os.environ["BENCH_CAIRN"] = str(CAIRN_CHECKOUT)


def cairn_bin(name: str = "cairn") -> str:
    """A console script of the cairn under test (``cairn``)."""
    return str(Path(CAIRN_PY).parent / name)


def harness_path() -> Path:
    """A directory with only ``bench`` and ``faults`` (symlinks): the
    ``PYTHONPATH`` of every spawned process, so workers import the harness
    but the cairn installed in their own interpreter."""
    d = bench_root() / "harness-path"
    d.mkdir(parents=True, exist_ok=True)
    for pkg in ("bench", "faults"):
        link = d / pkg
        if link.is_symlink() and link.resolve() == (REPO_ROOT / pkg).resolve():
            continue
        if link.is_symlink() or link.exists():
            link.unlink()
        link.symlink_to(REPO_ROOT / pkg)
    return d


def cairn_site_packages() -> str:
    r = subprocess.run([CAIRN_PY, "-c", "import site; print(site.getsitepackages()[0])"],
                       capture_output=True, text=True, check=True)
    return r.stdout.strip()


def _venv_python(name: str, packages: list[str], env_var: str) -> str:
    """A venv under ``bench_root()`` with ``packages``, created with ``uv``
    the first time (or the interpreter named by ``env_var``)."""
    given = os.environ.get(env_var)
    if given:
        return given
    venv = bench_root() / name
    py = venv / "bin" / "python"
    marker = venv / ".bench-ok"
    if not marker.exists():
        if not py.exists():
            subprocess.run(["uv", "venv", "-q", str(venv), "--python", "3.13"], check=True)
        subprocess.run(["uv", "pip", "install", "-q", "--python", str(py), *packages], check=True)
        marker.write_text("ok")
    return str(py)


def mlflow_python() -> str:
    return _venv_python(
        "venv-mlflow", ["mlflow", "psutil", "httpx", "psycopg2-binary", "psycopg[binary]", "pillow", "numpy"],
        "BENCH_MLFLOW_PYTHON",
    )


def profiling_python() -> str:
    """An interpreter that sees cairn's environment plus ``yappi`` (a venv
    whose .pth adds cairn's site-packages as a site dir)."""
    py = _venv_python("venv-prof", ["yappi"], "BENCH_PROF_PYTHON")
    site = cairn_site_packages()  # the cairn under test's environment
    own = next((Path(py).parent.parent / "lib").glob("python3*/site-packages"))
    (own / "zz_cairn_base.pth").write_text(f"import site; site.addsitedir({str(site)!r})\n")
    return py


def playwright_python() -> str:
    py = _venv_python("venv-pw", ["playwright"], "BENCH_PLAYWRIGHT_PYTHON")
    browsers = bench_root() / "pw-browsers"
    if not (browsers / ".bench-ok").exists():
        subprocess.run([py, "-m", "playwright", "install", "chromium-headless-shell"],
                       check=True, env={**os.environ, "PLAYWRIGHT_BROWSERS_PATH": str(browsers)})
        (browsers / ".bench-ok").write_text("ok")
    return py


# ---------------------------------------------------------------- environment

def isolated_env(work: Path, **extra: str) -> dict[str, str]:
    """Environment for every spawned process: no user config, no browser."""
    env = {k: v for k, v in os.environ.items()
           if not k.startswith(("CAIRN_", "MLFLOW_", "VIRTUAL_ENV"))}
    home = bench_root() / "home"
    home.mkdir(exist_ok=True)
    work.mkdir(parents=True, exist_ok=True)
    env.update(
        HOME=str(home),
        BROWSER="true",
        CAIRN_CACHE_DIR=str(work / "cairn-cache"),
        CAIRN_WAL_DIR=str(work / "cairn-wal"),
        MLFLOW_DISABLE_AGENT_HINT="1",
        PYTHONPATH=str(harness_path()),
        CAIRN_AGENT_DIR=str(work / "cairn-agent"),
        CAIRN_DIR=str(work / "cairn-runs"),  # 0.6: run-owned dirs (default ./.cairn/runs)
        XDG_CONFIG_HOME=str(home / ".config"),
        XDG_STATE_HOME=str(home / ".local" / "state"),
        XDG_CACHE_HOME=str(home / ".cache"),
        XDG_DATA_HOME=str(home / ".local" / "share"),
        PYTHONUNBUFFERED="1",
        PLAYWRIGHT_BROWSERS_PATH=str(bench_root() / "pw-browsers"),
    )
    env.update(extra)
    return env


def free_port(lo: int = 4500, hi: int = 4599, avoid: set[int] | None = None) -> int:
    for port in range(lo, hi + 1):
        if avoid and port in avoid:
            continue
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError(f"no free port in {lo}-{hi}")


def wait_http(url: str, timeout: float = 60.0) -> float:
    """Wait until ``url`` answers 2xx; return seconds waited."""
    t0 = time.monotonic()
    while True:
        try:
            if httpx.get(url, timeout=2.0).status_code < 300:
                return time.monotonic() - t0
        except httpx.HTTPError:
            pass
        if time.monotonic() - t0 > timeout:
            raise TimeoutError(f"{url} did not come up in {timeout}s")
        time.sleep(0.05)


# ---------------------------------------------------------------- servers

@dataclass
class Server:
    """A system under test's server process."""

    kind: str  # "cairn" | "mlflow"
    url: str
    port: int
    proc: subprocess.Popen | None
    storage: Path
    cmd: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)
    log_path: Path | None = None
    health: str = ""

    @property
    def pid(self) -> int | None:
        return self.proc.pid if self.proc else None

    def start(self, timeout: float | None = None) -> float:
        # MLflow over Postgres runs its schema migrations at first start:
        # minutes through podman's VM network.
        timeout = timeout or (400.0 if "postgresql://" in " ".join(self.cmd) else 90.0)
        assert self.log_path is not None
        log = open(self.log_path, "ab")  # noqa: SIM115
        self.proc = subprocess.Popen(self.cmd, env=self.env, stdout=log, stderr=subprocess.STDOUT,
                                     start_new_session=True)
        return wait_http(self.url + self.health, timeout)

    def kill9(self) -> None:
        """SIGKILL the whole process group (uvicorn/gunicorn workers too)."""
        if self.proc is None:
            return
        try:
            os.killpg(self.proc.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            try:
                self.proc.kill()
            except ProcessLookupError:
                pass
        self.proc.wait()
        self.proc = None

    def stop(self) -> None:
        if self.proc is None:
            return
        try:
            os.killpg(self.proc.pid, signal.SIGTERM)
            self.proc.wait(timeout=20)
        except (ProcessLookupError, PermissionError, subprocess.TimeoutExpired):
            self.kill9()
        self.proc = None

    def rss(self) -> int:
        return tree_rss(self.proc.pid) if self.proc else 0


def cairn_server(repo: Path, work: Path, port: int | None = None, *, ui: bool = False) -> Server:
    """``cairn server`` (or ``cairn ui`` with ``ui=True``) over ``repo``, no auth."""
    port = port or free_port(4510, 4539)
    env = isolated_env(work)
    if ui:
        cmd = [cairn_bin(), "ui", "--repo", str(repo), "--port", str(port),
               "--no-auth", "--no-open-browser"]
    else:
        cmd = [cairn_bin(), "server", "--repo", str(repo), "--port", str(port),
               "--host", "127.0.0.1", "--no-auth"]
    s = Server("cairn", f"http://127.0.0.1:{port}", port, None, repo, cmd, env,
               work / f"cairn-server-{port}.log", "/api/health")
    return s


def mlflow_server(store: str, work: Path, port: int | None = None, *, workers: int | None = None) -> Server:
    """An MLflow tracking server. ``store``: ``sqlite`` or a postgres URI.
    Artifacts are proxied (``--serve-artifacts``, the default) into ``work``."""
    port = port or free_port(4540, 4569)
    py = mlflow_python()
    if store == "sqlite":
        uri = f"sqlite:///{work / 'mlflow.db'}"
        storage = work / "mlflow.db"
    else:
        uri = store
        storage = work
    art = work / "mlartifacts"
    cmd = [str(Path(py).parent / "mlflow"), "server", "--backend-store-uri", uri,
           "--artifacts-destination", str(art), "--host", "127.0.0.1", "--port", str(port)]
    if workers:
        cmd += ["--workers", str(workers)]
    env = isolated_env(work)
    return Server("mlflow", f"http://127.0.0.1:{port}", port, None, storage, cmd, env,
                  work / f"mlflow-server-{port}.log", "/health")


# ---------------------------------------------------------------- postgres (podman)

PG_PORT = 4590
PG_CONTAINER = "cairn-bench-pg"


class Postgres:
    """A throwaway Postgres in podman (``podman machine`` started if needed,
    stopped again by ``close`` when this started it)."""

    def __init__(self) -> None:
        self.started_machine = False
        self.ok = False
        self.note = ""

    def up(self) -> bool:
        if shutil.which("podman") is None:
            self.note = "podman not installed"
            return False
        try:
            info = subprocess.run(["podman", "machine", "list", "--format", "{{.Running}}"],
                                  capture_output=True, text=True, timeout=30)
            if "true" not in info.stdout:
                r = subprocess.run(["podman", "machine", "start"], capture_output=True, text=True, timeout=300)
                if r.returncode != 0:
                    self.note = f"podman machine start failed: {r.stderr[-300:]}"
                    return False
                self.started_machine = True
            subprocess.run(["podman", "rm", "-f", PG_CONTAINER], capture_output=True, timeout=60)
            r = subprocess.run(
                ["podman", "run", "-d", "--name", PG_CONTAINER, "-e", "POSTGRES_PASSWORD=bench",
                 "-e", "POSTGRES_USER=bench", "-p", f"127.0.0.1:{PG_PORT}:5432",
                 "docker.io/library/postgres:16-alpine"],
                capture_output=True, text=True, timeout=600)
            if r.returncode != 0:
                self.note = f"podman run failed: {r.stderr[-300:]}"
                return False
            for _ in range(120):
                r = subprocess.run(["podman", "exec", PG_CONTAINER, "pg_isready", "-U", "bench"],
                                   capture_output=True, timeout=30)
                if r.returncode == 0:
                    time.sleep(1.0)
                    self.ok = True
                    return True
                time.sleep(1.0)
            self.note = "postgres did not become ready"
        except (subprocess.SubprocessError, OSError) as exc:
            self.note = f"podman error: {exc}"
        return False

    def new_db(self, name: str, template: str | None = None) -> str:
        subprocess.run(["podman", "exec", PG_CONTAINER, "psql", "-U", "bench", "-c", f"DROP DATABASE IF EXISTS {name}"],
                       capture_output=True, timeout=60)
        tmpl = f" TEMPLATE {template}" if template else ""
        subprocess.run(["podman", "exec", PG_CONTAINER, "psql", "-U", "bench", "-c", f"CREATE DATABASE {name}{tmpl}"],
                       capture_output=True, timeout=60, check=True)
        return f"postgresql://bench:bench@127.0.0.1:{PG_PORT}/{name}"

    def db_size(self, name: str) -> int:
        r = subprocess.run(["podman", "exec", PG_CONTAINER, "psql", "-U", "bench", "-tAc",
                            f"SELECT pg_database_size('{name}')"], capture_output=True, text=True, timeout=60)
        return int(r.stdout.strip() or 0)

    def container_rss(self) -> int:
        r = subprocess.run(["podman", "stats", "--no-stream", "--format", "{{.MemUsage}}", PG_CONTAINER],
                           capture_output=True, text=True, timeout=60)
        txt = r.stdout.strip().split("/")[0].strip()
        units = {"kB": 1e3, "KB": 1e3, "MB": 1e6, "GB": 1e9, "MiB": 2**20, "GiB": 2**30, "KiB": 2**10, "B": 1}
        for u, mult in sorted(units.items(), key=lambda kv: -len(kv[0])):
            if txt.endswith(u):
                try:
                    return int(float(txt[: -len(u)]) * mult)
                except ValueError:
                    return 0
        return 0

    def close(self) -> None:
        subprocess.run(["podman", "rm", "-f", PG_CONTAINER], capture_output=True, timeout=120)
        if self.started_machine:
            subprocess.run(["podman", "machine", "stop"], capture_output=True, timeout=300)


# ---------------------------------------------------------------- measurement

def tree_rss(pid: int) -> int:
    """Resident memory of ``pid`` and its descendants, bytes."""
    try:
        p = psutil.Process(pid)
        procs = [p, *p.children(recursive=True)]
    except psutil.NoSuchProcess:
        return 0
    total = 0
    for q in procs:
        try:
            total += q.memory_info().rss
        except psutil.NoSuchProcess:
            pass
    return total


class RssSampler:
    """Samples a process tree's RSS every ``interval`` s; ``peak`` / ``last``."""

    def __init__(self, pid_fn, interval: float = 0.2) -> None:
        self._pid_fn = pid_fn
        self.interval = interval
        self.peak = 0
        self.last = 0
        self._stop = threading.Event()
        self._t = threading.Thread(target=self._run, daemon=True)

    def _run(self) -> None:
        while not self._stop.is_set():
            pid = self._pid_fn()
            if pid:
                self.last = tree_rss(pid)
                self.peak = max(self.peak, self.last)
            self._stop.wait(self.interval)

    def __enter__(self) -> "RssSampler":
        self._t.start()
        return self

    def __exit__(self, *exc: Any) -> None:
        self._stop.set()
        self._t.join()


def pct(values: list[float], q: float) -> float | None:
    if not values:
        return None
    v = sorted(values)
    k = (len(v) - 1) * q
    lo = int(k)
    hi = min(lo + 1, len(v) - 1)
    return v[lo] + (v[hi] - v[lo]) * (k - lo)


def summary_stats(values: list[float]) -> dict[str, Any]:
    return {"n": len(values), "p50": pct(values, 0.5), "p95": pct(values, 0.95),
            "max": max(values) if values else None, "mean": (sum(values) / len(values)) if values else None}


def dir_size(path: Path) -> int:
    if not path.exists():
        return 0
    if path.is_file():
        return path.stat().st_size
    total = 0
    for p in path.rglob("*"):
        try:
            if p.is_file() and not p.is_symlink():
                total += p.stat().st_size
        except OSError:
            pass
    return total


def machine_info() -> dict[str, Any]:
    def sysctl(name: str) -> str:
        try:
            return subprocess.run(["sysctl", "-n", name], capture_output=True, text=True).stdout.strip()
        except OSError:
            return ""

    disk = shutil.disk_usage(bench_root())
    return {
        "platform": platform.platform(),
        "cpu": sysctl("machdep.cpu.brand_string") or platform.processor(),
        "cpus": os.cpu_count(),
        "memory_gb": round(psutil.virtual_memory().total / 2**30, 1),
        "python": sys.version.split()[0],
        "disk_free_gb": round(disk.free / 2**30, 1),
        "bench_root": str(bench_root()),
        "cairn_checkout": str(CAIRN_CHECKOUT),
        "cairn_python": CAIRN_PY,
        "cairn_commit": _git(CAIRN_CHECKOUT, "rev-parse", "--short", "HEAD"),
        "cairn_branch": _git(CAIRN_CHECKOUT, "rev-parse", "--abbrev-ref", "HEAD"),
        "cairn_dirty": bool(_git(CAIRN_CHECKOUT, "status", "--porcelain", "--untracked-files=no", "--", "cairn")),
        "cairn_version": subprocess.run([CAIRN_PY, "-c", "import importlib.metadata as m; print(m.version('cairn-track'))"],
                                        capture_output=True, text=True).stdout.strip(),
        "harness_commit": _git(REPO_ROOT, "rev-parse", "--short", "HEAD"),
        "time": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True).stdout.strip()


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, default=str))


@contextmanager
def servers_stopped(*servers: Server) -> Iterator[None]:
    try:
        yield
    finally:
        for s in servers:
            try:
                s.stop()
            except Exception:  # noqa: BLE001
                pass


def work_cwd() -> Path:
    """The working directory of spawned processes: never a checkout (``-m``
    puts the cwd first on ``sys.path``, so a checkout's ``cairn/`` would
    shadow the cairn under test)."""
    d = bench_root() / "cwd"
    d.mkdir(parents=True, exist_ok=True)
    return d


def run_workers(argv_list: list[list[str]], env: dict[str, str], timeout: float,
                cwd: Path | None = None) -> list[dict[str, Any]]:
    """Start worker processes at once, wait, return each one's last JSON line."""
    cwd = cwd or work_cwd()
    procs = [subprocess.Popen(a, env=env, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
             for a in argv_list]
    out = []
    deadline = time.monotonic() + timeout
    for p in procs:
        try:
            so, se = p.communicate(timeout=max(1.0, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            p.kill()
            so, se = p.communicate()
        res = None
        for line in reversed(so.strip().splitlines()):
            if line.startswith("{"):
                try:
                    res = json.loads(line)
                    break
                except json.JSONDecodeError:
                    pass
        if res is None:
            res = {"error": f"worker exited {p.returncode}", "stderr": se[-2000:]}
        out.append(res)
    return out
