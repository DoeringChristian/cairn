"""Default-run conveniences; explicit Run objects remain independent."""
from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Any, Mapping

_default_run = None
_lock = threading.RLock()


def current_run():
    run = _default_run
    return run if run is not None and not run._finished else None


def require_run():
    run = current_run()
    if run is None:
        raise RuntimeError('Call cairn.init() before logging, or use an explicit Run.')
    return run


def init(project: str | None = None, *, config: Mapping[str, Any] | None = None, **kwargs):
    """Start the default run. Finish it before initializing another default run.

    Project defaults to CAIRN_PROJECT or the current directory's name. Destination
    resolution is unchanged: a local repository or one remote server.
    """
    from .run import Run
    with _lock:
        if current_run() is not None:
            raise RuntimeError('A default run is active; call cairn.finish() first. Use cairn.Run for independent runs.')
        if config is not None and not isinstance(config, Mapping):
            raise TypeError('config must be a mapping')
        run = Run(project or os.environ.get('CAIRN_PROJECT') or Path.cwd().name or 'default', **kwargs)
        try:
            if config is not None:
                run.config.update(config)
        except BaseException:
            run.finish('failed', exit_code=1)
            raise
        global _default_run
        _default_run = run
        return run


def log(data: Mapping[str, Any], step: int | None = None, commit: bool | None = None):
    """Log metrics/media to the run returned by the last cairn.init()."""
    return require_run().log(data, step=step, commit=commit)


def finish(exit_code: int = 0):
    """Finish the default run; harmless when no run is active."""
    with _lock:
        run = current_run()
        if run is not None:
            run.finish('completed' if exit_code == 0 else 'failed', exit_code=exit_code)


def track(value, metadata=None, **kwargs):
    """Append a value (including media) with arbitrary record metadata."""
    return require_run().track(value, metadata, **kwargs)


def define_metric(name: str, *, step_metric: str | None = None, summary: str | None = None):
    return require_run().define_metric(name, step_metric=step_metric, summary=summary)


def use_artifact(ref, **kwargs):
    return require_run().use_artifact(ref, **kwargs)
