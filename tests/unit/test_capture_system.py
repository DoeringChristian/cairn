"""System metrics sampler tests."""

from __future__ import annotations

import time
from unittest.mock import MagicMock

import pytest

from cairn.sdk.capture import system as sysmod


def test_sample_once_emits_expected_metric_names(monkeypatch):
    collected: list[str] = []

    def track(name, value):
        collected.append(name)

    coll = sysmod.SystemMetricsCollector(track=track, interval=60.0)
    # First sample populates deltas; second sample computes them.
    coll.sample_once()
    coll.sample_once()
    # Must include at least these:
    assert "system.cpu.util_percent" in collected
    assert "system.memory.util_percent" in collected
    assert any(n.startswith("system.memory.") for n in collected)
    assert any(n.startswith("system.process.") for n in collected)


def test_nvml_failure_does_not_break_sampling(monkeypatch):
    # Force try_import("pynvml") to return a fake module that raises at init.
    fake = MagicMock()
    fake.nvmlInit.side_effect = RuntimeError("no nvidia")
    monkeypatch.setattr(sysmod, "try_import", lambda name: fake if name == "pynvml" else None)

    # _smi_sample must also fail so we hit the empty path.
    monkeypatch.setattr(sysmod, "_smi_sample", lambda: {})

    collected: list[str] = []

    coll = sysmod.SystemMetricsCollector(track=lambda n, v: collected.append(n), interval=60.0)
    coll.sample_once()
    # No GPU metrics emitted but we got CPU/mem ones.
    assert not any(n.startswith("system.gpu.") for n in collected)


def test_smi_fallback_emits_gpu_metrics(monkeypatch):
    monkeypatch.setattr(sysmod, "try_import", lambda name: None)
    # Pretend nvidia-smi worked and returned one GPU.
    monkeypatch.setattr(
        sysmod,
        "_smi_sample",
        lambda: {
            0: {
                "util_percent": 50.0,
                "memory_used_gb": 2.0,
                "memory_util_percent": 20.0,
                "temperature_c": 55.0,
                "power_watts": 120.0,
                "fan_percent": 30.0,
            }
        },
    )
    names: list[str] = []
    coll = sysmod.SystemMetricsCollector(track=lambda n, v: names.append(n), interval=60.0)
    coll.sample_once()
    assert "system.gpu.0.util_percent" in names
    assert "system.gpu.0.temperature_c" in names


def test_thread_runs_and_stops():
    received = []
    coll = sysmod.SystemMetricsCollector(
        track=lambda n, v: received.append(n), interval=0.05
    )
    coll.start()
    time.sleep(0.15)
    coll.stop()
    coll.join(timeout=2.0)
    assert not coll.is_alive()
    assert received  # we collected something
