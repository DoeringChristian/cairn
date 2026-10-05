"""The SDK ``Run`` class — the user-facing entry point.

Ties transport + buffer + handlers + capture modules together. One ``Run``
instance per experimental execution; lifecycle:

    with cairn.Run(project="...") as run:
        run.config(hparams={"lr": 3e-4})          # inputs
        for step, loss in ...:
            run.track(loss, name="loss", step=step)   # the series
        run.summary(best_loss=best)               # results you are claiming
"""

from __future__ import annotations

import atexit
import inspect
import json
import logging
import os
import secrets
import signal
import sys
import threading
import time
import _thread
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from .. import config
from ..sdk import handlers as _handlers_pkg  # noqa: F401  - register built-ins
from ..sdk.capture import stdout as stdout_capture
from ..sdk.capture.env import capture_env as _capture_env
from ..sdk.capture.git import capture_git, diff_text
from ..sdk.capture.source import build_source_archive, find_project_root
from ..sdk.capture.system import SystemMetricsCollector
from ..sdk.handlers.registry import HandlerRegistry, default_registry
from ..sdk.wrappers import _TypeWrapper
from ..server import artifact_registry_ops as _registry_rules
from ..server import config_doc
from .artifacts import Artifact, ArtifactVersion, draft_from_shorthand
from .buffer import MetricBuffer
from .connect import open_transport
from .gallery import GALLERY_MIME, GalleryItem, resolve_gallery
from .local import LocalTransport
from .scope import Scope
from .transport import Transport
from .uploads import upload_value
from .wal import WriteAheadLog
from .watch import Watcher

log = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Run:
    """A single experiment execution.

    Three ways to start one:

    * a new run (the default);
    * ``resume="<id>"`` continues an existing run under its own id: it is
      running again and keeps its history, name, tags and other creation
      metadata (the creation kwargs are ignored). ``rewind_to=k`` first drops
      everything the run recorded after step ``k``;
    * ``fork_from=("<id>", k)`` starts a NEW run holding a copy of that run's
      history up to step ``k`` (plus its config, summary and metric
      definitions), linked to it as its parent.

    For fork and rewind, "history up to step k" is every point with
    ``step <= k``, except ``system.*`` series (whose steps are sampler
    counters), which are cut at the time of the last kept point instead.

    ``mode="disabled"`` (or ``cairn.configure(mode=...)``, ``CAIRN_MODE``, the
    config file's ``mode`` key) returns a run whose every method is a no-op:
    no repo, no server, no threads. It is still a ``cairn.Run``.

    A run finishes when the ``with`` block exits (``completed``, ``failed`` on
    an exception, ``stopped`` after a stop request), when ``finish()`` is
    called, or at interpreter exit. SIGTERM/SIGINT finish it as ``killed``.

    Example:
        ```python
        with cairn.Run("mnist", name="baseline", tags=["cnn"]) as run:
            run.config(lr=1e-3, epochs=10)
            for step in range(1000):
                run.track(loss, "train.loss", step)
        ```

    Args:
        project: Project name. Normalised to an id (lowercase, spaces become
            dashes); created on first use.
        name: Display name. Default: none (the UI shows the id); a run
            launched by ``cairn agent`` takes its trial's name.
        tags: Initial tags. Edit later with ``set_tag``/``remove_tag``/``set_tags``.
        notes: Free-text notes shown on the run page.
        group: Group label for related runs (e.g. the workers of one
            distributed job); filterable and groupable in the runs table.
        job_type: Kind of job (e.g. ``"train"``, ``"eval"``); filterable and
            groupable like ``group``.
        sweep_id: Attach the run to this sweep. Set automatically, together
            with the trial, when the process runs under ``cairn agent``.
        parent_run_id: Record another run as this run's parent (lineage only;
            nothing is copied). ``fork_from`` sets it itself.
        fork_step: The parent step this run branched at (lineage only).
        created_at: Creation time to record instead of now (a ``datetime``
            or an ISO 8601 string), for importing past runs.
        resume: Id of an existing run to continue (see above).
        rewind_to: With ``resume``: drop everything recorded after this step
            first.
        fork_from: ``(run_id, step)``: start a new run holding a copy of
            that run's history up to ``step`` (see above).
        repo: Where to write: a ``.cairn/`` directory or a
            ``cairn://host:port`` server. Default: ``cairn.configure``,
            then ``CAIRN_REPO``, ``CAIRN_SERVER``, the config file, then
            ``./.cairn``. A local repo held by a running ``cairn server`` or
            ``cairn ui`` is written over HTTP to that server.
        local_wal: With a local repo: append to a per-run log file
            (``.cairn/wals/<run_id>.wal.jsonl``) instead of writing the
            database; a server or ``cairn.Reader`` on that repo ingests it.
            Use it for many concurrent writers on shared storage (NFS,
            Slurm, Ray).
        capture_source: Upload a snapshot of the project's source files
            (and, in a git checkout with uncommitted changes, the
            ``git diff HEAD``, stored with the snapshot).
        capture_stdout: Record stdout/stderr lines as the run's logs.
        capture_env: Record the environment: Python version, packages,
            hostname, user, command line, git commit/branch/remote.
        capture_system_metrics: Sample CPU, memory, disk and GPU usage as
            ``system.*`` series.
        system_metrics_interval: Seconds between system samples.
        system_metrics_include_per_core: Also record every CPU core.
        source_root: Root of the source snapshot. Default: the nearest
            ancestor of the working directory holding a project marker
            (``.git``, ``pyproject.toml``, ``pixi.toml``, ...).
        source_include: Glob patterns of files to snapshot, replacing the
            defaults (``*.py``, ``*.yaml``, ``*.toml``, ``*.json``, ...).
        source_exclude: Glob patterns to skip, replacing the defaults
            (``.git``, ``__pycache__``, ``.venv``, ``node_modules``, ...).
            ``.gitignore`` is always honoured.
        source_max_file_size_mb: Skip source files larger than this.
        timeout: HTTP request timeout in seconds, also the time ``finish()``
            waits for each buffer to drain.
        registry: Handler registry deciding how values are stored. Default:
            the global one (see ``cairn.register_handler``).
        transport: A ready transport to write through instead of resolving
            ``repo`` (mainly for tests); the caller keeps ownership.
        mode: ``"disabled"`` makes every method a no-op (see above).
        on_stop: Callback ``fn(run)`` run when a stop is requested; more can
            be added with ``on_stop``.
        stop_mode: What a stop request (the UI's Stop button) does after the
            callbacks: ``"interrupt"`` (default) raises ``KeyboardInterrupt``
            in the main thread and the run finishes as ``stopped``;
            ``"flag"`` only sets ``should_stop`` for the training loop to poll.

    Raises:
        ValueError: For an unknown ``stop_mode``, ``rewind_to`` without
            ``resume``, both ``resume`` and ``fork_from``, or ``fork_from``
            together with ``parent_run_id``/``fork_step``.
    """

    def __new__(cls, *args: Any, mode: str | None = None, **kwargs: Any) -> Run:
        if cls is Run and config.resolve_mode(mode) == "disabled":
            return object.__new__(_DisabledRun)
        return object.__new__(cls)

    def __init__(
        self,
        project: str,
        *,
        name: str | None = None,
        tags: list[str] | None = None,
        notes: str | None = None,
        group: str | None = None,
        job_type: str | None = None,
        sweep_id: str | None = None,
        parent_run_id: str | None = None,
        fork_step: int | None = None,
        created_at: str | datetime | None = None,
        resume: str | None = None,
        rewind_to: int | None = None,
        fork_from: tuple[str, int] | None = None,
        repo: str | Path | None = None,
        local_wal: bool = False,
        capture_source: bool = True,
        capture_stdout: bool = True,
        capture_env: bool = True,
        capture_system_metrics: bool = True,
        system_metrics_interval: float = 10.0,
        system_metrics_include_per_core: bool = False,
        source_root: str | Path | None = None,
        source_include: list[str] | None = None,
        source_exclude: list[str] | None = None,
        source_max_file_size_mb: float = 1.0,
        timeout: float = 10.0,
        registry: HandlerRegistry | None = None,
        transport: Transport | LocalTransport | None = None,
        mode: str | None = None,
        on_stop: Callable[["Run"], Any] | None = None,
        stop_mode: str = "interrupt",
    ):
        if stop_mode not in ("interrupt", "flag"):
            raise ValueError(f"stop_mode must be 'interrupt' or 'flag', not {stop_mode!r}")
        if rewind_to is not None and resume is None:
            raise ValueError("rewind_to needs resume=<run id>")
        if resume is not None and fork_from is not None:
            raise ValueError("pass resume or fork_from, not both")
        if fork_from is not None and (parent_run_id is not None or fork_step is not None):
            raise ValueError("fork_from sets parent_run_id and fork_step itself")
        self._registry = registry or default_registry
        # Stop requests (from the UI) arrive on the heartbeat.
        self._stop_requested = False
        self._stop_mode = stop_mode
        self._on_stop: list[Callable[["Run"], Any]] = [on_stop] if on_stop else []
        self._wal: WriteAheadLog | None = None
        if transport is not None:
            self._transport = transport
            self._owns_transport = False
            self._server = getattr(transport, "server_url", "")
        else:
            self._transport, self._server = open_transport(
                repo, local_wal=local_wal, timeout=timeout,
            )
            self._owns_transport = True
        self._project = project
        self._name = name
        # Launched by `cairn agent`: join its sweep and take the trial's params.
        trial_id = None
        if sweep_id is None and os.environ.get("CAIRN_SWEEP_ID"):
            sweep_id = os.environ["CAIRN_SWEEP_ID"]
            trial_id = os.environ.get("CAIRN_TRIAL_ID") or None
        self._timeout = timeout
        # The run's tag list, kept client-side: the ``set_tags`` op replaces
        # the whole list, and WAL-mode LocalTransport has no DB to read it back.
        self._tags: list[str] = list(tags or [])

        # Bookkeeping
        self._finished = False
        self._step_counters: dict[str, int] = {}
        # name -> (summary, x): the rule last sent per metric, so a rule
        # passed to every track() call reaches the server once.
        self._metric_rules: dict[str, tuple[str | None, str | None]] = {}
        self._step_lock = threading.Lock()
        self._line_counter = 0
        self._line_lock = threading.Lock()
        # The highest explicit step tracked so far; run.watch histograms use it.
        self._last_step: int | None = None
        self._watchers: list[Watcher] = []

        # Env + git captured synchronously so we can send them on create.
        env_snapshot: dict[str, Any] | None = _capture_env() if capture_env else None
        git_info = capture_git(Path.cwd()) if capture_source or capture_env else None

        # Generate ID client-side (128-bit, collision-proof).
        client_run_id = secrets.token_hex(16)

        create_body: dict[str, Any] = {
            "project": project,
            "run_id": client_run_id,
            "name": name,
            "tags": tags,
            "notes": notes,
            "env": env_snapshot,
            "git": (
                {
                    "sha": git_info["sha"],
                    "branch": git_info["branch"],
                    "dirty": git_info["dirty"],
                    "remote": git_info["remote"],
                }
                if git_info
                else None
            ),
            "cli_args": env_snapshot["cli_args"] if env_snapshot else None,
            "hostname": env_snapshot["hostname"] if env_snapshot else None,
            "user": env_snapshot["user"] if env_snapshot else None,
            "group": group,
            "job_type": job_type,
            "sweep_id": sweep_id,
            "parent_run_id": parent_run_id,
            "fork_step": fork_step,
            "created_at": (
                created_at.isoformat() if isinstance(created_at, datetime) else created_at
            ),
        }
        if resume is not None:
            resp = (
                self._transport.rewind_run(resume, int(rewind_to))
                if rewind_to is not None
                else self._transport.resume_run(resume)
            )
            self._tags = list(resp.get("tags") or [])
            self._seed_step_counters(resume)
        elif fork_from is not None:
            parent_id, step = fork_from
            resp = self._transport.fork_run(parent_id, client_run_id, int(step), create_body)
            # The copied system.* rows carry the parent's sampler counters.
            self._seed_step_counters(parent_id)
        else:
            resp = self._transport.create_run(create_body)
        self._run_id: str = resp["run_id"]
        self._project_id: str = resp["project_id"]
        # This run's copy of its config / summary documents, so a write that
        # the merge rules reject raises here, on both backends.
        self._docs: dict[str, dict[str, Any]] = {
            "config": dict(resp.get("config") or {}),
            "summary": dict(resp.get("summary") or {}),
        }
        self._backend_cache: Any = None
        self._url_path: str = resp.get("url", f"/p/{self._project_id}/r/{self._run_id}")

        # Attach WAL for HTTP transports (local mode writes the repo-dir WAL itself).
        if isinstance(self._transport, Transport):
            try:
                self._wal = WriteAheadLog(self._run_id, target=self._server)
                self._transport._wal = self._wal
            except OSError:
                log.warning("failed to create WAL for run %s", self._run_id, exc_info=True)

        # Guard against nested runs.
        stdout_capture.set_active_run(self._run_id)

        # Metric + log buffers.
        # Over HTTP with a WAL, a backlog the server cannot take right now is
        # spilled to the WAL and replayed by ``catch_up``: memory stays
        # bounded and track() never waits on the network.
        wal_backed = isinstance(self._transport, Transport) and self._wal is not None
        self._metric_buffer = MetricBuffer(
            flush_fn=lambda batch: self._transport.post_batch(self._run_id, batch),
            flush_interval=0.5,
            max_rows=1000,
            spill_fn=(
                (lambda batch: self._transport.defer_batch(self._run_id, batch))
                if wal_backed else None
            ),
            idle_fn=self._transport.catch_up if wal_backed else None,
        )
        self._log_buffer = MetricBuffer(
            flush_fn=self._flush_logs,
            flush_interval=0.5,
            max_rows=500,
        )

        # Stdout capture — tee sends lines into the log buffer.
        self._stdout_capture: stdout_capture.StdoutCapture | None = None
        if capture_stdout:
            self._stdout_capture = stdout_capture.StdoutCapture(
                on_line=self._on_captured_line
            )
            self._stdout_capture.start()

        # System metrics collector.
        self._sys_collector: SystemMetricsCollector | None = None
        if capture_system_metrics:
            self._sys_collector = SystemMetricsCollector(
                track=lambda n, v: self._track_sample(n, v),
                interval=system_metrics_interval,
                include_per_core=system_metrics_include_per_core,
            )
            self._sys_collector.start()

        # Source archive upload — do in a background thread so __init__ is fast.
        if capture_source:
            self._source_thread = threading.Thread(
                target=self._capture_source,
                kwargs={
                    "root_override": source_root,
                    "include": tuple(source_include) if source_include else None,
                    "exclude": tuple(source_exclude) if source_exclude else None,
                    "max_file_size_mb": source_max_file_size_mb,
                    "diff": diff_text(git_info) if git_info else "",
                },
                daemon=True,
                name="cairn-source-upload",
            )
            self._source_thread.start()
        else:
            self._source_thread = None

        # Register an atexit hook so users don't have to call ``finish()``
        # explicitly — matches Aim's ergonomics. If ``finish()`` is called
        # explicitly (directly or via the context-manager __exit__), it
        # unregisters the hook so a second Run in the same process doesn't
        # double-clean.
        atexit.register(self._atexit_finish)

        # Heartbeat — periodically update last_heartbeat so the server can
        # detect crashed runs. Runs on a daemon thread, stops on finish().
        self._heartbeat_stop = threading.Event()
        self._heartbeat_thread = threading.Thread(
            target=self._heartbeat_loop,
            daemon=True,
            name="cairn-heartbeat",
        )
        self._heartbeat_thread.start()

        # Signal handlers — finish run as "killed" on SIGTERM/SIGINT.
        self._prev_sigterm = signal.getsignal(signal.SIGTERM)
        self._prev_sigint = signal.getsignal(signal.SIGINT)

        def _on_signal(signum: int, frame: Any) -> None:
            if not self._finished:
                try:
                    self.finish(status="stopped" if self._stop_requested else "killed")
                except Exception:  # noqa: BLE001
                    pass
            # Re-raise to previous handler.
            prev = self._prev_sigterm if signum == signal.SIGTERM else self._prev_sigint
            if callable(prev):
                prev(signum, frame)
            elif prev == signal.SIG_DFL:
                signal.signal(signum, signal.SIG_DFL)
                signal.raise_signal(signum)

        # Only install from the main thread (signal module requirement).
        if threading.current_thread() is threading.main_thread():
            try:
                signal.signal(signal.SIGTERM, _on_signal)
                signal.signal(signal.SIGINT, _on_signal)
            except (OSError, ValueError):
                pass  # Not all environments allow signal registration.

        # Detect unhandled exceptions so the atexit cleanup can mark the
        # run as "failed" rather than the default "completed". Chains the
        # previous excepthook so the user still sees the traceback.
        self._unhandled_exception_type: type[BaseException] | None = None
        self._prev_excepthook = sys.excepthook

        def _excepthook(exc_type: type[BaseException], exc: BaseException, tb: Any) -> None:
            if not self._finished:
                self._unhandled_exception_type = exc_type
            try:
                self._prev_excepthook(exc_type, exc, tb)
            except Exception:  # noqa: BLE001
                pass

        try:
            sys.excepthook = _excepthook
        except Exception:  # noqa: BLE001
            self._prev_excepthook = None  # type: ignore[assignment]

        if trial_id:
            self._join_trial(sweep_id, trial_id)

    def _join_trial(self, sweep_id: str, trial_id: str) -> None:
        """Link this run to its sweep trial and record the trial's params as
        config. An unnamed run takes the trial's name (``<sweep>-<n>``)."""
        try:
            trial = self._transport.report_trial(
                sweep_id, trial_id, run_id=self._run_id, status="running",
            )
            if self._name is None and trial.get("name"):
                self._transport.rename_run(self._run_id, trial["name"])
                self._name = trial["name"]
        except Exception:
            self.finish(status="failed")
            raise
        if trial.get("params"):
            # Sweep parameters are dotted names ("optim.lr"): nest them like
            # hand-written config.
            self.config(config_doc.unflatten(trial["params"]))

    # ---- properties -------------------------------------------------------

    @property
    def id(self) -> str:
        """The run's id: 32 hex characters, generated client-side."""
        return self._run_id

    @property
    def url(self) -> str:
        """The run's page: the server URL (``file://<repo>`` for a local
        repo) followed by ``/p/<project>/r/<id>``."""
        return f"{self._server.rstrip('/')}{self._url_path}"

    @property
    def should_stop(self) -> bool:
        """True once someone asked this run to stop (e.g. the UI's Stop button)."""
        return self._stop_requested

    def on_stop(self, fn: Callable[["Run"], Any]) -> Callable[["Run"], Any]:
        """Register ``fn(run)`` to be called when a stop is requested.

        Usable as a decorator. Callbacks run on the heartbeat thread, before
        the main thread is interrupted (unless ``stop_mode="flag"``)."""
        self._on_stop.append(fn)
        return fn

    # ---- tracking ---------------------------------------------------------

    def scope(self, *, step: int) -> "Scope":
        """A ``Scope`` with ``step`` bound.

        The SECONDARY entry point. `Run` is already the root scope, so
        ``run.track(model, "model", step=it)`` walks a component tree on its own;
        this exists for the case recursion cannot reach — handing a pre-bound
        logger to a plain function that is not a component:

        ```python
        evaluate(model, run.scope(step=it))
        ```
        """
        if self._finished:
            raise RuntimeError("Run has already been finished")
        return Scope(self, "", step=step)

    def track(
        self,
        value: Any,
        name: str,
        step: int,
        *,
        summary: str | None = None,
        x: str | None = None,
        **kwargs: Any,
    ) -> None:
        """Record ``value`` in the named sequence at ``step``.

        Two keywords say how a SCALAR metric is read (a ``ValueError`` for any
        other value):

        - ``summary`` — ``"min"``, ``"max"``, ``"mean"`` or ``"last"`` (the
          default): the metric's final value in the runs table, overviews,
          comparison colours, ``Reader.Run.final`` and the ``metrics``
          filters (``metrics__<name>`` in ``RunQuery.filter``,
          ``metrics.<name>`` in query URLs). ``"min"`` also
          means lower is better when comparing runs. An explicit
          ``summary`` key of the same name still wins.
        - ``x`` — the FULL name of another scalar series (``x="epoch"``,
          never prefixed by a scope): charts of this metric start on that
          x-axis, joining the two series on step.

        ``run.track(acc, "val.acc", step, summary="max", x="epoch")``. The rule
        is sent only when it changes, so passing it on every call is free; a
        keyword you pass replaces that part of the rule, and one you leave
        out keeps its earlier value.

        ``step`` is REQUIRED. It used to default to a per-name
        auto-increment, which is coherent for one sequence and silently wrong
        across a component tree: a member recorded on only some iterations would
        keep counting from zero and its points would claim iterations that were
        not theirs. The iteration is now named exactly once, here — and every
        ``__cairn_track__`` below inherits it.

        A list (or tuple) of media of one kind is a GALLERY: one point whose
        items the kind's card shows side by side. The items are wrappers of
        one type or raw values each detected as that type (Plotly/matplotlib
        figures); each is stored as its own artifact, keywords apply to every
        item, and ``caption=`` labels the point while each wrapper keeps its
        own caption::

            run.track([cairn.Figure(f, caption=f"head {i}") for i, f in enumerate(figs)],
                      "attention", step, caption="all heads")

        Items of different kinds raise ``ValueError``; a list of raw numbers
        or strings stays unsupported (``TypeError``; wrap strings in
        ``cairn.Text``), and a list of raw frames is one video. See
        ``cairn.sdk.gallery`` for the stored manifest.

        If ``value`` implements ``__cairn_track__`` this walks the component tree
        instead of recording a leaf, threading this ``name`` down as the prefix.
        ``None`` is a silent skip.
        """
        if self._finished:
            raise RuntimeError("Run has already been finished")
        if value is None:
            return
        if hasattr(value, "__cairn_track__"):
            Scope(self, "", step=step).track(value, name, summary=summary, x=x, **kwargs)
            return
        self._track_leaf(value, name, step=step, summary=summary, x=x, **kwargs)

    def _track_sample(self, name: str, value: Any) -> None:
        """Record a TIMER-SAMPLED point, numbering it with the per-name counter.

        The one legitimate stepless caller is the system-metrics collector: its
        samples are taken on a wall-clock interval, not per training iteration,
        so there is no step to supply and a per-name counter is exactly right.
        Kept off the public API so the counter cannot silently renumber a tree.
        """
        self._track_leaf(value, name, step=None)

    def _track_leaf(
        self,
        value: Any,
        name: str,
        *,
        step: int | None,
        summary: str | None = None,
        x: str | None = None,
        **kwargs: Any,
    ) -> None:
        """Record ONE point — no protocol dispatch. ``step=None`` auto-increments
        (see ``_track_sample``; never reachable from the public API).
        ``summary`` / ``x`` set the metric's rule (see ``track``)."""
        if self._finished:
            raise RuntimeError("Run has already been finished")
        has_rule = summary is not None or x is not None
        if summary is not None and summary not in SUMMARY_KINDS:
            raise ValueError(
                f"summary must be one of {', '.join(map(repr, SUMMARY_KINDS))}, "
                f"got {summary!r}"
            )

        gallery = resolve_gallery(self._registry, value)
        if gallery is not None:
            object_type, items = gallery
            if has_rule:
                raise ValueError(_rule_on_non_scalar(name, f"{object_type} gallery"))
            self._track_gallery(object_type, items, name, step=step, **kwargs)
            return

        # Unwrap explicit type wrappers.
        wrapper_kwargs: dict[str, Any] = {}
        if isinstance(value, _TypeWrapper):
            wrapper_kwargs = value.kwargs
            payload = value.obj
            object_type = value.object_type
            handler = self._registry.find_by_type(object_type)
        else:
            payload = value
            handler = self._registry.find_handler(value)
            object_type = handler.object_type if handler else None

        if handler is None:
            raise TypeError(
                f"No handler for value of type {type(value).__name__}; "
                "wrap with cairn.Image/Figure/Tensor/... to force a handler."
            )
        if has_rule:
            if object_type != "scalar":
                raise ValueError(_rule_on_non_scalar(name, object_type))
            self._set_metric_rule(name, summary, x)

        effective_step = self._next_step(name, step)
        if step is not None:
            self._last_step = step if self._last_step is None else max(self._last_step, step)
        merged_kwargs = {**wrapper_kwargs, **kwargs}
        # A caption belongs to the point, not the artifact: identical bytes
        # logged twice share one artifact row but keep their own captions.
        caption = merged_kwargs.pop("caption", None)

        point: dict[str, Any] = {
            "name": name,
            "step": effective_step,
            "wall_time": _now_iso(),
            "object_type": object_type,
        }
        if caption is not None:
            point["metadata"] = {"caption": str(caption)}

        if object_type == "scalar":
            # Fast path — scalar handler has a cheap to_scalar method.
            point["scalar_value"] = handler.to_scalar(payload)  # type: ignore[attr-defined]
        else:
            digest, _mime, _meta = self._upload_value(handler, payload, merged_kwargs)
            point["artifact_hash"] = digest

        self._metric_buffer.append(point)

    def _set_metric_rule(self, name: str, summary: str | None, x: str | None) -> None:
        """Send ``name``'s rule unless nothing in it changed. A keyword left
        out keeps its earlier value (here and on the server), so
        ``summary="min"`` then ``x="epoch"`` gives both."""
        old_summary, old_x = self._metric_rules.get(name, (None, None))
        rule = (summary if summary is not None else old_summary, x if x is not None else old_x)
        if self._metric_rules.get(name) == rule:
            return
        self._transport.set_metric_rule(self._run_id, name, x, summary)
        self._metric_rules[name] = rule

    def _upload_value(self, handler: Any, payload: Any, kwargs: dict[str, Any]) -> tuple[str, str, dict[str, Any]]:
        """Serialize one media value and upload it (``uploads.upload_value``).
        Returns its ``(hash, mime_type, metadata)``."""
        digest, mime, meta, _size = upload_value(self._transport, self._registry, handler, payload, kwargs)
        return digest, mime, meta

    def _track_gallery(
        self,
        object_type: str,
        items: list[GalleryItem],
        name: str,
        *,
        step: int | None,
        **kwargs: Any,
    ) -> None:
        """Record several media values of one kind as ONE point: each is its
        own artifact, and the point's artifact is a manifest listing them
        (``GALLERY_MIME``, see ``cairn.sdk.gallery``). Keywords apply to every
        item under the item's own; ``caption`` labels the point."""
        kwargs = dict(kwargs)
        caption = kwargs.pop("caption", None)
        entries: list[dict[str, Any]] = []
        for item in items:
            merged = {**item.kwargs, **kwargs}
            item_caption = merged.pop("caption", None)
            digest, mime, meta = self._upload_value(item.handler, item.payload, merged)
            entry: dict[str, Any] = {"hash": digest, "mime_type": mime, "metadata": meta}
            if item_caption is not None:
                entry["caption"] = str(item_caption)
            entries.append(entry)
        manifest = json.dumps({"items": entries}).encode()
        meta: dict[str, Any] = {"gallery": len(entries)}
        preview = entries[0]["metadata"].get("preview")
        if preview is not None:
            meta["preview"] = preview
        digest = self._transport.upload_artifact(manifest, GALLERY_MIME, meta, object_type=object_type)
        if step is not None:
            self._last_step = step if self._last_step is None else max(self._last_step, step)
        point: dict[str, Any] = {
            "name": name,
            "step": self._next_step(name, step),
            "wall_time": _now_iso(),
            "object_type": object_type,
            "artifact_hash": digest,
        }
        if caption is not None:
            point["metadata"] = {"caption": str(caption)}
        self._metric_buffer.append(point)

    def log_artifact(
        self,
        artifact: Artifact | str | Path | Any,
        name: str | None = None,
        *,
        type: str = "artifact",
        aliases: list[str] | None = None,
        tags: list[str] | None = None,
        step: int | None = None,
        metadata: dict | None = None,
        description: str | None = None,
    ) -> ArtifactVersion:
        """Log a new version of an artifact, produced by this run.

        ``artifact`` is a ``cairn.Artifact`` draft (its name, type, metadata
        and description are used; passing ``name``/``type``/``metadata``/
        ``description`` too is a ``TypeError``), or a shorthand needing
        ``name``: a directory path (every file under it), a file path (stored
        at its basename), or any other value (stored at ``"<name>.<ext>"``:
        wrappers with their handler, bytes as is, anything else pickled).

            run.log_artifact(model.state_dict(), "ckpt", type="model", step=epoch,
                             aliases=["best"] if improved else None)

        Every call creates a new version, even for identical content.
        ``latest`` always moves to it; ``aliases`` (user aliases) move to it
        too. ``tags`` are added to the version (beside a draft's own).
        ``step`` places it on the run's timeline.

        Returns:
            The new ``ArtifactVersion``. In WAL mode a PENDING one (version
            None; readable once the repo has ingested it).

        Raises:
            TypeError: A draft together with name/type/metadata/description,
                or a shorthand without a name.
            FileNotFoundError: A shorthand path that does not exist.
            ValueError: A reserved alias (``latest``, ``vN``), a bad name, or
                a type differing from the artifact's existing type.
        """
        if self._finished:
            raise RuntimeError("Run has already been finished")
        draft = self._draft(artifact, name, type, metadata, description)
        return self._log_draft(draft, aliases, step, created_by_run=self._run_id, tags=tags)

    def _draft(
        self, artifact: Any, name: str | None, type: str, metadata: dict | None,
        description: str | None,
    ) -> Artifact:
        if isinstance(artifact, Artifact):
            extra = [k for k, v in (("name", name), ("metadata", metadata),
                                    ("description", description)) if v is not None]
            if type != "artifact":
                extra.append("type")
            if extra:
                raise TypeError(
                    f"log_artifact got a cairn.Artifact and {', '.join(extra)}; set those on "
                    "the Artifact instead"
                )
            return artifact
        draft = draft_from_shorthand(artifact, name, type, self._registry)
        draft.metadata = dict(metadata or {})
        draft.description = description
        return draft

    def _log_draft(
        self, draft: Artifact, aliases: list[str] | None, step: int | None,
        *, created_by_run: str | None, tags: list[str] | None = None,
    ) -> ArtifactVersion:
        return log_draft(
            self._transport, self._registry, self._project_id, draft, aliases, step,
            created_by_run=created_by_run, backend=self._reader_backend, tags=tags,
        )

    def _reader_backend(self) -> Any:
        """The Reader backend over this run's target (ArtifactVersion reads)."""
        if getattr(self, "_backend_cache", None) is None:
            self._backend_cache = backend_for_transport(self._transport)
        return self._backend_cache

    def use_artifact(self, ref: str | ArtifactVersion, *, role: str = "input") -> ArtifactVersion:
        """Consume an artifact version: resolve it now and record it as an
        input of this run (re-using the same version is a no-op).

        ``ref`` is ``"name"`` (= ``name:latest``), ``"name:alias"``,
        ``"name:vN"``, ``"project/name:..."`` for another project, or an
        ``ArtifactVersion``. The resolved immutable version is recorded, not
        the alias.

            ckpt = run.use_artifact("base-ckpt:best")
            model.load_state_dict(ckpt.get())

        Returns:
            The ``ArtifactVersion`` (``.get()`` for a logged object,
            ``.download()`` for files).

        Raises:
            LookupError: No such artifact, alias or version.
            RuntimeError: In WAL mode (it needs an answer now).
        """
        if self._finished:
            raise RuntimeError("Run has already been finished")
        if isinstance(ref, ArtifactVersion):
            if ref.pending:
                raise RuntimeError("cannot use a pending (WAL-mode) artifact version")
            ref = ref.qualified_ref
        info = self._transport.resolve_artifact(self._project_id, ref)
        self._transport.record_artifact_input(self._run_id, info["id"], role)
        return ArtifactVersion(info, self._reader_backend)

    # ---- params / metadata ------------------------------------------------

    def _merge_mapping(self, who: str, args: tuple, kwargs: dict) -> dict[str, Any]:
        """Mappings and/or kwargs into one dict, later keys winning."""
        merged: dict[str, Any] = {}
        for a in args:
            if not isinstance(a, dict):
                raise TypeError(f"{who}() positional args must be mappings")
            merged.update(a)
        merged.update(kwargs)
        return merged

    def _merge_doc(self, kind: str, update: dict[str, Any]) -> dict[str, Any]:
        """Validate ``update`` and merge it into this run's copy of the
        document, raising before anything is sent (see ``config_doc``)."""
        update = config_doc.normalize(update)
        merged = config_doc.merge(self._docs[kind], update)
        config_doc.nodes(merged)  # raises ValueError on a flat-key collision
        self._docs[kind] = merged
        return update

    def config(self, *args: Any, **kwargs: Any) -> None:
        """Record the run's INPUTS — what was decided before the work ran.

        Accepts a mapping and/or kwargs, DEEP-MERGED into the run's config
        document: a dict into a dict recurses; anything else replaces (a value
        over a dict drops that subtree; lists are replaced whole). ``None`` is
        a value. The document reads back exactly (``Reader.Run.config``); its
        leaves are also addressable by dotted path (``optim.lr``) in filters,
        expressions and the runs table.

            run.config(lr=1e-3, sched={"warmup": 100})
            run.config(vars(args))

        The counterpart is ``summary``, for results.

        Raises:
            TypeError: A value is not JSON (dict with str keys, list, str,
                int, float, bool, None; tuples become lists, numpy scalars
                Python scalars). The message names the key path.
            ValueError: Two paths flatten to the same dotted key
                (``{"a.b": 1}`` next to ``{"a": {"b": 2}}``).
        """
        if self._finished:
            raise RuntimeError("Run has already been finished")
        merged = self._merge_mapping("run.config", args, kwargs)
        if merged:
            self._transport.post_params(self._run_id, self._merge_doc("config", merged))

    def summary(self, *args: Any, **kwargs: Any) -> None:
        """Record the run's RESULTS — the numbers you are claiming.

            run.summary(best_val_acc=0.91, epochs_run=30)
            run.summary({"test": {"psnr": 31.4}})      # summary["test"]["psnr"]

        Same shape and merge rules as ``config``, opposite meaning: config is
        what went in, summary is what came out. Nothing writes here
        implicitly — a metric's last value is NOT a summary entry. A metric's
        final value (the runs table, ``Reader.Run.final``) is its last point,
        replaced by its ``track(..., summary=)`` rule, replaced by an explicit
        summary key of the same dotted name — so a number appears here only
        because you said so, and "who claimed this" stays answerable.
        """
        if self._finished:
            raise RuntimeError("Run has already been finished")
        merged = self._merge_mapping("run.summary", args, kwargs)
        if merged:
            self._transport.post_summary(self._run_id, self._merge_doc("summary", merged))

    def set_tag(self, tag: str) -> None:
        """Add one tag, keeping the ones the run already has."""
        if tag not in self._tags:
            self._tags.append(tag)
        self._transport.set_tags(self._run_id, list(self._tags))

    def remove_tag(self, tag: str) -> None:
        """Remove one tag; a tag the run doesn't have is ignored."""
        self._tags = [t for t in self._tags if t != tag]
        self._transport.set_tags(self._run_id, list(self._tags))

    def set_tags(self, tags: list[str]) -> None:
        """Replace the run's tags."""
        self._tags = list(tags)
        self._transport.set_tags(self._run_id, list(self._tags))

    def add_note(self, text: str) -> None:
        """Set the run's notes, replacing any notes it already has.

        Args:
            text: The new notes (plain text; shown on the run page).
        """
        self._transport.set_notes(self._run_id, text)

    # ---- model watching ---------------------------------------------------

    def watch(self, model: Any, log: str = "gradients", every: int = 100, bins: int = 64) -> None:
        """Record histograms of a torch module's gradients and/or parameters.

        Every ``every``-th forward pass of ``model`` records ``gradients/<param>``
        (from that pass's backward), ``parameters/<param>``, or both
        (``log="gradients"|"parameters"|"all"``), at the last step you tracked:

        ```python
        run.watch(model, log="all", every=100)
        ```

        ``unwatch`` (or ``finish``) removes the hooks.
        """
        if self._finished:
            raise RuntimeError("Run has already been finished")
        self._watchers.append(Watcher(self, model, log=log, every=every, bins=bins))

    def unwatch(self, model: Any | None = None) -> None:
        """Stop watching ``model`` (every watched model when None), recording
        the histograms already taken."""
        keep = []
        for w in self._watchers:
            if model is None or w.model is model:
                w.close()
            else:
                keep.append(w)
        self._watchers = keep

    def alert(self, title: str, text: str = "", level: str = "info") -> None:
        """Raise an alert: shown in the UI (project bell, run-page banner) and
        posted to the server's webhook (``cairn server --alert-webhook``).

        ``level`` is ``"info"``, ``"warn"`` or ``"error"``."""
        if level not in ("info", "warn", "error"):
            raise ValueError(f"alert level must be 'info', 'warn' or 'error', not {level!r}")
        self._transport.alert(self._run_id, {
            "alert_id": secrets.token_hex(16),
            "title": title,
            "text": text,
            "level": level,
            "created_at": _now_iso(),
        })

    # ---- finish -----------------------------------------------------------

    def finish(self, status: str = "completed", exit_code: int | None = None) -> None:
        """End the run: flush everything it buffered and record its status.

        Stops model watching, system-metric sampling and stdout capture,
        drains the metric and log buffers, waits (up to two minutes) for the
        source snapshot upload, then marks the run finished. Calling it again
        does nothing, and no method that records data works afterwards.

        Usually not called directly: leaving a ``with cairn.Run(...)`` block
        or the interpreter exiting finishes the run.

        Args:
            status: Final status: ``"completed"``, ``"failed"``,
                ``"killed"`` or ``"stopped"``.
            exit_code: Optional process exit code to record.
        """
        if self._finished:
            return
        try:
            # Watch histograms go through _track_leaf, which refuses once
            # finished: drain them before the metric buffer stops.
            self.unwatch()
            if self._sys_collector is not None:
                self._sys_collector.stop()
                self._sys_collector.join(timeout=5)
            if self._stdout_capture is not None:
                self._stdout_capture.stop()
            # Drain both buffers before posting finish.
            self._heartbeat_stop.set()
            self._metric_buffer.stop(timeout=self._timeout)
            self._log_buffer.stop(timeout=self._timeout)
            # Wait for source upload to finish before closing the transport/DB.
            # Large projects can take a while to archive + upload.
            if self._source_thread is not None and self._source_thread.is_alive():
                self._source_thread.join(timeout=120)
            if self._wal is not None and isinstance(self._transport, Transport):
                # Everything pending replays in order, ending with the finish
                # itself, for at most ``timeout`` seconds: a slow or dead
                # server leaves the rest in the WAL for ``cairn sync``.
                delivered = self._transport.finish_run(
                    self._run_id, status, exit_code,
                    deadline=time.monotonic() + self._timeout,
                )
                try:
                    if delivered and not self._wal.has_pending:
                        self._wal.cleanup()
                    else:
                        log.warning(
                            "cairn: run %s finished, but some of its data has not reached "
                            "%s yet; it is kept in %s. Run `cairn sync` to send it.",
                            self._run_id, self._server, self._wal.wal_dir,
                        )
                        self._wal.close()
                except Exception:  # noqa: BLE001
                    log.warning("WAL cleanup failed", exc_info=True)
            else:
                try:
                    self._transport.drain_spill(self._run_id)
                except Exception:  # noqa: BLE001
                    log.warning("drain_spill failed during finish", exc_info=True)
                self._transport.finish_run(self._run_id, status, exit_code)
        finally:
            self._finished = True
            stdout_capture.clear_active_run(self._run_id)
            # Restore original signal handlers.
            if threading.current_thread() is threading.main_thread():
                try:
                    signal.signal(signal.SIGTERM, self._prev_sigterm)
                    signal.signal(signal.SIGINT, self._prev_sigint)
                except (OSError, ValueError):
                    pass
            # Restore original excepthook (only if we still own it).
            if self._prev_excepthook is not None:
                try:
                    sys.excepthook = self._prev_excepthook
                except Exception:  # noqa: BLE001
                    pass
            if self._owns_transport:
                # Ensure source thread is done before closing the DB.
                if self._source_thread is not None and self._source_thread.is_alive():
                    log.warning("source upload still running after timeout; waiting before closing DB")
                    self._source_thread.join(timeout=30)
                self._transport.close()
            # Don't fire the atexit hook now that we've finished explicitly.
            try:
                atexit.unregister(self._atexit_finish)
            except Exception:  # noqa: BLE001 - defensive; unregister is cheap
                pass

    #: Seconds between heartbeats (also how quickly a stop request is seen).
    _HEARTBEAT_INTERVAL = 10.0

    def _heartbeat_loop(self) -> None:
        """Periodically send heartbeat to the server/DB."""
        while not self._heartbeat_stop.wait(self._HEARTBEAT_INTERVAL):
            if self._finished:
                return
            try:
                stop_requested = self._transport.heartbeat(self._run_id)
            except Exception:  # noqa: BLE001
                continue  # Best effort — don't crash the heartbeat thread.
            if stop_requested and not self._stop_requested:
                self._handle_stop_request()

    def _handle_stop_request(self) -> None:
        self._stop_requested = True
        for fn in list(self._on_stop):
            try:
                fn(self)
            except Exception:  # noqa: BLE001
                log.warning("on_stop callback failed", exc_info=True)
        if self._stop_mode == "interrupt" and not self._finished:
            # Raises KeyboardInterrupt in the main thread (through our SIGINT
            # handler when installed); every exit path maps it to "stopped".
            _thread.interrupt_main()

    def _atexit_finish(self) -> None:
        """Fallback cleanup if ``finish()`` was never called explicitly.

        Registered in ``__init__``; removed in ``finish()``. Swallows errors
        because the interpreter is shutting down and reraising would just
        produce noise in an unrecoverable state.

        If an unhandled exception killed the script (caught via our custom
        ``sys.excepthook``), marks the run as ``"failed"`` instead of the
        default ``"completed"``. ``KeyboardInterrupt`` is excluded because
        the SIGINT signal handler already marks the run as ``"killed"``.
        """
        if self._finished:
            return
        status = "completed"
        exc_type = self._unhandled_exception_type
        if self._stop_requested:
            status = "stopped"
        elif exc_type is not None and not issubclass(exc_type, KeyboardInterrupt):
            status = "failed"
        try:
            self.finish(status=status)
        except Exception:  # noqa: BLE001
            log.warning("atexit finish failed", exc_info=True)

    # ---- context manager --------------------------------------------------

    def __enter__(self) -> Run:
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if self._stop_requested:
            self.finish("stopped")
        elif exc_type is None:
            self.finish("completed")
        else:
            self.finish("failed", exit_code=1)

    # ---- internals --------------------------------------------------------

    def _seed_step_counters(self, run_id: str) -> None:
        """Continue the per-name counters past ``run_id``'s recorded steps.

        Only timer-sampled ``system.*`` points use the counters; without the
        seed a resumed or forked run's samples would restart at step 0 and be
        dropped as duplicates of the ones already stored.
        """
        for s in self._transport.sequence_steps(run_id):
            name = s["name"]
            self._step_counters[name] = max(self._step_counters.get(name, 0), s["max_step"] + 1)

    def _next_step(self, name: str, explicit: int | None) -> int:
        with self._step_lock:
            if explicit is not None:
                self._step_counters[name] = explicit + 1
                return explicit
            cur = self._step_counters.get(name, 0)
            self._step_counters[name] = cur + 1
            return cur

    def _on_captured_line(self, event: dict[str, Any]) -> None:
        with self._line_lock:
            self._line_counter += 1
            event["line_no"] = self._line_counter
        self._log_buffer.append(event)

    def _flush_logs(self, batch: list[dict[str, Any]]) -> bool:
        return self._transport.post_logs(self._run_id, batch)

    def _capture_source(
        self,
        *,
        root_override: str | Path | None,
        include: tuple[str, ...] | None,
        exclude: tuple[str, ...] | None,
        max_file_size_mb: float,
        diff: str = "",
    ) -> None:
        try:
            if root_override is not None:
                root = Path(root_override).resolve()
                marker = None
            else:
                root, marker = find_project_root(Path.cwd())
            from .capture.source import DEFAULT_EXCLUDE, DEFAULT_INCLUDE

            archive, manifest = build_source_archive(
                root,
                include=include or DEFAULT_INCLUDE,
                exclude=exclude or DEFAULT_EXCLUDE,
                max_file_size_mb=max_file_size_mb,
                marker=marker,
            )
            if diff:
                # The dirty-tree diff travels with the snapshot: its blob's
                # hash is in the manifest (the UI downloads it from there).
                manifest["diff_hash"] = self._transport.upload_artifact(
                    diff.encode("utf-8"), "text/x-diff", {},
                )
            self._transport.upload_source(self._run_id, archive, manifest)
        except Exception:  # noqa: BLE001
            log.warning("source capture failed", exc_info=True)


