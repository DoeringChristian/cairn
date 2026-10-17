"""A run's state rebuilt from its own records (resuming or forking a run
whose directory is on this machine needs no server)."""

from __future__ import annotations

from typing import Any

from .log import LogReader
from .rundir import RunDir


def replay(run_dir: RunDir, log_name: str | None = None) -> dict[str, Any]:
    """``{project_id, tags, config, summary, status, sequences}`` as the
    records of ``run_dir``'s log say (``sequences``: ``[{name, max_step}]``
    over every log of the directory, for the per-name step counters)."""
    from cairn.backend import config_doc

    state: dict[str, Any] = {
        "project_id": run_dir.meta().get("project_id"), "tags": [], "config": {},
        "summary": {}, "status": None, "stop_requested": None,
    }
    max_steps: dict[str, int] = {}
    for ref in run_dir.logs():
        mine = ref.key == (log_name or "main")
        reader = LogReader(ref.log_dir)
        after = 0
        while True:
            batch = reader.read(after)
            if not batch:
                break
            after = batch[-1]["seq"]
            for rec in batch:
                op = rec["op"]
                if op == "batch":
                    for p in rec.get("points") or []:
                        step = p.get("step")
                        if isinstance(step, int):
                            name = p.get("name")
                            max_steps[name] = max(max_steps.get(name, step), step)
                if not mine:
                    continue
                if op in ("create_run", "fork_run"):
                    state["project_id"] = rec.get("project_id") or state["project_id"]
                    state["tags"] = list(rec.get("tags") or [])
                    state["status"] = "running"
                elif op == "set_tags":
                    state["tags"] = list(rec.get("tags") or [])
                elif op == "params":
                    state["config"] = config_doc.merge(state["config"], rec.get("params") or {})
                elif op == "summary":
                    state["summary"] = config_doc.merge(state["summary"], rec.get("summary") or {})
                elif op == "finish":
                    state["status"] = rec.get("status")
                elif op in ("resume_run", "rewind_run"):
                    state["status"] = "running"
                    if op == "rewind_run":
                        k = rec.get("step")
                        max_steps = {n: min(s, k) for n, s in max_steps.items()
                                     if not n.startswith("system.")} | {
                            n: s for n, s in max_steps.items() if n.startswith("system.")}
    state["sequences"] = [{"name": n, "max_step": s} for n, s in max_steps.items()]
    return state
