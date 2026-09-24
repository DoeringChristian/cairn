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
import secrets
import signal
import sys
import threading
import _thread
from dataclasses import dataclass
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
from ..sdk.handlers.registry import HandlerRegistry, default_registry, resolve_mime_type
from ..sdk.handlers.image import GALLERY_MIME
from ..sdk.handlers.table import MAX_ROWS as _TABLE_MAX_ROWS
from ..sdk.wrappers import Audio, Image, Text, Video, _TypeWrapper
from .artifact_dir import MANIFEST_MIME, ArtifactDir, is_multi_file, upload_manifest
from .buffer import MetricBuffer
from .connect import open_transport
from .local import LocalTransport
from .scope import Scope
from .transport import Transport
from .wal import WriteAheadLog
from .watch import Watcher

log = logging.getLogger(__name__)


@dataclass
class ArtifactVersion:
    """A single version of a versioned artifact."""
    id: str
    family_id: str
    family_name: str
    version: int
    hash: str
    size_bytes: int
    metadata: dict
    created_at: str
    created_by_run: str | None = None
    aliases: list | None = None

    @classmethod
    def from_row(cls, row: dict) -> "ArtifactVersion":
        """Build from a server row, tolerating extra/missing envelope keys
        (forward-compatible ingest — R0 conformance fix)."""
        import dataclasses

        names = {f.name for f in dataclasses.fields(cls)}
        data = {k: v for k, v in row.items() if k in names}
        data.setdefault("family_name", row.get("name", ""))
        data.setdefault("metadata", row.get("metadata") or {})
        return cls(**data)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _context_key(context: Any) -> tuple:
    if context is None:
        return ()
    if isinstance(context, dict):
        return tuple(sorted((str(k), str(v)) for k, v in context.items()))
    return (str(context),)


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
        self._timeout = timeout
        # The run's tag list, kept client-side: the ``set_tags`` op replaces
        # the whole list, and WAL-mode LocalTransport has no DB to read it back.
        self._tags: list[str] = list(tags or [])

        # Bookkeeping
        self._finished = False
        self._step_counters: dict[tuple, int] = {}
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
        self._metric_buffer = MetricBuffer(
            flush_fn=lambda batch: self._transport.post_batch(self._run_id, batch),
            flush_interval=0.5,
            max_rows=1000,
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

    # ---- properties -------------------------------------------------------

    @property
    def id(self) -> str:
        return self._run_id

    @property
    def url(self) -> str:
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

    def scope(self, *, step: int, context: Any | None = None) -> "Scope":
        """A :class:`~cairn.sdk.scope.Scope` with ``step``/``context`` bound.

        The SECONDARY entry point. `Run` is already the root scope, so
        ``run.track(model, "model", step=it)`` walks a component tree on its own;
        this exists for the case recursion cannot reach — handing a pre-bound
        logger to a plain function that is not a component::

            evaluate(model, run.scope(step=it))
        """
        if self._finished:
            raise RuntimeError("Run has already been finished")
        return Scope(self, "", step=step, context=context)

    def track(
        self,
        value: Any,
        name: str,
        step: int,
        context: Any | None = None,
        **kwargs: Any,
    ) -> None:
        """Record ``value`` in the named sequence at ``step``.

        ``step`` is REQUIRED. It used to default to a per-``(name, context)``
        auto-increment, which is coherent for one sequence and silently wrong
        across a component tree: a member recorded on only some iterations would
        keep counting from zero and its points would claim iterations that were
        not theirs. The iteration is now named exactly once, here — and every
        ``__cairn_track__`` below inherits it.

        If ``value`` implements ``__cairn_track__`` this walks the component tree
        instead of recording a leaf, threading this ``name`` down as the prefix.
        ``None`` is a silent skip.
        """
        if self._finished:
            raise RuntimeError("Run has already been finished")
        if value is None:
            return
        if hasattr(value, "__cairn_track__"):
            Scope(self, "", step=step, context=context).track(value, name, **kwargs)
            return
        self._track_leaf(value, name, step=step, context=context, **kwargs)

    def _track_sample(self, name: str, value: Any) -> None:
        """Record a TIMER-SAMPLED point, numbering it with the per-name counter.

        The one legitimate stepless caller is the system-metrics collector: its
        samples are taken on a wall-clock interval, not per training iteration,
        so there is no step to supply and a per-name counter is exactly right.
        Kept off the public API so the counter cannot silently renumber a tree.
        """
        self._track_leaf(value, name, step=None, context=None)

    def _track_leaf(
        self,
        value: Any,
        name: str,
        *,
        step: int | None,
        context: Any | None = None,
        **kwargs: Any,
    ) -> None:
        """Record ONE point — no protocol dispatch. ``step=None`` auto-increments
        (see :meth:`_track_sample`; never reachable from the public API)."""
        if self._finished:
            raise RuntimeError("Run has already been finished")

        if isinstance(value, (list, tuple)) and value and all(isinstance(v, Image) for v in value):
            self._track_gallery(list(value), name, step=step, context=context, **kwargs)
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

        effective_step = self._next_step(name, context, step)
        if step is not None:
            self._last_step = step if self._last_step is None else max(self._last_step, step)
        merged_kwargs = {**wrapper_kwargs, **kwargs}


        point: dict[str, Any] = {
            "name": name,
            "step": effective_step,
            "wall_time": _now_iso(),
            "context": context,
            "object_type": object_type,
        }

        if object_type == "scalar":
            # Fast path — scalar handler has a cheap to_scalar method.
            point["scalar_value"] = handler.to_scalar(payload)  # type: ignore[attr-defined]
        else:
            payload, media_hashes = self._upload_table_media(handler, payload)
            blob, meta = handler.serialize(payload, **merged_kwargs)
            if media_hashes:
                meta["media_hashes"] = media_hashes
            # Figure handler dual-storage: upload source as a second artifact.
            source_blob = meta.pop("_source_blob", None)
            source_mime = meta.pop("_source_mime", None)
            if source_blob is not None and source_mime is not None:
                src_hash = self._transport.upload_artifact(source_blob, source_mime, {})
                meta["source_hash"] = src_hash
            digest = self._transport.upload_artifact(
                blob, resolve_mime_type(handler, payload, merged_kwargs), meta, object_type=handler.object_type,
            )
            point["artifact_hash"] = digest

        self._metric_buffer.append(point)

    def _track_gallery(
        self,
        images: list[Image],
        name: str,
        *,
        step: int | None,
        context: Any | None = None,
        **kwargs: Any,
    ) -> None:
        """Record several images as ONE point: each image is its own artifact,
        and the point's artifact is a manifest listing them (``GALLERY_MIME``)."""
        handler = self._registry.find_by_type("image")
        assert handler is not None
        items: list[dict[str, Any]] = []
        for image in images:
            merged = {**image.kwargs, **kwargs}
            blob, meta = handler.serialize(image.obj, **merged)
            mime = resolve_mime_type(handler, image.obj, merged)
            digest = self._transport.upload_artifact(blob, mime, meta, object_type="image")
            items.append({"hash": digest, "mime_type": mime, "metadata": meta})
        manifest = json.dumps({"images": items}).encode()
        meta = {"gallery": len(items), "preview": items[0]["metadata"].get("preview"), "encoding": "gallery"}
        digest = self._transport.upload_artifact(manifest, GALLERY_MIME, meta, object_type="image")
        self._metric_buffer.append({
            "name": name,
            "step": self._next_step(name, context, step),
            "wall_time": _now_iso(),
            "context": context,
            "object_type": "image",
            "artifact_hash": digest,
        })

    def _upload_table_media(self, handler: Any, payload: Any) -> tuple[Any, list[str]]:
        """Upload a table's ``cairn.Image``/``Audio``/``Video`` cells as their own
        artifacts and put ``{"$media": {hash, mime_type, object_type}}`` in their place.

        Only tables are touched (any other handler gets ``payload`` back). The
        table is normalized first, so DataFrame cells are covered too; only the
        first ``MAX_ROWS`` rows are walked, as the rest are truncated anyway.
        Returns the (possibly rewritten) payload and the uploaded hashes, which
        go in the table's metadata so export can follow them.
        """
        if getattr(handler, "object_type", None) != "table":
            return payload, []
        names, rows = handler._normalize(payload)
        hashes: list[str] = []
        for row in rows[:_TABLE_MAX_ROWS]:
            for c, cell in enumerate(row):
                if not isinstance(cell, (Image, Audio, Video)):
                    continue
                cell_handler = self._registry.find_by_type(cell.object_type)
                assert cell_handler is not None
                blob, meta = cell_handler.serialize(cell.obj, **cell.kwargs)
                mime = resolve_mime_type(cell_handler, cell.obj, cell.kwargs)
                digest = self._transport.upload_artifact(blob, mime, meta, object_type=cell.object_type)
                row[c] = {"$media": {"hash": digest, "mime_type": mime, "object_type": cell.object_type}}
                if digest not in hashes:
                    hashes.append(digest)
        return {"columns": names, "data": rows, "dataframe": None}, hashes

    def log_artifact(
        self,
        value: Any,
        name: str,
        step: int | None = None,
        *,
        artifact_type: str | None = None,
        metadata: dict | None = None,
        aliases: list[str] | None = None,
    ) -> "ArtifactVersion | str":
        """Attach an artifact to the run.

        Without ``artifact_type``: serialize + upload + attach as a NAMED run
        artifact (the ``run_artifacts`` pool) and return its content digest.
        With ``artifact_type``: register a version in the artifact registry
        (family + versions) and return the :class:`ArtifactVersion`.

        A directory path, a :class:`~cairn.sdk.artifact_dir.Reference` or a
        list of them is a multi-file artifact: each file is uploaded
        content-addressed (references are only recorded), and a manifest
        naming them is versioned — in the ``artifact_type`` family, or
        ``"artifact"`` when none is given. ``use_artifact`` returns it as an
        :class:`~cairn.sdk.artifact_dir.ArtifactDir`.

        Sequence points go through :meth:`track`, not here.
        """
        if is_multi_file(value):
            digest, size, meta = upload_manifest(self._transport, value)
            return self._create_version(
                name, artifact_type or "artifact", digest, size, {**meta, **(metadata or {})}, aliases,
            )
        if artifact_type is not None:
            return self._log_versioned_artifact(value, name, artifact_type, metadata, aliases)

        # Named-artifact path: handler dispatch (wrapper unwrap, like track).
        if isinstance(value, _TypeWrapper):
            payload, object_type = value.obj, value.object_type
            handler = self._registry.find_by_type(object_type)
            kwargs = value.kwargs
        else:
            payload = value
            handler = self._registry.find_handler(value)
            object_type = handler.object_type if handler else None
            kwargs = {}
        if handler is None:
            raise TypeError(
                f"No handler for value of type {value.__class__.__name__}; "
                "wrap with cairn.Image/Figure/Tensor/... to force a handler."
            )
        payload, media_hashes = self._upload_table_media(handler, payload)
        blob, meta = handler.serialize(payload, **kwargs)
        if media_hashes:
            meta["media_hashes"] = media_hashes
        if metadata:
            meta = {**meta, **metadata}
        digest = self._transport.upload_artifact(
            blob, resolve_mime_type(handler, payload, kwargs), meta, object_type=object_type
        )
        self._transport.attach_artifact(self._run_id, name, digest, step)
        return digest

    def _log_versioned_artifact(
        self,
        value: Any,
        name: str,
        family_type: str,
        metadata: dict | None,
        aliases: list[str] | None,
    ) -> ArtifactVersion | None:
        """Upload a blob and create a versioned artifact entry."""
        handler_meta: dict[str, Any] = {}
        mime_type = "application/octet-stream"

        # Handle Path/str as file path
        if isinstance(value, (str, Path)):
            path = Path(value)
            with open(path, "rb") as f:
                blob = f.read()
        else:
            # Use the handler registry to serialize the value
            handler = self._registry.find_handler(value)
            if handler is not None:
                blob, handler_meta = handler.serialize(value)
                mime_type = resolve_mime_type(handler, value, {})
            elif isinstance(value, (bytes, bytearray)):
                blob = bytes(value)
            else:
                raise TypeError(
                    f"No handler for value of type {type(value).__name__} and "
                    "value is not bytes or a file path."
                )

        # Merge metadata
        merged_meta = {**handler_meta, **(metadata or {})}

        # Upload blob (reuse existing upload_artifact)
        digest = self._transport.upload_artifact(blob, mime_type, merged_meta)
        return self._create_version(name, family_type, digest, len(blob), merged_meta, aliases)

    def _create_version(
        self,
        name: str,
        family_type: str,
        digest: str,
        size_bytes: int,
        metadata: dict[str, Any],
        aliases: list[str] | None,
    ) -> ArtifactVersion | None:
        result = self._transport.create_artifact_version(
            project_id=self._project_id,
            family_name=name,
            family_type=family_type,
            digest=digest,
            size_bytes=size_bytes,
            metadata=metadata,
            created_by_run=self._run_id,
            aliases=aliases,
        )
        return ArtifactVersion.from_row(result) if result else None

    def use_artifact(self, ref: str, *, role: str = "input") -> Any:
        """Consume an artifact. ``ref`` is ``"name:alias"`` or ``"name:vN"``.

        A multi-file artifact comes back as an
        :class:`~cairn.sdk.artifact_dir.ArtifactDir` (``.files``,
        ``.open(path)``, ``.download(root)``); anything else as its
        deserialized value, or bytes.
        """
        version_info = self._transport.resolve_artifact(self._project_id, ref)
        # Record consumption
        self._transport.record_artifact_input(self._run_id, version_info["id"], role)
        # Download bytes (uses existing cache)
        data = self._transport.download_artifact_bytes(version_info["hash"])
        if version_info.get("mime_type") == MANIFEST_MIME:
            return ArtifactDir.from_bytes(data, self._transport.download_artifact_bytes)
        # Deserialize if possible
        object_type = version_info.get("object_type")
        if object_type:
            handler = self._registry.find_by_type(object_type)
            if handler and hasattr(handler, "deserialize"):
                meta = version_info.get("metadata", {})
                if isinstance(meta, str):
                    meta = json.loads(meta) if meta else {}
                return handler.deserialize(data, meta)
        return data

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

    def config(self, *args: Any, **kwargs: Any) -> None:
        """Record the run's INPUTS — what was decided before the work ran.

        Accepts a mapping and/or kwargs; nested dicts flatten to dotted keys
        server-side (``run.config(hparams={"lr": 1e-3})`` → ``hparams.lr``).

            run.config(lr=1e-3, sched={"warmup": 100})
            run.config(vars(args))

        The counterpart is :meth:`summary`, for results.
        """
        if self._finished:
            raise RuntimeError("Run has already been finished")
        merged = self._merge_mapping("run.config", args, kwargs)
        if merged:
            self._transport.post_params(self._run_id, merged)

    def summary(self, *args: Any, **kwargs: Any) -> None:
        """Record the run's RESULTS — the numbers you are claiming.

            run.summary(best_val_acc=0.91, epochs_run=30)
            run.summary({"test": {"psnr": 31.4}})      # -> test.psnr

        Same shape as :meth:`config`, opposite meaning: config is what went in,
        summary is what came out. Nothing writes here implicitly — a metric's
        last value is NOT a summary entry. The run table shows the last point of
        each series and lets an explicit summary key of the same name override
        it, so a number appears here only because you said so, and "who claimed
        this" stays answerable.
        """
        if self._finished:
            raise RuntimeError("Run has already been finished")
        merged = self._merge_mapping("run.summary", args, kwargs)
        if merged:
            self._transport.post_summary(self._run_id, merged)

    def define_metric(
        self,
        name: str,
        step_metric: str | None = None,
        summary: str | None = None,
    ) -> None:
        """Say how the metric ``name`` (or every metric an fnmatch glob such as
        ``"val/*"`` matches) should be read.

        ``step_metric`` names another scalar series to use as its x-axis
        (``run.define_metric("val/*", step_metric="epoch")``): cards showing
        the metric start on that axis, joining the two series on step.
        ``summary`` picks the value the run table shows for it: ``"min"``,
        ``"max"``, ``"mean"`` or ``"last"`` (the default). An explicit
        :meth:`summary` key of the same name still wins.
        """
        if summary is not None and summary not in ("min", "max", "mean", "last"):
            raise ValueError(f"summary must be 'min', 'max', 'mean' or 'last', got {summary!r}")
        self._transport.define_metric(self._run_id, name, step_metric, summary)

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
        self._transport.set_notes(self._run_id, text)

    # ---- model watching ---------------------------------------------------

    def watch(self, model: Any, log: str = "gradients", every: int = 100, bins: int = 64) -> None:
        """Record histograms of a torch module's gradients and/or parameters.

        Every ``every``-th forward pass of ``model`` records ``gradients/<param>``
        (from that pass's backward), ``parameters/<param>``, or both
        (``log="gradients"|"parameters"|"all"``), at the last step you tracked::

            run.watch(model, log="all", every=100)

        :meth:`unwatch` (or :meth:`finish`) removes the hooks.
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
            try:
                self._transport.drain_spill(self._run_id)
            except Exception:  # noqa: BLE001
                log.warning("drain_spill failed during finish", exc_info=True)
            self._transport.finish_run(self._run_id, status, exit_code)
            # Clean up WAL after successful finish
            if self._wal is not None:
                try:
                    if not self._wal.has_pending:
                        self._wal.cleanup()
                    else:
                        log.warning("WAL has %d pending entries after finish", self._wal._seq - self._wal.read_checkpoint())
                        self._wal.close()
                except Exception:  # noqa: BLE001
                    log.warning("WAL cleanup failed", exc_info=True)
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
        """Continue the per-series counters past ``run_id``'s recorded steps.

        Only timer-sampled ``system.*`` points use the counters; without the
        seed a resumed or forked run's samples would restart at step 0 and be
        dropped as duplicates of the ones already stored.
        """
        for s in self._transport.sequence_steps(run_id):
            ctx = s.get("context")
            if isinstance(ctx, str):
                ctx = json.loads(ctx)
            key = (s["name"], _context_key(ctx))
            self._step_counters[key] = max(self._step_counters.get(key, 0), s["max_step"] + 1)

    def _next_step(self, name: str, context: Any, explicit: int | None) -> int:
        key = (name, _context_key(context))
        with self._step_lock:
            if explicit is not None:
                self._step_counters[key] = explicit + 1
                return explicit
            cur = self._step_counters.get(key, 0)
            self._step_counters[key] = cur + 1
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
        if diff:
            try:
                self.log_artifact(Text(diff), name="git.diff")
            except Exception:  # noqa: BLE001
                log.warning("git diff upload failed", exc_info=True)
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
            self._transport.upload_source(self._run_id, archive, manifest)
        except Exception:  # noqa: BLE001
            log.warning("source capture failed", exc_info=True)


class _DisabledRun(Run):
    """What ``cairn.Run`` returns in disabled mode: every method is a no-op.

    ``scope()`` still hands out a real :class:`Scope`, which walks components
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

    def use_artifact(self, *args: Any, **kwargs: Any) -> None:
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

    def define_metric(self, *args: Any, **kwargs: Any) -> None:
        pass

    def finish(self, *args: Any, **kwargs: Any) -> None:
        self._finished = True


def configure(**kwargs: Any) -> None:
    """Module-level configuration forwarder."""
    config.configure(**kwargs)
