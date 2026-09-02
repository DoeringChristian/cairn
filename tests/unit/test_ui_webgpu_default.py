"""Cairn browser shells prefer cairn-plot's WebGPU image backend."""

from __future__ import annotations

from pathlib import Path

import pytest


_UI = Path(__file__).resolve().parents[2] / "cairn" / "ui"


@pytest.mark.parametrize("shell", ["index.html", "plot.html", "embed.html"])
@pytest.mark.parametrize("root", [_UI, _UI / "dist"], ids=["source", "built"])
def test_browser_shell_prefers_webgpu_with_explicit_override(root: Path, shell: str) -> None:
    html = (root / shell).read_text(encoding="utf-8")
    config_at = html.index("__cairnPlotRenderMode")
    mount_at = html.index('type="module"')

    # Source keeps the config visibly before the entry module. Vite hoists the
    # built module tag into <head>, but module scripts are deferred, so the
    # classic inline body script still executes before the app module.
    if root == _UI:
        assert config_at < mount_at, "backend preference must run before the app module"
    assert '__cairnPlotRenderMode = "gpu"' in html
    assert '["cpu", "gpu", "auto"].includes(renderMode)' in html
