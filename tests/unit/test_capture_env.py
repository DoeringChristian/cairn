"""Environment capture tests."""

from __future__ import annotations

from unittest.mock import patch

from cairn.sdk.capture import env


def test_pip_freeze_hash_is_stable(monkeypatch):
    def fake_check_output(*a, **kw):
        return "numpy==1.24.0\nhttpx==0.27.0\n"

    monkeypatch.setattr(env.subprocess, "check_output", fake_check_output)
    _, h1 = env.pip_freeze()
    _, h2 = env.pip_freeze()
    assert h1 == h2 and h1 != ""


def test_pip_freeze_hash_stable_under_reorder(monkeypatch):
    calls = {"n": 0}

    def fake(*a, **kw):
        calls["n"] += 1
        if calls["n"] == 1:
            return "numpy==1.24.0\nhttpx==0.27.0\n"
        return "httpx==0.27.0\nnumpy==1.24.0\n"  # reordered

    monkeypatch.setattr(env.subprocess, "check_output", fake)
    _, h1 = env.pip_freeze()
    _, h2 = env.pip_freeze()
    assert h1 == h2


def test_pip_freeze_swallows_errors(monkeypatch):
    def raiser(*a, **kw):
        raise OSError("pip missing")

    monkeypatch.setattr(env.subprocess, "check_output", raiser)
    txt, h = env.pip_freeze()
    assert (txt, h) == ("", "")


def test_detect_cuda_no_torch_no_smi(monkeypatch):
    monkeypatch.setattr(env, "try_import", lambda name: None)

    def no_smi(*a, **kw):
        raise FileNotFoundError

    monkeypatch.setattr(env.subprocess, "check_output", no_smi)
    info = env.detect_cuda()
    assert info["cuda_available"] is False
    assert info["gpu_names"] == []


def test_detect_cuda_via_smi(monkeypatch):
    monkeypatch.setattr(env, "try_import", lambda name: None)

    def smi(*a, **kw):
        return "NVIDIA A100\nNVIDIA A100\n"

    monkeypatch.setattr(env.subprocess, "check_output", smi)
    info = env.detect_cuda()
    assert info["cuda_available"] is True
    assert info["gpu_names"] == ["NVIDIA A100", "NVIDIA A100"]


def test_capture_env_basic_fields(monkeypatch):
    monkeypatch.setattr(env, "pip_freeze", lambda: ("", ""))
    monkeypatch.setattr(env, "detect_cuda", lambda: {"cuda_available": False, "cuda_version": None, "gpu_names": []})
    info = env.capture_env()
    for k in ("python_version", "platform", "hostname", "user", "cli_args"):
        assert k in info
