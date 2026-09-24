"""Disabled mode: cairn.Run becomes a no-op that writes nothing and starts no thread."""

from __future__ import annotations

import threading

import numpy as np
import pytest

import cairn
from cairn import config
from cairn.sdk.run import Run, _DisabledRun


@pytest.fixture(autouse=True)
def _clean_config(tmp_path, monkeypatch):
    config.reset_configured()
    monkeypatch.delenv("CAIRN_MODE", raising=False)
    monkeypatch.setattr(config, "config_file_path", lambda: tmp_path / "config.toml")
    monkeypatch.chdir(tmp_path)
    yield
    config.reset_configured()


class Component:
    def __cairn_track__(self, scope) -> None:
        scope.track(1.0, "x")
        scope.config(lr=1e-3)


def _exercise(run: Run) -> None:
    run.track(0.5, name="loss", step=0)
    run.track(Component(), name="c", step=0)
    run.track(cairn.Image(np.zeros((4, 4))), name="img", step=0)
    run.config(lr=1e-3)
    run.summary(best=1.0)
    run.set_tag("a")
    run.set_tags(["b"])
    run.remove_tag("b")
    run.add_note("hi")
    run.alert("title", "text")
    assert run.log_artifact(b"bytes", name="blob") is None
    assert run.use_artifact("model:latest") is None
    run.watch(object())
    run.unwatch()
    scope = run.scope(step=1)
    scope.track(2.0, "y")
    scope.track(Component(), "c")
    scope.scope("sub").config(k=1)
    scope.summary(best=2.0)


def test_disabled_run_writes_nothing_and_starts_no_thread(tmp_path):
    repo = tmp_path / "repo"
    threads = set(threading.enumerate())
    with cairn.Run(project="p", repo=repo, mode="disabled") as run:
        assert isinstance(run, cairn.Run) and isinstance(run, _DisabledRun)
        assert isinstance(run.id, str) and run.url is None
        _exercise(run)
    run.finish()
    assert set(threading.enumerate()) == threads
    assert not repo.exists()
    assert not (tmp_path / ".cairn").exists()


def test_env_var_disables(monkeypatch):
    monkeypatch.setenv("CAIRN_MODE", "disabled")
    assert isinstance(cairn.Run(project="p"), _DisabledRun)
    # An explicit mode wins over the environment.
    run = cairn.Run(project="p", mode="enabled", capture_source=False, capture_stdout=False,
                    capture_env=False, capture_system_metrics=False)
    try:
        assert not isinstance(run, _DisabledRun)
    finally:
        run.finish()


def test_configure_disables():
    cairn.configure(mode="disabled")
    assert isinstance(cairn.Run(project="p"), _DisabledRun)


def test_config_file_disables(tmp_path):
    config.write_config_file({"mode": "disabled"})
    assert config.resolve_mode() == "disabled"
    assert isinstance(cairn.Run(project="p"), _DisabledRun)


def test_default_is_enabled():
    assert config.resolve_mode() == "enabled"


def test_unknown_mode_raises():
    with pytest.raises(ValueError, match="mode"):
        cairn.Run(project="p", mode="offline")
