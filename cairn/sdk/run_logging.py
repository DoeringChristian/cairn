"""Metric, media, document and metadata logging."""
from __future__ import annotations
import logging
import threading

import secrets
import time
from typing import Any
from ..sdk.wrappers import _TypeWrapper
from cairn.backend import config_doc
from cairn.backend import progress as _progress_rules
from cairn.backend.ingest_ops import summary_conflict
from .gallery import GalleryItem, resolve_gallery
from .scope import Scope
from .summary_media import check_summary_names, media_paths, upload_media
from .uploads import upload_gallery, upload_value
from .watch import Watcher
from .run_support import _now_iso

log = logging.getLogger(__name__)


class RunLogging:
    """Own metric history, step rules, documents and metadata logging.

    Requires lifecycle fields _writer, _registry, _run_id and _finished. Logging
    state is initialized/restored by the lifecycle before capture threads start."""

    _PROGRESS_INTERVAL = 1.0

    def _init_logging_state(self):
        self._step_counters: dict[str, int] = {}
        # name -> (summary, x): the rule last recorded per metric, so a rule
        # passed to every track() call is recorded once.
        self._metric_rules: dict[str, tuple[str | None, str | None]] = {}
        self._step_lock = threading.Lock()
        self._line_counter = 0
        self._line_lock = threading.Lock()
        # The highest explicit step tracked so far; run.watch histograms use it.
        self._last_step: int | None = None
        self._watchers: list[Watcher] = []
        self._total_steps: int | None = None
        # run.progress(): the last value recorded (monotonic time, body) and
        # the newest one held back by the throttle (recorded by the heartbeat/finish).
        self._progress_lock = threading.Lock()
        self._progress_sent_at: float | None = None
        self._progress_pending: dict[str, Any] | None = None

    def _restore_history_state(self, catalogue):
        self._seed_step_counters(catalogue)
        self._history_step = max((int(item.get("max_step", item.get("last_step")) or 0) + 1 for item in catalogue if not item["name"].startswith("system.")), default=0)
        self._history_pending = {}
        self._history_lock = threading.RLock()


    def _restore_document_state(self, state, catalogue):
        # This run's copy of its config / summary documents, so a write that
        # the merge rules reject raises here.
        self._docs: dict[str, dict[str, Any]] = {
            "config": dict(state.get("config") or {}),
            "summary": dict(state.get("summary") or {}),
        }
        # A name is a tracked series or a summary media value, never both:
        # the summary's media keys (refused by track) and the series stored
        # already or tracked by this process (refused by summary).
        self._summary_media: set[str] = set(config_doc.media_leaves(self._docs["summary"]))
        self._catalogue: list[dict[str, Any]] = list(catalogue)
        self._tracked_names: set[str] = set()

    @property
    def total_steps(self) -> int | None:
        """The number of steps the run will take (None: not declared).

        Setting it at any time (``None`` clears it) makes the run's progress
        the highest step logged so far (any series but ``system.*``) divided
        by it. The UI shows it as a bar with an ETA from the step rate over
        the last few minutes."""
        return self._total_steps


    @total_steps.setter
    def total_steps(self, value: int | None) -> None:
        _progress_rules.check_total_steps(value)
        self._total_steps = value
        self._writer.set_total_steps(self._run_id, value)


    def progress(self, i: float, total: float | None = None) -> None:
        """Report explicit progress: ``i`` of ``total`` (e.g. epochs done).

        ``total`` defaults to ``total_steps``. Once called, this value wins
        over the step-based progress for this run. Cheap to call every
        iteration: at most one value per second is sent (always the newest).

            for epoch in range(epochs):
                ...
                run.progress(epoch + 1, total=epochs)

        Raises:
            ValueError: ``i`` is negative or not a finite number, or
                ``total`` is not > 0.
        """
        if self._finished:
            raise RuntimeError("Run has already been finished")
        _progress_rules.check_progress(i, total)
        body = {"value": i, "total": total, "wall_time": _now_iso()}
        now = time.monotonic()
        with self._progress_lock:
            due = (
                self._progress_sent_at is None
                or now - self._progress_sent_at >= self._PROGRESS_INTERVAL
                or (total is not None and i >= total)
            )
            if not due:
                self._progress_pending = body
                return
            self._progress_pending = None
            self._progress_sent_at = now
        self._writer.post_progress(self._run_id, body)


    def _flush_progress(self) -> None:
        """Send the value ``progress()`` held back, if any."""
        with self._progress_lock:
            body, self._progress_pending = self._progress_pending, None
            if body is None:
                return
            self._progress_sent_at = time.monotonic()
        self._writer.post_progress(self._run_id, body)


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


    @property
    def step(self) -> int:
        """Current shared history step for log()."""
        return self._history_step


    def log(self, data, step=None, commit: bool | None = None) -> None:
        """Append a structured entry. Step is an optional ordinary field.

        Every call commits by default; repeated or decreasing steps are retained.
        Nested JSON, strings, booleans and typed media keep their full structure.
        ``commit=False`` explicitly stages fields for the next committed entry.
        """
        from collections.abc import Mapping
        from cairn.backend.records import encode
        from .record_values import serialize
        if self._finished:
            raise RuntimeError('Run has already been finished')
        if not isinstance(data, Mapping) or any(not isinstance(k, str) for k in data):
            raise TypeError('log expects a mapping with string keys')
        if commit is not None and not isinstance(commit, bool):
            raise TypeError('commit must be a bool')
        values = dict(data)
        if step is not None:
            if 'step' in values and values['step'] != step:
                raise ValueError('step argument disagrees with the record step')
            values['step'] = step
        if getattr(self, '_writer', None) is None:  # disabled mode creates no files
            encode(values)
            return
        with self._history_lock:
            encoded = serialize(self, values)
            encode(encoded)
            pending = {**self._history_pending, **encoded}
            encode(pending)
            self._history_pending = pending
            self._history_entry_pending = True
            if commit is not False:
                self._commit_history()


    def _commit_history(self) -> None:
        with self._history_lock:
            if self._history_pending or getattr(self, '_history_entry_pending', False):
                self._writer.record('entry', {'run_id': self._run_id,
                                             'values': self._history_pending,
                                             'timestamp': _now_iso()})
                self._history_pending = {}
                self._history_entry_pending = False
                self._history_step += 1


    def define_metric(self, name: str, *, step_metric: str | None = None, summary: str | None = None):
        """Set an exact metric's axis/aggregate (min, max, mean, or last)."""
        if self._finished:
            raise RuntimeError('Run has already been finished')
        if not isinstance(name, str) or not name or '*' in name:
            raise ValueError('define_metric requires an exact metric name')
        if summary is not None and summary not in SUMMARY_KINDS:
            raise ValueError(f'summary must be one of {SUMMARY_KINDS}')
        self._set_metric_rule(name, summary, step_metric)


    def track(
        self,
        value: Any,
        name: str | dict | None = None,
        step: int | None = None,
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

        With metadata as the second argument, ``track(value, metadata)`` appends
        a general record containing a ``value`` field. Step is optional. Named
        sequence tracking remains available for component-tree logging.

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
        from collections.abc import Mapping
        if name is None or isinstance(name, Mapping):
            metadata = dict(name or {})
            if 'value' in metadata:
                raise ValueError("track metadata cannot replace the value field")
            return self.log({**metadata, 'value': value}, step=step)
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
        if name in self._summary_media:
            raise ValueError(f"cairn: run.track: {summary_conflict(name)}")
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

        self._writer.add_point(point)
        self._tracked_names.add(name)


    def _set_metric_rule(self, name: str, summary: str | None, x: str | None) -> None:
        """Send ``name``'s rule unless nothing in it changed. A keyword left
        out keeps its earlier value (here and on the server), so
        ``summary="min"`` then ``x="epoch"`` gives both."""
        old_summary, old_x = self._metric_rules.get(name, (None, None))
        rule = (summary if summary is not None else old_summary, x if x is not None else old_x)
        if self._metric_rules.get(name) == rule:
            return
        self._writer.set_metric_rule(self._run_id, name, x, summary)
        self._metric_rules[name] = rule


    def _upload_value(self, handler: Any, payload: Any, kwargs: dict[str, Any]) -> tuple[str, str, dict[str, Any]]:
        """Serialize one media value and upload it (``uploads.upload_value``).
        Returns its ``(hash, mime_type, metadata)``."""
        digest, mime, meta, _size = upload_value(self._writer, self._registry, handler, payload, kwargs)
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
        digest, caption = upload_gallery(self._writer, self._registry, object_type, items, kwargs)
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
        self._writer.add_point(point)
        self._tracked_names.add(name)


    @property
    def config(self):
        """Run inputs: use .update(mapping) or [key] = value; nested reads are copies."""
        from .run_document import RunDocument
        return RunDocument(self, 'config')


    @property
    def summary(self):
        """Explicit results; metric aggregates remain available through Reader.Run.final."""
        from .run_document import RunDocument
        return RunDocument(self, 'summary')


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
        update = config_doc.normalize(update, what=kind)
        merged = config_doc.merge(self._docs[kind], update)
        config_doc.nodes(merged)  # raises ValueError on a flat-key collision
        self._docs[kind] = merged
        return update


    def _update_config(self, *args: Any, **kwargs: Any) -> None:
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
            self._writer.post_params(self._run_id, self._merge_doc("config", merged))


    def _update_summary(self, *args: Any, **kwargs: Any) -> None:
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

        A value may also be MEDIA: any ``cairn`` wrapper (``cairn.Image``,
        ``cairn.Figure``, ``cairn.Table``, ...) or a list of them (a gallery,
        as in ``track``), at any depth::

            run.summary(showcase={"loss_landscape": cairn.Figure(fig),
                                  "samples": [cairn.Image(x) for x in xs]})

        Each is ONE value with no step, named by its key's dotted path
        (``showcase.loss_landscape``): cards show it like a tracked series
        (without a step slider), writing the key again REPLACES it, and
        deleting the key removes it. The Overview's summary shows a thumbnail
        of it; the runs table has no column for it. A name is either a
        tracked series or a summary media value.

        Raises:
            TypeError: A value is neither JSON nor cairn media.
            ValueError: A media value's name is a tracked series, or two
                paths flatten to the same dotted key.
        """
        if self._finished:
            raise RuntimeError("Run has already been finished")
        merged = self._merge_mapping("run.summary", args, kwargs)
        if not merged:
            return
        names = media_paths(merged)
        if names:
            check_summary_names(names, self._catalogue, self._tracked_names)
            merged = upload_media(self._writer, self._registry, merged)
        self._writer.post_summary(self._run_id, self._merge_doc("summary", merged))
        self._summary_media = set(config_doc.media_leaves(self._docs["summary"]))


    def set_tag(self, tag: str) -> None:
        """Add one tag, keeping the ones the run already has."""
        if tag not in self._tags:
            self._tags.append(tag)
        self._writer.set_tags(self._run_id, list(self._tags))


    def remove_tag(self, tag: str) -> None:
        """Remove one tag; a tag the run doesn't have is ignored."""
        self._tags = [t for t in self._tags if t != tag]
        self._writer.set_tags(self._run_id, list(self._tags))


    def set_tags(self, tags: list[str]) -> None:
        """Replace the run's tags."""
        self._tags = list(tags)
        self._writer.set_tags(self._run_id, list(self._tags))


    def add_note(self, text: str) -> None:
        """Set the run's notes, replacing any notes it already has.

        Args:
            text: The new notes (plain text; shown on the run page).
        """
        self._writer.set_notes(self._run_id, text)


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
        self._writer.alert(self._run_id, {
            "alert_id": secrets.token_hex(16),
            "title": title,
            "text": text,
            "level": level,
            "created_at": _now_iso(),
        })


    def _seed_step_counters(self, catalogue: list[dict[str, Any]]) -> None:
        """Continue the per-name counters past a run's recorded steps
        (``catalogue``: its series as ``{name, max_step}``).

        Only timer-sampled ``system.*`` points use the counters; without the
        seed a resumed or forked run's samples would restart at step 0 and be
        dropped as duplicates of the ones already stored.
        """
        for s in catalogue:
            top = s.get("max_step", s.get("last_step"))
            if top is None:
                continue
            name = s["name"]
            self._step_counters[name] = max(self._step_counters.get(name, 0), int(top) + 1)


    def _next_step(self, name: str, explicit: int | None) -> int:
        with self._step_lock:
            if explicit is not None:
                self._step_counters[name] = explicit + 1
                return explicit
            cur = self._step_counters.get(name, 0)
            self._step_counters[name] = cur + 1
            return cur



SUMMARY_KINDS = ("min", "max", "mean", "last")


def _rule_on_non_scalar(name: str, kind: str | None) -> str:
    return (
        f"cairn: summary= and x= apply to scalar metrics only; {name!r} is "
        f"a {kind} value"
    )
