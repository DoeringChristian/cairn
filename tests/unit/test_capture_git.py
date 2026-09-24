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


def test_remote_is_captured_without_credentials(repo):
    subprocess.run(
        ["git", "remote", "add", "origin", "https://user:tok@github.com/o/r.git"],
        cwd=repo, check=True,
    )
    assert capture_git(repo)["remote"] == "https://github.com/o/r.git"


def test_no_remote_is_none(repo):
    assert capture_git(repo)["remote"] is None


def test_diff_text_lists_untracked_files(repo):
    from cairn.sdk.capture.git import diff_text

    (repo / "a.txt").write_text("two\n")
    (repo / "new.py").write_text("x = 1\n")
    info = capture_git(repo)
    assert info["untracked"] == ["new.py"]
    text = diff_text(info)
    assert "+two" in text
    assert text.endswith("# Untracked files:\n#   new.py\n")
    assert len(diff_text(info, max_bytes=10).encode()) <= 10


def test_run_uploads_diff_and_remote(repo, monkeypatch):
    import cairn

    subprocess.run(
        ["git", "remote", "add", "origin", "git@github.com:o/r.git"], cwd=repo, check=True,
    )
    (repo / "a.txt").write_text("two\n")
    monkeypatch.chdir(repo)
    store = repo.parent / "store"
    with cairn.Run(
        repo=store, project="p", capture_stdout=False,
        capture_env=False, capture_system_metrics=False,
    ) as run:
        rid = run.id

    reader = cairn.Reader(repo=store)
    try:
        r = reader.run(rid)
        assert r.git.remote == "git@github.com:o/r.git"
        assert r.git.dirty is True
        assert "+two" in r.artifact("git.diff")
    finally:
        reader.close()
