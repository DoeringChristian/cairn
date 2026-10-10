"""The systems under test, stood up fresh per measurement.

``system(backend, work)`` yields a ``System``: where workers log
(``target``), with which interpreter, where to read back (``read_url`` /
``read_kind``), the server processes to sample, and how to measure storage.

Backends:
  cairn-local    the run writes its own log in the repo (``LocalTransport``);
                 a ``cairn server`` on the repo ingests every 2 s and serves reads
  cairn-http     the run logs to a ``cairn server`` over HTTP (``cairn://``)
  mlflow-sqlite  ``mlflow server`` with a SQLite backend store, proxied artifacts
  mlflow-sqlite-async  same server; the client logs with ``synchronous=False``
  mlflow-postgres      ``mlflow server`` over Postgres 16 (podman)
"""

from __future__ import annotations

import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator

import httpx

from . import common as c

BACKENDS = ["cairn-local", "cairn-http", "mlflow-sqlite", "mlflow-sqlite-async", "mlflow-postgres"]

_PG: c.Postgres | None = None


def postgres() -> c.Postgres | None:
    """The shared Postgres (started on first use); None when unavailable."""
    global _PG
    if _PG is None:
        _PG = c.Postgres()
        _PG.up()
    return _PG if _PG.ok else None


def close_postgres() -> None:
    global _PG
    if _PG is not None:
        _PG.close()
        _PG = None


@dataclass
class System:
    backend: str
    work: Path
    server: c.Server
    target: str
    python: str
    read_url: str
    read_kind: str  # cairn | mlflow
    extra: dict[str, Any] = field(default_factory=dict)
    pg_db: str | None = None

    def worker_args(self, **kw: Any) -> dict[str, Any]:
        be = "mlflow" if self.backend.startswith("mlflow") else self.backend
        a = {"backend": be, "target": self.target, **kw}
        if self.backend == "mlflow-sqlite-async":
            a["mlflow_async"] = True
        return a

    def server_rss(self) -> int:
        return self.server.rss()

    def storage(self) -> dict[str, int]:
        """Bytes on disk, by part (call with the server stopped for cairn/SQLite
        so the SQLite WAL is checkpointed)."""
        if self.read_kind == "cairn":
            repo = self.server.storage
            db = sum(c.dir_size(p) for p in repo.glob("cairn.db*")) if any(repo.glob("cairn.db*")) else 0
            if not db:
                db = sum(c.dir_size(p) for p in repo.glob("*.db*"))
            return {"db": db, "blobs": c.dir_size(repo / "artifacts"), "logs": c.dir_size(repo / "wals"),
                    "total": c.dir_size(repo)}
        if self.pg_db:
            pg = postgres()
            return {"db": pg.db_size(self.pg_db) if pg else 0, "blobs": c.dir_size(self.work / "mlartifacts"),
                    "total": (pg.db_size(self.pg_db) if pg else 0) + c.dir_size(self.work / "mlartifacts")}
        db = sum(c.dir_size(p) for p in self.work.glob("mlflow.db*"))
        return {"db": db, "blobs": c.dir_size(self.work / "mlartifacts"), "total": db + c.dir_size(self.work / "mlartifacts")}


def make_system(backend: str, work: Path, *, ui: bool = False) -> System:
    work.mkdir(parents=True, exist_ok=True)
    if backend.startswith("cairn"):
        repo = work / "repo"
        srv = c.cairn_server(repo, work, ui=ui)
        target = str(repo) if backend == "cairn-local" else srv.url.replace("http://", "cairn://")
        return System(backend, work, srv, target, c.CAIRN_PY, srv.url, "cairn")
    if backend == "mlflow-postgres":
        pg = postgres()
        if pg is None:
            raise RuntimeError("postgres unavailable: " + (_PG.note if _PG else ""))
        name = "b" + work.name.replace("-", "_").lower()[:40]
        uri = pg.new_db(name)
        srv = c.mlflow_server(uri, work)
        return System(backend, work, srv, srv.url, c.mlflow_python(), srv.url, "mlflow", pg_db=name)
    srv = c.mlflow_server("sqlite", work)
    return System(backend, work, srv, srv.url, c.mlflow_python(), srv.url, "mlflow")


@contextmanager
def system(backend: str, work: Path, *, ui: bool = False) -> Iterator[System]:
    s = make_system(backend, work, ui=ui)
    s.extra["startup_s"] = s.server.start()
    try:
        yield s
    finally:
        s.server.stop()


# ---------------------------------------------------------------- read helpers

def cairn_counts(url: str, project: str) -> tuple[int, dict[str, int]]:
    """(total scalar points, {run_id: points}) of a project, from metric stats."""
    r = httpx.get(f"{url}/api/runs", params={"project": project, "include": "stats", "limit": 1000,
                                               "archived": "all"}, timeout=120)
    if r.status_code != 200:
        return 0, {}
    per = {}
    for run in r.json()["runs"]:
        per[run["id"]] = sum(int(s.get("count") or 0) for n, s in (run.get("stats") or {}).items()
                             if n != "t_log")
    return sum(per.values()), per


def mlflow_history_len(url: str, run_id: str, key: str) -> int:
    n, token = 0, None
    while True:
        params: dict[str, Any] = {"run_id": run_id, "metric_key": key, "max_results": 25000}
        if token:
            params["page_token"] = token
        r = httpx.get(f"{url}/api/2.0/mlflow/metrics/get-history", params=params, timeout=120)
        if r.status_code != 200:
            return n
        body = r.json()
        n += len(body.get("metrics", []))
        token = body.get("next_page_token")
        if not token:
            return n


def wait_visible(sysm: System, project: str, runs: list[dict[str, Any]], timeout: float = 900.0) -> float | None:
    """Seconds until every point the workers logged is readable through the
    API (None on timeout). cairn: metric_stats counts; MLflow: the m0
    history of every run (scaled by its metric count)."""
    t0 = time.monotonic()
    want = sum(int(r.get("points") or 0) for r in runs)
    while time.monotonic() - t0 < timeout:
        if sysm.read_kind == "cairn":
            total, _ = cairn_counts(sysm.read_url, project)
            if total >= want:
                return time.monotonic() - t0
        else:
            ok = True
            for r in runs:
                if not r.get("run_id"):
                    continue
                steps = int(r.get("last_step", -1)) + 1 - int(r.get("start_step", 0))
                if mlflow_history_len(sysm.read_url, r["run_id"], "m0") < steps:
                    ok = False
                    break
            if ok:
                return time.monotonic() - t0
        time.sleep(0.1)
    return None
