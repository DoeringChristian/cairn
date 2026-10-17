"""Public Run facade, disabled mode, and notebook presentation.

Implementation responsibilities live in run_lifecycle, run_logging and
run_artifacts. The three components currently share one Run instance: this
preserves journaling and callback ordering without proxy objects or API shims.
"""
from __future__ import annotations
import threading
from pathlib import Path
from typing import Any, Callable
from .. import config
from . import handlers as _handlers_pkg  # Register built-in media handlers.
from .run_ids import env_run_id, new_run_id
from .run_lifecycle import RunLifecycle
from .run_logging import RunLogging
from .run_artifacts import RunArtifacts


class Run(RunLifecycle, RunLogging, RunArtifacts):
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

    Several processes can log into one run (wandb's "shared" mode): every
    process gets the same id (``run_id=`` or ``CAIRN_RUN_ID``), one PRIMARY
    creates the run and the others join it with ``primary=False`` (or
    ``cairn.attach``) and a ``label``. Everything a worker records lands in
    the run, but only the primary sets its status and keeps it alive: a
    worker's finish, exception or silence never changes it. A stop request
    reaches every process. A labelled process's system metrics are
    ``system.<label>.*`` and its console lines carry its label.

    Example:
        ```python
        with cairn.Run("mnist", name="baseline", tags=["cnn"]) as run:
            run.config(lr=1e-3, epochs=10)
            for step in range(1000):
                run.track(loss, "train.loss", step)
        ```

    Args:
        project: Project name. Normalised to an id (lowercase, spaces become
            dashes); created on first use. Required, except for a worker
            (``primary=False``), which joins the run's project.
        name: Display name: a free label, need not be unique. Default: none
            (the UI shows the id); a run launched by ``Sweep.run`` takes
            its trial's name. A run with the same group, job type and name
            as an earlier one is its next ``version`` (a re-run).
        tags: Initial tags. Edit later with ``set_tag``/``remove_tag``/``set_tags``.
        notes: Free-text notes shown on the run page.
        group: The runs that belong together (e.g. the seeds of one
            configuration, the steps of one experiment ``"exp-44"``). The
            workspace aggregates a group into one line; filterable and
            groupable in the runs table.
        job_type: The run's role within its group (e.g. ``"prepare"``,
            ``"train"``, ``"eval"``, ``"finetune"``). Shown next to the group
            on the run page; the runs table and the workspace group by it
            below the group (group, then job type), and the lineage graph
            labels and clusters runs by it. Part of the version key (group,
            job type, name).
        sweep_id: Attach the run to this sweep. Set automatically, together
            with the trial, when the process runs under ``Sweep.run``.
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
        run_id: The id of a new run (default: ``CAIRN_RUN_ID``, else a fresh
            one; see ``cairn.new_run_id``), 1-64 characters of ``A-Z a-z
            0-9 _ -``. A run with this id must not exist yet. For a worker:
            the run to join (required, here or in ``CAIRN_RUN_ID``).
        label: This process's name within the run (e.g. ``"rank1"``):
            required for a worker, optional for the primary; unique among
            the run's live processes. ``"auto"`` takes it from the
            launcher's rank (``RANK``, ``SLURM_PROCID``,
            ``SKYPILOT_NODE_RANK``, ``OMPI_COMM_WORLD_RANK``, ``PMI_RANK``,
            first set wins): rank 0 is the primary ``"rank0"``, rank N a
            worker ``"rankN"``; with none set, an unlabelled primary.
        primary: False: join the existing run as a worker (see above)
            instead of creating one. Default: True, or what
            ``label="auto"`` detected.
        repo: The repo the run belongs to: a ``.cairn/`` directory (served
            directly through its database) or a
            ``cairn://host:port`` server. Default: ``cairn.configure``,
            then ``CAIRN_REPO``, ``CAIRN_SERVER``, the config file, then
            ``./.cairn``. Wherever it is, the run only writes its own run
            directory, ``$CAIRN_DIR/runs/<id>/`` (default ``./.cairn``): an
            append-only record log (fsynced every ~100 ms) plus its blobs.
            A background uploader (started on demand) sends remote batches
            with deduplicated retries; logging never
            waits on the network, and a run works with the server down.
        server: The server's URL, instead of ``repo``.
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
        timeout: HTTP timeout in seconds of the reads that need the server
            (resuming a run that is not on this machine, resolving an
            artifact ref, sweeps).
        registry: Handler registry deciding how values are stored. Default:
            the global one (see ``cairn.register_handler``).
        mode: ``"disabled"`` makes every method a no-op (see above).
        on_stop: Callback ``fn(run)`` run when a stop is requested; more can
            be added with ``on_stop``.
        stop_mode: What a stop request (the UI's Stop button) does after the
            callbacks: ``"interrupt"`` (default) raises ``KeyboardInterrupt``
            in the main thread and the run finishes as ``stopped``;
            ``"flag"`` only sets ``should_stop`` for the training loop to poll.
        total_steps: The number of steps the run will take. Its progress is
            then the highest step it logged (any series but ``system.*``)
            divided by this, shown as a bar with an ETA in the UI. Settable
            later as ``run.total_steps``; ``progress()`` overrides it.
        uses: Runs this run used directly, without an artifact between them
            (run ids, or anything with an ``.id`` such as a ``cairn.Run`` or
            a Reader run): ``use_run`` for each once the run has started.

    Raises:
        ValueError: For an unknown ``stop_mode``, ``rewind_to`` without
            ``resume``, both ``resume`` and ``fork_from``, or ``fork_from``
            together with ``parent_run_id``/``fork_step``; a ``run_id`` that
            is taken, malformed, or differs from ``resume``; a worker without
            an id or a label, or with ``resume``/``fork_from``; a label in
            use by another live process of the run.
        TypeError: No ``project`` for a primary.
        LookupError: A worker's run did not appear within two minutes
            (only waited for where the project must be looked up: over
            HTTP, or ``project`` not given).
    """


    def __new__(cls, *args: Any, mode: str | None = None, **kwargs: Any) -> Run:
        if cls is Run and config.resolve_mode(mode) == "disabled":
            return object.__new__(_DisabledRun)
        return object.__new__(cls)


    def _viewer_source(self) -> tuple[str | None, str | None]:
        """``(server, repo_path)``: where the run page renders from."""
        if self._ep_server is None:
            return None, self._ep_repo
        return self._server, None


    def display(self, tab: str = "workspace", height: int = 720) -> Any:
        """The run page inline in a notebook (Jupyter, marimo): live, as the
        last expression of a cell. A run displays its Workspace tab by
        itself; this picks another ``tab`` (workspace, overview, system,
        logs, files, artifacts) or ``height`` (px).

        Returns:
            A ``cairn.ui.PageElement``. Needs the ``ui`` extra.
        """
        from .notebook import run_element

        server, repo_path = self._viewer_source()
        return run_element(self._run_id, server=server, repo_path=repo_path, tab=tab, height=height)


    def _repr_html_(self) -> str | None:
        from .notebook import run_html

        server, repo_path = self._viewer_source()
        return run_html(self._run_id, server=server, repo_path=repo_path)


    def _repr_mimebundle_(self, include: Any = None, exclude: Any = None) -> dict[str, Any] | None:
        html = self._repr_html_()
        return None if html is None else {"text/html": html, "text/plain": repr(self)}


    def _display_(self) -> Any:
        """marimo: the run page (plain repr without the ``ui`` extra)."""
        try:
            return self.display()
        except ImportError:
            return repr(self)


def attach(
    run_id: str,
    label: str,
    *,
    repo: str | Path | None = None,
    project: str | None = None,
    system_metrics: bool = True,
    capture_output: bool = True,
) -> Run:
    """Join the existing run ``run_id`` from another process, as a worker.

    The same as ``cairn.Run(project, run_id=run_id, label=label,
    primary=False, ...)``: everything this process records lands in that
    run, but it never changes the run's status; ``finish()`` (or leaving a
    ``with`` block, or exiting) only detaches it. The run may still be
    being created (its primary started at the same time) or may have
    finished (a later job adding evaluation metrics).

        run = cairn.attach(run_id, label=f"rank{rank}")

    Args:
        run_id: The run to join (its primary's ``run.id``).
        label: This process's name within the run, e.g. ``"rank1"``
            (``"auto"``: from the launcher's rank, see ``cairn.Run``). Its
            system metrics are ``system.<label>.*`` and its console lines
            carry it.
        repo: Where the run lives (as for ``cairn.Run``).
        project: The run's project; looked up when not given.
        system_metrics: Sample this process's CPU, memory, disk and GPU
            usage as ``system.<label>.*``.
        capture_output: Record this process's stdout/stderr lines.

    Returns:
        The joined ``cairn.Run``.

    Raises:
        ValueError: A malformed id or label, or a label in use by another
            live process of the run.
        LookupError: The run did not appear within two minutes (only
            waited for where its project must be looked up).
    """
    return Run(
        project, run_id=run_id, label=label, primary=False, repo=repo,
        capture_system_metrics=system_metrics, capture_stdout=capture_output,
    )


class _DisabledRun(Run):
    """What ``cairn.Run`` returns in disabled mode: every method is a no-op.

    ``scope()`` still hands out a real ``Scope``, which walks components
    into these no-ops.
    """

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self._run_id = kwargs.get("run_id") or env_run_id() or new_run_id()
        self._project = kwargs.get("project", args[0] if args else None)
        # Nothing to ask for the normalised id: ``project`` is what was given.
        self._project_id = self._project
        self._version_info = {"version": None}
        self._tags = list(kwargs.get("tags") or [])
        self._finished = False
        self._stop_requested = False
        self._total_steps = kwargs.get("total_steps")
        self._history_step = 0
        self._history_pending = {}
        self._history_lock = threading.RLock()
        self._docs = {"config": {}, "summary": {}}

    @property
    def url(self) -> None:  # type: ignore[override]
        return None

    def display(self, *args: Any, **kwargs: Any) -> None:  # type: ignore[override]
        return None

    def _repr_html_(self) -> None:  # type: ignore[override]
        return None

    def _repr_mimebundle_(self, *args: Any, **kwargs: Any) -> None:  # type: ignore[override]
        return None

    def _display_(self) -> str:  # type: ignore[override]
        return repr(self)

    @property
    def total_steps(self) -> int | None:  # type: ignore[override]
        return self._total_steps

    @total_steps.setter
    def total_steps(self, value: int | None) -> None:
        self._total_steps = value

    def progress(self, *args: Any, **kwargs: Any) -> None:
        pass

    def track(self, *args: Any, **kwargs: Any) -> None:
        pass

    def _track_leaf(self, *args: Any, **kwargs: Any) -> None:
        pass

    def _track_sample(self, *args: Any, **kwargs: Any) -> None:
        pass

    def _merge_mapping(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        return {}

    def _update_config(self, *args: Any, **kwargs: Any) -> None:
        for value in args:
            self._docs["config"].update(value)
        self._docs["config"].update(kwargs)

    def _update_summary(self, *args: Any, **kwargs: Any) -> None:
        for value in args:
            self._docs["summary"].update(value)
        self._docs["summary"].update(kwargs)

    def define_metric(self, *args: Any, **kwargs: Any) -> None:
        pass

    def log_artifact(self, *args: Any, **kwargs: Any) -> None:  # type: ignore[override]
        pass

    def use_artifact(self, *args: Any, **kwargs: Any) -> None:  # type: ignore[override]
        pass

    def log_model(self, *args: Any, **kwargs: Any) -> None:  # type: ignore[override]
        pass

    def use_model(self, *args: Any, **kwargs: Any) -> None:  # type: ignore[override]
        pass

    def use_run(self, *args: Any, **kwargs: Any) -> None:  # type: ignore[override]
        pass

    def use_viewer(self, *args: Any, **kwargs: Any) -> None:  # type: ignore[override]
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


def configure(**kwargs: Any) -> None:
    """Module-level configuration forwarder."""
    config.configure(**kwargs)
