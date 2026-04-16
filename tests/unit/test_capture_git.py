"""Git capture tests — real git repo under tmp_path."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from cairn.sdk.capture.git import capture_git


def _have_git() -> bool:
    return shutil.which("git") is not None


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    if not _have_git():
        pytest.skip("git not available")
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    # minimal identity to allow commits
    subprocess.run(["git", "config", "user.email", "t@t"], cwd=tmp_path, check=True)
    subprocess.run(["git", "config", "user.name", "t"], cwd=tmp_path, check=True)
    (tmp_path / "a.txt").write_text("one\n")
    subprocess.run(["git", "add", "."], cwd=tmp_path, check=True)
    subprocess.run(
        ["git", "commit", "-q", "-m", "init"], cwd=tmp_path, check=True
    )
    return tmp_path


def test_clean_repo(repo):
    info = capture_git(repo)
    assert info is not None
    assert info["dirty"] is False
    assert len(info["sha"]) == 40
    assert info["branch"]  # some branch name, e.g. "master" or "main"
    assert info["diff"] == ""


def test_dirty_repo_captures_diff(repo):
    (repo / "a.txt").write_text("two\n")
    info = capture_git(repo)
    assert info["dirty"] is True
    assert "one" in info["diff"] or "two" in info["diff"]


def test_non_repo_returns_none(tmp_path):
    non = tmp_path / "nogit"
    non.mkdir()
    assert capture_git(non) is None
