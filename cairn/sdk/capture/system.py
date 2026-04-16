"""Background system metrics sampler (CPU/mem/disk/net/GPU/process)."""

from __future__ import annotations

import logging
import os
import subprocess
import threading
import time
from typing import Any, Callable

import psutil

from ..handlers._optional import try_import

log = logging.getLogger(__name__)


def _safe_nice(delta: int) -> None:
    """Lower our scheduling priority on Unix to avoid perturbing training."""
    try:
        if hasattr(os, "nice"):
            os.nice(delta)
    except OSError:
        pass


class _NvmlSession:
    """Thin wrapper around pynvml that gracefully no-ops when unavailable."""

    def __init__(self) -> None:
        self._nvml = None
        self._device_count = 0
        self._handles: list[Any] = []
        self._init()

    def _init(self) -> None:
        mod = try_import("pynvml")
        if mod is None:
            return
        try:
            mod.nvmlInit()
            self._device_count = mod.nvmlDeviceGetCount()
            self._handles = [
                mod.nvmlDeviceGetHandleByIndex(i) for i in range(self._device_count)
            ]
            self._nvml = mod
        except Exception:  # noqa: BLE001
            self._nvml = None

    @property
    def available(self) -> bool:
        return self._nvml is not None

    def sample(self) -> dict[int, dict[str, float]]:
        if not self.available:
            return {}
        nv = self._nvml
        out: dict[int, dict[str, float]] = {}
        for i, h in enumerate(self._handles):
            try:
                util = nv.nvmlDeviceGetUtilizationRates(h)
                mem = nv.nvmlDeviceGetMemoryInfo(h)
                temp = nv.nvmlDeviceGetTemperature(h, nv.NVML_TEMPERATURE_GPU)
                try:
                    power = nv.nvmlDeviceGetPowerUsage(h) / 1000.0  # mW→W
                except Exception:  # noqa: BLE001
                    power = 0.0
                try:
                    fan = nv.nvmlDeviceGetFanSpeed(h)
                except Exception:  # noqa: BLE001
                    fan = None
                out[i] = {
                    "util_percent": float(util.gpu),
                    "memory_used_gb": mem.used / 1e9,
                    "memory_util_percent": float(mem.used) / float(mem.total) * 100.0,
                    "temperature_c": float(temp),
                    "power_watts": float(power),
                }
                if fan is not None:
                    out[i]["fan_percent"] = float(fan)
            except Exception:  # noqa: BLE001
                continue
        return out


def _smi_sample() -> dict[int, dict[str, float]]:
    """nvidia-smi subprocess fallback."""
    try:
        out = subprocess.check_output(
            [
                "nvidia-smi",
                "--query-gpu=index,utilization.gpu,memory.used,memory.total,"
                "temperature.gpu,power.draw,fan.speed",
                "--format=csv,noheader,nounits",
            ],
            stderr=subprocess.DEVNULL,
            timeout=3,
            text=True,
        )
    except (subprocess.SubprocessError, FileNotFoundError, OSError):
        return {}
    result: dict[int, dict[str, float]] = {}
    for line in out.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 7:
            continue
        try:
            idx, util, mem_used, mem_total, temp, power, fan = parts
            result[int(idx)] = {
                "util_percent": float(util),
                "memory_used_gb": float(mem_used) / 1024.0,  # MiB → GiB
                "memory_util_percent": float(mem_used) / float(mem_total) * 100.0,
                "temperature_c": float(temp),
                "power_watts": float(power) if power not in ("", "[N/A]") else 0.0,
                "fan_percent": float(fan) if fan not in ("", "[N/A]") else 0.0,
            }
        except (ValueError, ZeroDivisionError):
            continue
    return result


class SystemMetricsCollector(threading.Thread):
    """Periodically sample system metrics and emit via a callback."""

    def __init__(
        self,
        track: Callable[[str, float], None],
        interval: float = 10.0,
        *,
        include_per_core: bool = False,
    ):
        super().__init__(daemon=True, name="cairn-sysmetrics")
        self._track = track
        self._interval = interval
        # NB: don't name this ``_stop`` — threading.Thread._stop is a private
        # method the parent class calls inside join(), and an attribute here
        # would shadow it (TypeError: 'Event' object is not callable).
        self._stop_event = threading.Event()
        self._include_per_core = include_per_core
        self._proc = psutil.Process(os.getpid())
        self._nvml = _NvmlSession()
        # Delta caches.
        self._last_disk: psutil._common.sdiskio | None = None
        self._last_net: psutil._common.snetio | None = None
        self._last_time: float | None = None

    def stop(self) -> None:
        self._stop_event.set()

    def sample_once(self) -> None:
        now = time.time()
        # CPU
        util = psutil.cpu_percent(interval=None)
        self._track("system.cpu.util_percent", util)
        if self._include_per_core:
            for i, v in enumerate(psutil.cpu_percent(interval=None, percpu=True)):
                self._track(f"system.cpu.per_core_util_percent.{i}", v)
        # Load avg (Unix only)
        if hasattr(os, "getloadavg"):
            try:
                l1, l5, l15 = os.getloadavg()
                self._track("system.cpu.load_1m", l1)
                self._track("system.cpu.load_5m", l5)
                self._track("system.cpu.load_15m", l15)
            except OSError:
                pass
        # Memory
        vm = psutil.virtual_memory()
        self._track("system.memory.used_gb", vm.used / 1e9)
        self._track("system.memory.total_gb", vm.total / 1e9)
        self._track("system.memory.util_percent", vm.percent)
        try:
            sw = psutil.swap_memory()
            self._track("system.memory.swap_used_gb", sw.used / 1e9)
        except Exception:  # noqa: BLE001
            pass
        # Disk + network delta
        try:
            disk = psutil.disk_io_counters()
        except Exception:  # noqa: BLE001
            disk = None
        try:
            net = psutil.net_io_counters()
        except Exception:  # noqa: BLE001
            net = None
        if self._last_time is not None and (disk or net):
            dt = max(now - self._last_time, 1e-6)
            if disk and self._last_disk:
                self._track(
                    "system.disk.read_mb_per_sec",
                    (disk.read_bytes - self._last_disk.read_bytes) / 1e6 / dt,
                )
                self._track(
                    "system.disk.write_mb_per_sec",
                    (disk.write_bytes - self._last_disk.write_bytes) / 1e6 / dt,
                )
            if net and self._last_net:
                self._track(
                    "system.network.recv_mb_per_sec",
                    (net.bytes_recv - self._last_net.bytes_recv) / 1e6 / dt,
                )
                self._track(
                    "system.network.sent_mb_per_sec",
                    (net.bytes_sent - self._last_net.bytes_sent) / 1e6 / dt,
                )
        self._last_disk = disk
        self._last_net = net
        self._last_time = now
        # Process
        try:
            pcpu = self._proc.cpu_percent(interval=None)
            pmem = self._proc.memory_info().rss / 1e9
            self._track("system.process.cpu_percent", pcpu)
            self._track("system.process.memory_gb", pmem)
            self._track("system.process.num_threads", float(self._proc.num_threads()))
        except Exception:  # noqa: BLE001
            pass
        # GPU
        gpu_stats = self._nvml.sample() or _smi_sample()
        for idx, stats in gpu_stats.items():
            for key, val in stats.items():
                self._track(f"system.gpu.{idx}.{key}", val)

    def run(self) -> None:
        _safe_nice(10)
        while not self._stop_event.is_set():
            try:
                self.sample_once()
            except Exception:  # noqa: BLE001
                log.exception("system metrics sample failed")
            if self._stop_event.wait(timeout=self._interval):
                return
