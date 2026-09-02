"""Cairn browser shells prefer cairn-plot's WebGPU image backend."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from cairn.server.app import _browser_shell, create_app


_UI = Path(__file__).resolve().parents[2] / "cairn" / "ui"


def test_no_webgpu_app_serves_cpu_override(tmp_path: Path) -> None:
    app = create_app(data_dir=tmp_path / ".cairn", disable_webgpu=True)
    with TestClient(app) as client:
        response = client.get("/")
    assert response.status_code == 200
    assert '__cairnPlotRenderMode="cpu"' in response.text


def test_no_webgpu_shell_override_precedes_the_app_module(tmp_path: Path) -> None:
    shell = tmp_path / "index.html"
    shell.write_text(
        '<html><head><script type="module" src="/app.js"></script></head></html>',
        encoding="utf-8",
    )
    rendered = _browser_shell(shell, disable_webgpu=True).decode()
    override_at = rendered.index('__cairnPlotRenderMode="cpu"')
    assert override_at < rendered.index("</head>")
    assert _browser_shell(shell, disable_webgpu=False) == shell.read_bytes()


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
