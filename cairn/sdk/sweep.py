"""Hyperparameter sweeps from Python — the in-process twin of ``cairn agent``.

```python
def train(config, run):
    for step in range(100):
        run.track(loss(config["lr"], step), name="loss", step=step)
    return final_loss            # optional: else the run's "loss" is read

sw = cairn.sweep(
    {"lr": {"min": 1e-4, "max": 1e-1, "distribution": "log_uniform"},
     "layers": {"values": [2, 4, 8]}},
    project="mnist", metric="loss", goal="minimize", method="bayes",
)
sw.run(train, count=20)
sw.best    # {"params": ..., "value": ..., "run_id": ...}
```

Both drive the same sweep routes (``sweep_ops``): claim a trial, open a run
in the sweep with the trial's params as config, report the outcome. The space
format is documented in ``cairn.server.sweep_ops``.
"""

from __future__ import annotations

import inspect
import logging
import multiprocessing
import numbers
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Any, Callable

from .connect import open_transport

log = logging.getLogger(__name__)


def sweep(
    space: dict[str, Any],
    *,
    project: str,
    metric: str | None = None,
    goal: str = "minimize",
    method: str = "random",
    name: str | None = None,
    command: str | list[str] | None = None,
    repo: str | Path | None = None,
) -> "Sweep":
    """Create a sweep over ``space``.

    Run it in process with ``Sweep.run``, or with ``cairn agent <id>`` on any
    number of machines when ``command`` is set.

    Example:
        ```python
        sw = cairn.sweep(
            {"lr": {"min": 1e-4, "max": 1e-1, "distribution": "log_uniform"},
             "layers": {"values": [2, 4, 8]}},
            project="mnist", metric="val.loss", goal="minimize", method="bayes",
        )
        sw.run(train, count=20)
        ```

    Args:
        space: The search space, one entry per parameter (the ``parameters``
            block of a wandb sweep): ``{"values": [...]}`` (categorical),
            ``{"min": a, "max": b}`` (uniform; integer bounds sample
            integers), ``{"min": a, "max": b, "distribution":
            "log_uniform"}``, ``{"value": v}`` or a bare value (constant).
        project: Project the trial runs are created in.
        metric: The metric a trial is scored by, when the trial function
            returns no number: its final value as the runs table shows it.
            Needed for ``best`` and for ``method="bayes"``.
        goal: ``"minimize"`` or ``"maximize"`` the metric.
        method: ``"grid"`` (every combination of the ``values`` lists, then
            the sweep finishes; ranges are an error), ``"random"`` (samples
            independently, forever) or ``"bayes"`` (Optuna's TPE sampler;
            needs the ``[sweep]`` extra).
        name: Display name of the sweep.
        command: The command ``cairn agent`` runs per trial, as a string or
            an argument list; the params are appended as ``--key=value``.
        repo: Where the sweep lives, resolved like ``cairn.Run(repo=...)``.

    Returns:
        A handle on the new sweep.

    Raises:
        ValueError: For an invalid space, method or goal.
    """
    transport, _ = open_transport(repo)
    try:
        info = transport.create_sweep({
            "project": project, "parameters": space, "method": method,
            "metric": metric, "goal": goal, "name": name, "command": command,
        })
    finally:
        transport.close()
    return Sweep(info["id"], project=project, repo=repo)


