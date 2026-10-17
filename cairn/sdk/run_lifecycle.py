"""Run lifecycle and process ownership."""
from __future__ import annotations
import logging

import atexit
import os
import secrets
import signal
import sys
import threading
import time
import _thread
from datetime import datetime
from pathlib import Path
from typing import Any, Callable
from ..sdk.capture import stdout as stdout_capture
from ..sdk.capture.env import capture_env as _capture_env
from ..sdk.capture.git import capture_git, diff_text
from ..sdk.capture.source import build_source_archive, find_project_root
from ..sdk.capture.system import SystemMetricsCollector
from ..sdk.handlers.registry import HandlerRegistry, default_registry
from cairn.backend import config_doc
from cairn.backend import progress as _progress_rules
from cairn.backend import ingest_ops
from .run_ids import check_run_id, new_run_id
from .runlog.log import LogLocked
from .runlog.rundir import MAIN as MAIN_LOG
from .runlog.rundir import RunDir
from .runlog.server import ServerReads, ServerUnavailable, run_state
from .runlog.writer import RunWriter, finish_timeout
from .watch import Watcher
from .run_support import _now_iso, _resolve_endpoint_target, _sdk_version, _resolve_process, _used_run_id, _repo_ref

log = logging.getLogger(__name__)


class RunLifecycle:
    """Own run creation, process attachment, durable finish, capture and stop handling.

    Coordinates RunLogging and RunArtifacts through their explicit initialization
    hooks. The shared Run object still owns the journal writer and lifecycle flags."""

    JOIN_WAIT = 120.0
    _VERSION_WAIT = 5.0
    _HEARTBEAT_INTERVAL = 10.0

    def __init__(
        self,
        project: str | None = None,
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
        run_id: str | None = None,
        label: str | None = None,
        primary: bool | None = None,
        repo: str | Path | None = None,
        server: str | None = None,
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
        mode: str | None = None,
        on_stop: Callable[["Run"], Any] | None = None,
        stop_mode: str = "interrupt",
        total_steps: int | None = None,
        uses: list[Any] | None = None,
    ):
        used_ids = [_used_run_id(u) for u in (uses or [])]
        if stop_mode not in ("interrupt", "flag"):
            raise ValueError(f"stop_mode must be 'interrupt' or 'flag', not {stop_mode!r}")
        if rewind_to is not None and resume is None:
            raise ValueError("rewind_to needs resume=<run id>")
        if resume is not None and fork_from is not None:
            raise ValueError("pass resume or fork_from, not both")
        if fork_from is not None and (parent_run_id is not None or fork_step is not None):
            raise ValueError("fork_from sets parent_run_id and fork_step itself")
        label, primary, given_id = _resolve_process(label, primary, run_id, resume)
        if not primary and (resume is not None or fork_from is not None):
            raise ValueError("a worker (primary=False) joins a run: it cannot resume or fork one")
        if primary and project is None:
            raise TypeError("cairn.Run() needs a project")
        if not primary and label == MAIN_LOG:
            raise ValueError(f"the label {MAIN_LOG!r} is reserved (it names the primary's log)")
        _progress_rules.check_total_steps(total_steps)
        self._label = label
        self._primary = primary
        self._registry = registry or default_registry
        # Stop requests (from the UI) arrive on the heartbeat.
        self._stop_requested = False
        self._stop_mode = stop_mode
        self._on_stop: list[Callable[["Run"], Any]] = [on_stop] if on_stop else []
        self._page_url: str | None = None
        # Select one authority: direct local ingestion or an explicit remote
        # server. Both consume the same durable per-run journal protocol.
        self._ep_server, self._ep_repo = _resolve_endpoint_target(repo, server)
        self._reads = ServerReads(self._ep_server, self._ep_repo, timeout=timeout)
        self._server = self._ep_server or f"file://{self._ep_repo}"
        self._project = project
        self._name = name
        # A resumed run keeps its name (and version) from before.
        self._resumed = resume is not None
        # Launched by `cairn agent`: join its sweep and take the trial's params.
        trial_id = None
        if primary and sweep_id is None and os.environ.get("CAIRN_SWEEP_ID"):
            sweep_id = os.environ["CAIRN_SWEEP_ID"]
            trial_id = os.environ.get("CAIRN_TRIAL_ID") or None
        self._timeout = timeout
        # The run's tag list, kept client-side: the ``set_tags`` op replaces
        # the whole list.
        self._tags: list[str] = list(tags or [])

        # Bookkeeping
        self._init_artifact_state()
        self._finished = False
        self._writer: RunWriter | None = None
        self._init_logging_state()

        # Env + git captured synchronously so they go in the creation record. A
        # worker creates nothing, and the run's source snapshot is its
        # primary's.
        if not primary:
            capture_env = capture_source = False
        env_snapshot: dict[str, Any] | None = _capture_env() if capture_env else None
        git_info = capture_git(Path.cwd()) if capture_source or capture_env else None

        # Generate ID client-side (128-bit, collision-proof).
        client_run_id = given_id or new_run_id()

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
        # Every way to start writes this process's log of the run directory
        # ($CAIRN_DIR/runs/<id>/). The state needed here comes from that
        # directory's records when it is on this machine, else from the server.
        catalogue: list[dict[str, Any]] = []
        state: dict[str, Any]
        if not primary:
            self._run_id = client_run_id
            self._run_dir = RunDir.for_run(client_run_id, Path(self._ep_repo) if self._ep_repo else None)
            state = self._join_state(client_run_id, project)
            self._open_writer(label, project_id=state["project_id"], remote=False)
            self._writer.join(label)
            catalogue = state.get("sequences") or []
        elif resume is not None:
            check_run_id(resume)
            self._run_id = resume
            self._run_dir = RunDir.for_run(resume, Path(self._ep_repo) if self._ep_repo else None)
            state = self._reopen_state(resume)
            self._open_writer(None, project_id=state["project_id"], remote=state["remote"])
            if rewind_to is not None:
                self._writer.rewind_run(int(rewind_to))
            else:
                self._writer.resume_run()
            catalogue = state.get("sequences") or []
        elif fork_from is not None:
            parent_id, step = fork_from
            check_run_id(parent_id)
            parent = self._reopen_state(parent_id)
            self._run_id = client_run_id
            self._run_dir = RunDir.for_run(client_run_id, Path(self._ep_repo) if self._ep_repo else None)
            self._claim_new_dir()
            state = {**parent, "tags": list(tags or []), "version": None, "stop_requested": None}
            self._open_writer(None, project_id=parent["project_id"], remote=False)
            fields = {
                k: create_body.get(k) for k in ingest_ops.CREATE_RUN_FIELDS
                if k not in ("run_id", "parent_run_id", "fork_step")
            }
            self._writer.fork_run({
                **fields, "parent_id": parent_id, "new_id": client_run_id, "step": int(step),
            })
            # The copied system.* rows carry the parent's sampler counters.
            catalogue = parent.get("sequences") or []
        else:
            self._run_id = client_run_id
            self._run_dir = RunDir.for_run(client_run_id, Path(self._ep_repo) if self._ep_repo else None)
            self._claim_new_dir()
            project_id = ingest_ops.slugify(project)
            state = {"project_id": project_id}
            self._open_writer(None, project_id=project_id, remote=False)
            fields = {k: create_body.get(k) for k in ingest_ops.CREATE_RUN_FIELDS}
            self._writer.create_run({
                **fields, "project": project, "project_id": project_id,
                "created_at": fields["created_at"] or _now_iso(),
            })
        if primary and self._ep_repo is not None:
            # Local init establishes the run before workers can read/join it.
            self._writer.flush()
            from ..uploader.local import recover_journals
            local = self._writer._local_client
            recover_journals(local.dd, local.db, local.blobs, run_dir=self._run_dir)
        if not primary or resume is not None:
            self._tags = list(state.get("tags") or [])
        self._project_id: str = state["project_id"]
        self._restore_history_state(catalogue)
        # The server assigns the version: known here only when it answered
        # (``version`` asks it on first use otherwise).
        self._version_info: dict[str, Any] | None = (
            {"version": state["version"]} if state.get("version") is not None else None
        )
        self._restore_document_state(state, catalogue)
        self._url_path: str = f"/p/{self._project_id}/r/{self._run_id}"
        # A run that had ended when this worker joined keeps the stop request
        # it ended with: that one is not for this process.
        self._stale_stop: str | None = (
            state.get("stop_requested")
            if not primary and state.get("status") not in (None, "running", "crashed")
            else None
        )
        self._start_uploader()

        if total_steps is not None:
            self.total_steps = total_steps

        # Only stdout capture requires a single owner in this process.
        if capture_stdout:
            stdout_capture.set_active_run(self._run_id)

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
            prefix = "system." if label is None else f"system.{label}."
            self._sys_collector = SystemMetricsCollector(
                # system.<label>.*: each process's own series.
                track=lambda n, v: self._track_sample(
                    prefix + n.removeprefix("system."), v,
                ),
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
        # explicitly. If ``finish()`` is called (directly or via the
        # context-manager __exit__), it unregisters the hook so a second Run in
        # the same process doesn't double-clean.
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
            self._join_trial(sweep_id, trial_id)  # primary only (see above)

        if used_ids:
            try:
                for used in used_ids:
                    self.use_run(used)
            except Exception:
                self.finish(status="failed")
                raise


    def _claim_new_dir(self) -> None:
        """A new run's directory must not exist yet."""
        # (A worker sharing the directory may have made it first: only the
        # primary's log says the run exists.)
        if (self._run_dir.path / "log").exists():
            raise ingest_ops.RunExists(
                f"a run with id {self._run_id} exists already ({self._run_dir.path})"
            )


    def _open_writer(self, label: str | None, *, project_id: str, remote: bool) -> None:
        """Open this process's log of the run directory (``log/`` for the
        primary, ``procs/<label>/`` for a worker), writing ``run.json`` if
        missing.

        A log continues in place when its directory is here. A NEW log of a
        run whose logs may exist elsewhere gets a fresh name on the server
        (``main.<hex>`` / ``<label>.<hex>``), so its seqs never collide with
        records the server applied already: a resume of a run that is not on
        this machine (``remote``), a worker whose run's primary log is not
        here either."""
        key = None if self._primary else label
        fresh_primary = self._primary and not (self._run_dir.path / "log").exists()
        primary_here = (self._run_dir.path / "log").exists()
        if fresh_primary or not self._run_dir.exists():
            meta: dict[str, Any] = {
                "run_id": self._run_id, "project": self._project, "project_id": project_id,
                "endpoint": self._ep_server or "local", "repo": self._ep_repo,
                "created_at": _now_iso(), "sdk_version": _sdk_version(),
            }
            token = os.environ.get("CAIRN_TOKEN") if self._ep_server else None
            if token:
                # The uploader may run with another environment.
                meta["token"] = token
            self._run_dir.write_meta(meta)
        ref = self._run_dir.log(key)
        name = None
        if not ref.log_dir.exists():
            if self._primary and remote:
                name = f"{MAIN_LOG}.{secrets.token_hex(3)}"
            elif not self._primary and not primary_here:
                name = f"{label}.{secrets.token_hex(3)}"
        try:
            self._writer = RunWriter(self._run_dir, self._run_id, key, log_name=name, local_repo=self._ep_repo)
        except LogLocked:
            what = f"label {label!r}" if key else "the run"
            raise ValueError(
                f"{what} is in use by another live process of run {self._run_id}"
            ) from None


    def _reopen_state(self, run_id: str) -> dict[str, Any]:
        """A run to resume or fork from: its state from its directory on this
        machine, else from the server (``remote``: True).

        Raises:
            LookupError: Neither has the run.
            ServerUnavailable: Not on this machine, and the server is down.
        """
        from .runlog.state import replay

        rd = RunDir.for_run(run_id, Path(self._ep_repo) if self._ep_repo else None)
        if rd.exists():
            return {**replay(rd), "remote": False, "version": None}
        body = self._reads.run(run_id)
        if body is None:
            raise LookupError(f"run {run_id} not found")
        state = run_state(body)
        state["sequences"] = self._reads.sequences(run_id)
        state["remote"] = True
        return state


    def _join_state(self, run_id: str, project: str | None) -> dict[str, Any]:
        """A worker's view of its run: from the server when it is up, else
        from the run directory on this machine (a primary next to it).
        Without ``project``, waits up to ``JOIN_WAIT`` s for one of them to
        name it.

        Raises:
            ValueError: ``project`` is not the run's project.
            LookupError: The project could not be found out in time.
        """
        from .runlog.state import replay

        deadline = time.monotonic() + self.JOIN_WAIT
        while True:
            state: dict[str, Any] | None = None
            t = self._reads.peek()
            if t is not None:
                try:
                    body = t.read_run(run_id)
                    if body is not None:
                        state = run_state(body)
                        state["sequences"] = t.sequence_steps(run_id)
                except Exception:  # noqa: BLE001 - not uploaded yet, or down
                    state = None
            if state is None and self._run_dir.exists():
                state = {**replay(self._run_dir, self._label), "version": None}
                if state.get("project_id") is None:
                    state = None
            if state is not None:
                if project is not None and state.get("project_id") not in (
                    None, ingest_ops.slugify(project),
                ):
                    raise ValueError(
                        f"run {run_id} is in project {state['project_id']!r}, not {project!r}"
                    )
                return state
            if project is not None:
                return {"project_id": ingest_ops.slugify(project)}
            if time.monotonic() > deadline:
                raise LookupError(f"run {run_id} not found (pass project= to join it offline)")
            time.sleep(0.25)


    def _start_uploader(self) -> None:
        """Register the run directory with the uploader daemon and start it
        if none runs (never waiting for it). ``CAIRN_UPLOADER=off``: leave
        the directory for ``cairn sync``."""
        if self._ep_repo is not None:
            self._uploading = False
            return
        from ..uploader import daemon as agent

        self._uploading = os.environ.get("CAIRN_UPLOADER", "on").lower() not in ("0", "off", "false", "no")
        if not self._uploading:
            return
        try:
            agent.register(self._run_dir.path)
            agent.ensure_running()
        except Exception:  # noqa: BLE001 - the run goes on; `cairn sync` later
            log.warning("cairn: could not start the uploader", exc_info=True)


    def _join_trial(self, sweep_id: str, trial_id: str) -> None:
        """Link this run to its sweep trial and record the trial's params as
        config. An unnamed run takes the trial's name (``<sweep>-<n>``)."""
        try:
            trial = self._reads.api().report_trial(
                sweep_id, trial_id, run_id=self._run_id, status="running",
            )
            if self._name is None and trial.get("name"):
                self._writer.rename_run(self._run_id, trial["name"])
                self._name = trial["name"]
                # A new name is a new series: a new version (the server's).
                self._version_info = None
        except Exception:
            self.finish(status="failed")
            raise
        if trial.get("params"):
            # Sweep parameters are dotted names ("optim.lr"): nest them like
            # hand-written config.
            self.config(config_doc.unflatten(trial["params"]))


    @property
    def id(self) -> str:
        """The run's id: 32 hex characters, generated client-side."""
        return self._run_id


    @property
    def version(self) -> int | None:
        """The run's number in its series (project, group, job_type, name), assigned by
        the server: 1, 2, ... in creation order, never reused. A resumed run
        or a process joining a shared run keeps it; a fork is a new run, with
        the series' next number. None for an unnamed run.

        The server assigns it when it applies the run's creation record:
        the first read makes the run's records durable and asks the server,
        waiting up to 5 s for the upload; it is known from then on. None
        while the server cannot be reached or has not seen the run yet.
        """
        if self._version_info is None and (
            self._name is not None or not self._primary or self._resumed
        ):
            # The server numbers the run when it applies its creation: make
            # the records durable and give the upload a moment.
            if self._writer is not None and not self._writer.log.closed:
                self._writer.flush()
            deadline = time.monotonic() + self._VERSION_WAIT
            while True:
                try:
                    body = self._reads.run(self._run_id)
                except ServerUnavailable:
                    break
                version = (body or {}).get("run", {}).get("version")
                if version is not None:
                    self._version_info = {"version": version}
                    break
                if body is not None or time.monotonic() > deadline:
                    break
                time.sleep(0.1)
        return None if self._version_info is None else self._version_info["version"]


    @property
    def project(self) -> str:
        """The project's id: the normalised name the server returned (e.g.
        ``"My Project"`` becomes ``"my-project"``)."""
        return self._project_id


    @property
    def url(self) -> str:
        """The run's page in the viewer, the URL ``cairn open`` prints.

        Against a ``cairn server --ui`` that is the paired UI port, not the
        ingest port the run writes to. For a local repo it is the ``cairn ui``
        running over it, else the URL the page will have once
        ``cairn ui --repo PATH`` starts on its default port.
        """
        from .viewer_url import run_page_url

        if self._ep_server is None:
            # A viewer over the repo may come and go: ask every time.
            return run_page_url(_repo_ref(self._ep_repo), self._server, self._url_path)
        if self._page_url is None:
            self._page_url = run_page_url(None, self._server, self._url_path)
        return self._page_url


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


    def finish(self, status: str = "completed", exit_code: int | None = None) -> None:
        """End the run: record its status and make everything durable.

        A worker (``primary=False``) only detaches: it records everything
        and stops logging, and the run's status stays its primary's to set.

        Stops model watching, system-metric sampling and stdout capture,
        waits (up to two minutes) for the source snapshot, records the
        finish and fsyncs the run's log. Then it waits up to
        ``CAIRN_FINISH_TIMEOUT`` seconds (default 30) for the uploader to
        get everything to the server, and prints a notice if it did not (the
        uploader keeps sending in the background; ``cairn sync`` too).
        Calling it again does nothing, and no method that records data works
        afterwards.

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
            self._commit_history()
            # Watch histograms go through _track_leaf, which refuses once
            # finished: drain them first.
            self.unwatch()
            if self._sys_collector is not None:
                self._sys_collector.stop()
                self._sys_collector.join(timeout=5)
            if self._stdout_capture is not None:
                self._stdout_capture.stop()
            self._heartbeat_stop.set()
            try:
                self._flush_progress()
            except Exception:
                log.warning("progress flush failed during finish", exc_info=True)
            # The snapshot's records precede the finish.
            if self._source_thread is not None and self._source_thread.is_alive():
                self._source_thread.join(timeout=120)
            if self._primary:
                self._writer.finish(status, exit_code)
            else:
                self._writer.detach(self._label)
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
            try:
                self._writer.close()
            except Exception:  # noqa: BLE001
                log.warning("closing the run log failed", exc_info=True)
            self._wait_uploaded()
            self._reads.close()
            # Don't fire the atexit hook now that we've finished explicitly.
            try:
                atexit.unregister(self._atexit_finish)
            except Exception:  # noqa: BLE001 - defensive; unregister is cheap
                pass


    def _wait_uploaded(self) -> None:
        """Give the uploader up to ``CAIRN_FINISH_TIMEOUT`` s; say so if it
        did not get everything to the server."""
        if not self._uploading:
            return
        try:
            pending = self._writer.wait_uploaded(finish_timeout())
        except Exception:  # noqa: BLE001
            log.debug("waiting for the upload failed", exc_info=True)
            return
        if pending:
            print(
                f"cairn: run {self._run_id}: {pending} record(s) not confirmed by "
                f"{self._reads.describe()} yet; the uploader keeps sending them in the "
                f"background (or run `cairn sync {self._run_dir.path}`).",
                file=sys.stderr,
            )


    def _heartbeat_loop(self) -> None:
        """Periodically record a heartbeat (the primary) and look for a stop
        request on the server, when it is up (never starting it)."""
        while not self._heartbeat_stop.wait(self._HEARTBEAT_INTERVAL):
            if self._finished:
                return
            try:
                self._flush_progress()
            except Exception:
                log.debug("progress flush failed", exc_info=True)
            try:
                if self._primary:
                    self._writer.heartbeat()
                stop_requested = self._poll_stop()
            except Exception:  # noqa: BLE001
                continue  # Best effort — don't crash the heartbeat thread.
            if stop_requested and stop_requested != self._stale_stop and not self._stop_requested:
                self._handle_stop_request()


    def _poll_stop(self) -> str | None:
        """The run's ``stop_requested`` on its server, if the server is up."""
        t = self._reads.peek()
        if t is None:
            return None
        try:
            return ((t.read_run(self._run_id) or {}).get("run") or {}).get("stop_requested")
        except Exception:  # noqa: BLE001 - down, or the run is not uploaded yet
            return None


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


    def __enter__(self) -> Run:
        return self


    def __exit__(self, exc_type, exc, tb) -> None:
        if self._stop_requested:
            self.finish("stopped")
        elif exc_type is None:
            self.finish("completed")
        else:
            self.finish("failed", exit_code=1)


    def _on_captured_line(self, event: dict[str, Any]) -> None:
        # line_no counts per process: (label, line_no) identifies a line.
        with self._line_lock:
            self._line_counter += 1
            event["line_no"] = self._line_counter
        event["label"] = self._label
        self._writer.add_line(event)


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
                manifest["diff_hash"] = self._writer.upload_artifact(
                    diff.encode("utf-8"), "text/x-diff", {},
                )
            self._writer.upload_source(self._run_id, archive, manifest)
        except Exception:  # noqa: BLE001
            log.warning("source capture failed", exc_info=True)
