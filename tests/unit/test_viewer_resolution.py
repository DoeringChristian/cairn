"""How cairn-track finds (or fails to find) the cairn-ui viewer bundle."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from cairn import viewer
from cairn.server.app import create_app


def _bundle(root: Path, *, assets: bool = True) -> Path:
    """A minimally complete bundle: an index shell plus an assets directory."""
    root.mkdir(parents=True, exist_ok=True)
    (root / viewer.INDEX).write_text("<html><head></head><body>ui</body></html>")
    if assets:
        (root / "assets").mkdir(exist_ok=True)
    return root


def test_override_wins_over_the_installed_package(tmp_path, monkeypatch) -> None:
    mine = _bundle(tmp_path / "mine")
    monkeypatch.setenv("CAIRN_UI_DIST", str(mine))
    assert viewer.dist_path() == mine


def test_an_incomplete_override_serves_nothing_rather_than_crashing(
    tmp_path, monkeypatch
) -> None:
    """The regression that motivated the "complete" predicate.

    StaticFiles(directory=...) raises at APP-CONSTRUCTION time, so a bundle with
    an index but no assets/ used to take down create_app() rather than degrade.
    """
    half = _bundle(tmp_path / "half", assets=False)
    monkeypatch.setenv("CAIRN_UI_DIST", str(half))

    assert viewer.dist_path() is None
    app = create_app(data_dir=tmp_path / "cairn", mount_ui=True)  # must not raise
    assert TestClient(app).get("/").json()["status"] == "no_ui"


def test_a_bad_override_never_falls_back_to_the_installed_bundle(
    tmp_path, monkeypatch
) -> None:
    """An override that can be silently overruled is not an override."""
    monkeypatch.setenv("CAIRN_UI_DIST", str(tmp_path / "does-not-exist"))
    assert viewer.dist_path() is None


def test_no_viewer_anywhere_yields_a_placeholder_naming_the_extra(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.delenv("CAIRN_UI_DIST", raising=False)
    monkeypatch.setattr(viewer, "_from_installed_package", lambda: None)
    monkeypatch.setattr(viewer, "_from_dev_checkout", lambda: None)

    assert not viewer.is_available()
    app = create_app(data_dir=tmp_path / "cairn", mount_ui=True)
    body = TestClient(app).get("/").json()
    assert body["status"] == "no_ui"
    assert "cairn-track[ui]" in body["message"]


def test_the_default_app_registers_no_spa_catch_all(tmp_path) -> None:
    """Without mount_ui nothing may answer an arbitrary path with HTML."""
    app = create_app(data_dir=tmp_path / "cairn")
    assert TestClient(app).get("/definitely-not-a-route").status_code == 404


def test_shell_serves_the_bundle_bytes_unchanged(tmp_path, monkeypatch) -> None:
    bundle = _bundle(tmp_path / "b")
    monkeypatch.setenv("CAIRN_UI_DIST", str(bundle))
    assert viewer.shell(viewer.INDEX) == (bundle / "index.html").read_bytes()


def test_shell_rejects_a_name_that_is_not_a_known_entry(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("CAIRN_UI_DIST", str(_bundle(tmp_path / "b")))
    with pytest.raises(ValueError, match="unknown viewer shell"):
        viewer.shell("../../etc/passwd")