SUMMARY_KINDS = ("min", "max", "mean", "last")


def _rule_on_non_scalar(name: str, kind: str | None) -> str:
    return (
        f"cairn: summary= and x= apply to scalar metrics only; {name!r} is "
        f"a {kind} value"
    )


class _DisabledRun(Run):
    """What ``cairn.Run`` returns in disabled mode: every method is a no-op.

    ``scope()`` still hands out a real ``Scope``, which walks components
    into these no-ops.
    """

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self._run_id = secrets.token_hex(16)
        self._project = kwargs.get("project", args[0] if args else None)
        self._tags = list(kwargs.get("tags") or [])
        self._finished = False
        self._stop_requested = False

    @property
    def url(self) -> None:  # type: ignore[override]
        return None

    def track(self, *args: Any, **kwargs: Any) -> None:
        pass

    def _track_leaf(self, *args: Any, **kwargs: Any) -> None:
        pass

    def _track_sample(self, *args: Any, **kwargs: Any) -> None:
        pass

    def _merge_mapping(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        return {}

    def config(self, *args: Any, **kwargs: Any) -> None:
        pass

    def summary(self, *args: Any, **kwargs: Any) -> None:
        pass

    def log_artifact(self, *args: Any, **kwargs: Any) -> None:  # type: ignore[override]
        pass

    def use_artifact(self, *args: Any, **kwargs: Any) -> None:  # type: ignore[override]
        pass

    def set_tag(self, *args: Any, **kwargs: Any) -> None:
        pass

    def set_tags(self, *args: Any, **kwargs: Any) -> None:
        pass

    def remove_tag(self, *args: Any, **kwargs: Any) -> None:
        pass

    def add_note(self, *args: Any, **kwargs: Any) -> None:
        pass

    def alert(self, *args: Any, **kwargs: Any) -> None:
        pass

    def watch(self, *args: Any, **kwargs: Any) -> None:
        pass

    def unwatch(self, *args: Any, **kwargs: Any) -> None:
        pass

    def on_stop(self, fn: Callable[["Run"], Any]) -> Callable[["Run"], Any]:
        return fn

    def finish(self, *args: Any, **kwargs: Any) -> None:
        self._finished = True


def log_draft(
    transport: Any, registry: HandlerRegistry, project_id: str, draft: Artifact,
    aliases: list[str] | None, step: int | None, *, created_by_run: str | None,
    backend: Any, tags: list[str] | None = None,
) -> ArtifactVersion:
    """Upload a draft's entries and manifest, then register the version
    (shared by ``Run.log_artifact`` and ``cairn.log_artifact``)."""
    for alias in aliases or []:
        _registry_rules.validate_user_alias(alias)
    all_tags = _registry_rules.validate_tags([*draft.tags, *(tags or [])])
    if step is not None and (isinstance(step, bool) or not isinstance(step, int)):
        raise TypeError(f"step must be an int, got {step!r}")
    digest, _files = draft._build_manifest(transport, registry)
    body = {
        "name": draft.name,
        "type": draft.type,
        "digest": digest,
        "description": draft.description,
        "metadata": config_doc.normalize(draft.metadata),
        "step": step,
        "created_by_run": created_by_run,
        "aliases": list(dict.fromkeys(aliases or [])),
        "tags": all_tags,
        # Client-generated: a WAL replay of the op stays one version.
        "version_id": secrets.token_hex(8),
    }
    info = transport.create_artifact_version(project_id, body)
    if info is None:  # WAL mode: registered when the repo ingests the log
        info = {
            "id": body["version_id"], "name": draft.name, "type": draft.type,
            "project_id": project_id, "version": None, "aliases": [], "tags": all_tags,
            "metadata": body["metadata"], "description": draft.description,
            "digest": digest, "step": step, "created_by_run": created_by_run,
        }
    return ArtifactVersion(info, backend)


def backend_for_transport(transport: Any) -> Any:
    """A Reader backend over the same target as a writer transport."""
    from .reader import _HttpBackend, _LocalBackend

    if isinstance(transport, LocalTransport):
        return _LocalBackend(transport.data_dir.root)
    return _HttpBackend(transport.server_url, token=getattr(transport, "token", None))


def configure(**kwargs: Any) -> None:
    """Module-level configuration forwarder."""
    config.configure(**kwargs)
