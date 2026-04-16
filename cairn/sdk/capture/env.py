"""Environment capture — Python/platform/user/pip freeze/GPU info."""

from __future__ import annotations

import getpass
import hashlib
import platform
import socket
import subprocess
import sys
from typing import Any

from ..handlers._optional import try_import


def pip_freeze() -> tuple[str, str]:
    """Run ``pip freeze``, sort, hash. Returns (text, sha256)."""
    try:
        out = subprocess.check_output(
            [sys.executable, "-m", "pip", "freeze"],
            stderr=subprocess.DEVNULL,
            timeout=30,
            text=True,
        )
    except (subprocess.SubprocessError, OSError):
        return "", ""
    lines = sorted(line.strip() for line in out.splitlines() if line.strip())
    text = "\n".join(lines)
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    return text, digest


def detect_cuda() -> dict[str, Any]:
    """Best-effort GPU detection. Returns ``{cuda_available: bool, ...}``."""
    info: dict[str, Any] = {
        "cuda_available": False,
        "cuda_version": None,
        "gpu_names": [],
    }
    torch = try_import("torch")
    if torch is not None:
        try:
            info["cuda_available"] = bool(torch.cuda.is_available())
            if info["cuda_available"]:
                info["cuda_version"] = torch.version.cuda
                info["gpu_names"] = [
                    torch.cuda.get_device_name(i)
                    for i in range(torch.cuda.device_count())
                ]
                return info
        except Exception:  # noqa: BLE001
            pass

    # nvidia-smi fallback
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            stderr=subprocess.DEVNULL,
            timeout=5,
            text=True,
        )
        names = [ln.strip() for ln in out.splitlines() if ln.strip()]
        if names:
            info["cuda_available"] = True
            info["gpu_names"] = names
    except (subprocess.SubprocessError, FileNotFoundError, OSError):
        pass
    return info


def capture_env(*, include_pip_freeze: bool = True) -> dict[str, Any]:
    """Collect the full env snapshot recorded in ``runs.env_snapshot``."""
    pf_text, pf_hash = pip_freeze() if include_pip_freeze else ("", "")
    info = {
        "python_version": platform.python_version(),
        "python_implementation": platform.python_implementation(),
        "platform": platform.platform(),
        "hostname": socket.gethostname(),
        "user": _safe_user(),
        "cli_args": list(sys.argv),
        "pip_freeze_hash": pf_hash,
    }
    info.update(detect_cuda())
    info["_pip_freeze_text"] = pf_text
    return info


def _safe_user() -> str:
    try:
        return getpass.getuser()
    except Exception:  # noqa: BLE001
        return ""
