"""cairn init CLI tests."""

from __future__ import annotations

from click.testing import CliRunner

from cairn import cli


def test_init_creates_repo(tmp_path):
    runner = CliRunner()
    result = runner.invoke(cli.main, ["init", str(tmp_path)])
    assert result.exit_code == 0, result.output
    repo = tmp_path / ".cairn"
    assert (repo / "cairn.db").exists()
    assert (repo / "artifacts").is_dir()
    assert (repo / "sources").is_dir()
    assert (repo / "logs").is_dir()
    assert (repo / "version").exists()
    assert "Initialized empty" in result.output


def test_init_idempotent(tmp_path):
    runner = CliRunner()
    runner.invoke(cli.main, ["init", str(tmp_path)])
    result = runner.invoke(cli.main, ["init", str(tmp_path)])
    assert result.exit_code == 0
    assert "already initialized" in result.output


def test_init_default_is_cwd(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    runner = CliRunner()
    result = runner.invoke(cli.main, ["init"])
    assert result.exit_code == 0, result.output
    assert (tmp_path / ".cairn" / "cairn.db").exists()
