"""``run.watch(model)`` — gradient and parameter histograms of a torch module.

Every ``every``-th forward pass of the ROOT module is a logging pass. The
counter lives in a forward-pre hook on the root: gradient tensor hooks fire
once per parameter, so they cannot count passes.

On a logging pass the pre-hook histograms every parameter (``parameters/*``),
and the tensor hooks histogram each parameter's gradient once
(``gradients/*``). Histograms are binned on the tensor's device
(``torch.histc``); a daemon worker serialises and records them, so the
training thread never waits on a blob upload. Every histogram uses the run's
last user step.
"""

from __future__ import annotations

import logging
import queue
import threading
from typing import TYPE_CHECKING, Any

from .wrappers import Histogram

if TYPE_CHECKING:
    from .run import Run

log = logging.getLogger(__name__)

LOG_KINDS = ("gradients", "parameters", "all")

_STOP = object()


class Watcher:
    """Hooks on one module plus the worker that records their histograms."""

    def __init__(self, run: "Run", model: Any, *, log: str, every: int, bins: int) -> None:
        if log not in LOG_KINDS:
            raise ValueError(f"run.watch log= must be one of {LOG_KINDS}, got {log!r}")
        if every < 1:
            raise ValueError(f"run.watch every= must be >= 1, got {every}")
        import torch

        self._torch = torch
        self._run = run
        self.model = model
        self._every = every
        self._bins = bins
        self._params = [(n, p) for n, p in model.named_parameters() if p.requires_grad]
        self._log_params = log in ("parameters", "all")
        self._log_grads = log in ("gradients", "all")

        self._passes = 0
        self._active = False
        self._step = 0
        self._grads_done: set[str] = set()

        self._queue: queue.Queue = queue.Queue()
        self._worker = threading.Thread(target=self._drain, daemon=True, name="cairn-watch")
        self._worker.start()

        self._handles = [model.register_forward_pre_hook(self._on_forward)]
        if self._log_grads:
            for name, p in self._params:
                self._handles.append(p.register_hook(self._grad_hook(name)))

    # ---- hooks (training thread / autograd threads) ------------------------

    def _on_forward(self, module: Any, inputs: Any) -> None:
        self._active = self._passes % self._every == 0
        self._passes += 1
        if not self._active:
            return
        self._step = self._run._last_step or 0
        self._grads_done = set()
        if self._log_params:
            for name, p in self._params:
                self._enqueue(f"parameters/{name}", p)

    def _grad_hook(self, name: str) -> Any:
        def hook(grad: Any) -> None:
            if self._active and name not in self._grads_done:
                self._grads_done.add(name)
                self._enqueue(f"gradients/{name}", grad)

        return hook

    def _enqueue(self, name: str, tensor: Any) -> None:
        binned = self._histogram(tensor)
        if binned is not None:
            self._queue.put((name, *binned, self._step))

    def _histogram(self, tensor: Any) -> tuple[Any, Any] | None:
        """``(counts, edges)`` on the CPU, binned on the tensor's device;
        None when no value is finite."""
        torch = self._torch
        with torch.no_grad():
            t = tensor.detach().float().reshape(-1)
            t = t[torch.isfinite(t)]
            if t.numel() == 0:
                return None
            lo, hi = t.min().item(), t.max().item()
            if lo == hi:
                lo, hi = lo - 0.5, hi + 0.5
            counts = torch.histc(t, bins=self._bins, min=lo, max=hi)
            edges = torch.linspace(lo, hi, self._bins + 1)
        return counts.cpu(), edges

    # ---- worker -------------------------------------------------------------

    def _drain(self) -> None:
        while True:
            item = self._queue.get()
            if item is _STOP:
                return
            name, counts, edges, step = item
            try:
                self._run._track_leaf(Histogram(counts=counts, edges=edges), name, step=step)
            except Exception:  # noqa: BLE001 - never kill the worker over one histogram
                log.warning("run.watch failed to record %s", name, exc_info=True)

    def close(self) -> None:
        """Remove the hooks, then record everything already queued."""
        for h in self._handles:
            h.remove()
        self._handles = []
        self._queue.put(_STOP)
        self._worker.join()