class Sweep:
    """A handle on a sweep, from ``cairn.sweep(...)`` or ``Sweep(id, project=...)``.

    Every property and method asks the server (or repo) afresh; the handle
    itself holds only the id.

    Args:
        sweep_id: The sweep's id (``cairn sweep ls`` lists them).
        project: The sweep's project. Looked up from the sweep when omitted.
        repo: Where the sweep lives, resolved like ``cairn.Run(repo=...)``.

    Attributes:
        id: The sweep's id.
    """

    def __init__(self, sweep_id: str, *, project: str | None = None, repo: str | Path | None = None):
        self.id = sweep_id
        self._repo = repo
        self._project = project

    def _call(self, method: str, *args: Any) -> Any:
        transport, _ = open_transport(self._repo)
        try:
            return getattr(transport, method)(*args)
        finally:
            transport.close()

    def info(self) -> dict[str, Any]:
        """The sweep, its counts, best trial and ``trials``."""
        return self._call("get_sweep", self.id)

    @property
    def trials(self) -> list[dict[str, Any]]:
        """Every trial so far, each with its params, status, value and run id."""
        return self.info()["trials"]

    @property
    def best(self) -> dict[str, Any] | None:
        """The best completed trial by the sweep's metric and goal."""
        return self.info()["best"]

    def pause(self) -> None:
        """Stop handing out new trials until ``resume``; running trials go on.
        ``cairn agent`` waits for the resume; ``Sweep.run`` returns."""
        self._call("sweep_action", self.id, "pause")

    def resume(self) -> None:
        """Hand out trials again after ``pause``."""
        self._call("sweep_action", self.id, "resume")

    def cancel(self) -> None:
        """End the sweep for good: no more trials are handed out."""
        self._call("sweep_action", self.id, "cancel")

    def run(
        self,
        fn: Callable[..., Any],
        *,
        count: int | None = None,
        workers: int = 1,
        **run_kwargs: Any,
    ) -> list[dict[str, Any]]:
        """Run up to ``count`` trials (all of a grid, or until the sweep is
        paused/cancelled when None) and return them as reported.

        ``fn(config)`` or ``fn(config, run)`` trains one trial; ``config`` is
        the trial's params (also recorded as the run's config). A number it
        returns is the trial's value; otherwise the value is the run's final
        ``metric`` value as the runs table shows it (last point, summary rule,
        explicit summary key). An exception fails the trial and the sweep
        moves on; ``KeyboardInterrupt`` marks the trial killed and propagates.

        Args:
            fn: The trial function.
            count: Maximum number of trials (split across workers). None runs
                until the sweep has no more trials.
            workers: Number of processes. Above 1, trials run in spawned
                processes (a process can hold only one active run), so ``fn``
                must be picklable (defined at module level).
            **run_kwargs: Passed to ``cairn.Run`` for every trial run. Each
                run is named after its trial (``<sweep>-<n>``) unless they
                give a ``name``.

        Returns:
            The trials this call ran, as reported to the sweep.
        """
        project = self._project or self.info()["project_id"]
        if workers <= 1:
            return _work(self.id, project, self._repo, fn, count, run_kwargs)
        counts = [None] * workers if count is None else [
            count // workers + (1 if i < count % workers else 0) for i in range(workers)
        ]
        ctx = multiprocessing.get_context("spawn")
        with ProcessPoolExecutor(max_workers=workers, mp_context=ctx) as pool:
            futures = [
                pool.submit(_work, self.id, project, self._repo, fn, n, run_kwargs)
                for n in counts if n != 0
            ]
            return [t for f in futures for t in f.result()]

    def __repr__(self) -> str:
        return f"Sweep({self.id!r})"


def _takes_run(fn: Callable[..., Any]) -> bool:
    try:
        params = [
            p for p in inspect.signature(fn).parameters.values()
            if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD, p.VAR_POSITIONAL)
        ]
    except (TypeError, ValueError):
        return True
    return len(params) >= 2 or any(p.kind is p.VAR_POSITIONAL for p in params)


def _work(
    sweep_id: str,
    project: str,
    repo: str | Path | None,
    fn: Callable[..., Any],
    count: int | None,
    run_kwargs: dict[str, Any],
) -> list[dict[str, Any]]:
    """One worker's loop: claim → run → report, ``count`` times at most."""
    from .run import Run

    transport, _ = open_transport(repo)
    done: list[dict[str, Any]] = []
    try:
        while count is None or len(done) < count:
            trial = transport.next_trial(sweep_id)["trial"]
            if trial is None:
                break
            params = trial["params"]
            run = Run(project, sweep_id=sweep_id, transport=transport, **{
                **run_kwargs, "name": run_kwargs.get("name") or trial["name"],
            })
            transport.report_trial(sweep_id, trial["id"], run_id=run.id, status="running")
            run.config(params)
            value = None
            try:
                result = fn(params, run) if _takes_run(fn) else fn(params)
            except KeyboardInterrupt:
                run.finish(status="killed")
                transport.report_trial(sweep_id, trial["id"], status="killed")
                raise
            except Exception:  # noqa: BLE001 - one failed trial doesn't end the sweep
                log.exception("sweep %s: trial %s failed", sweep_id, trial["id"])
                run.finish(status="failed")
                status = "failed"
            else:
                run.finish()
                status = "completed"
                if isinstance(result, numbers.Real) and not isinstance(result, bool):
                    value = float(result)
            done.append(transport.report_trial(sweep_id, trial["id"], status=status, value=value))
    finally:
        transport.close()
    return done
