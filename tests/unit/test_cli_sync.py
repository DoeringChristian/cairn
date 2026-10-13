"""`cairn sync [PATH...] [--clean]`: foreground upload; --clean never deletes
anything the server has not confirmed or that is not finished."""

from __future__ import annotations

#: Test the client alone, without the server stand-in (tests/standin_server.py).
STANDIN = False

from click.testing import CliRunner

from cairn.cli import main
from cairn.sdk.runlog.rundir import RunDir
from cairn.sdk.runlog.writer import RunWriter

from .fake_ingest import FakeIngest
from .test_uploader import make_run


def test_sync_uploads_and_clean_deletes_only_complete_dirs(tmp_path, monkeypatch) -> None:
    served = FakeIngest().serve()
    try:
        base = tmp_path / "cd"
        done = make_run(base, "done", server=served.url)
        unfinished = make_run(base, "unfinished", server=served.url, finish=False)
        live = make_run(base, "live", server=served.url, finish=False)
        writer = RunWriter(live, "live")  # still being written
        offline = make_run(base, "offline", server="http://127.0.0.1:9")
        result = CliRunner().invoke(main, ["sync", str(base), "--clean"])
        assert result.exit_code == 1, result.output  # "offline" failed
        assert not done.path.exists()
        for rd in (unfinished, live, offline):
            assert rd.path.exists(), rd.path
        assert "offline: FAILED" in result.output
        assert unfinished.log().acked() == unfinished.log().last_seq()  # uploaded, kept
        assert offline.log().acked() == 0
        assert served.fake.applied[("done", "main")] > 0 and not served.fake.violations
        writer.close()
    finally:
        served.close()


def test_clean_keeps_a_finished_dir_with_unacked_records(tmp_path) -> None:
    rd = make_run(tmp_path / "cd", "r", server="http://127.0.0.1:9")
    assert rd.log().finished() is not None
    result = CliRunner().invoke(main, ["sync", str(rd.path), "--clean"])
    assert result.exit_code == 1
    assert rd.path.exists() and "kept (not fully confirmed" in result.output


def test_clean_after_a_server_override(tmp_path) -> None:
    served = FakeIngest().serve()
    try:
        rd = make_run(tmp_path / "cd", "r", server="http://127.0.0.1:9")
        result = CliRunner().invoke(main, ["sync", str(tmp_path / "cd"), "--server", served.url, "--clean"])
        assert result.exit_code == 0, result.output
        assert not rd.path.exists()
        assert served.fake.applied[("r", "main")] > 0
    finally:
        served.close()


def test_sync_defaults_to_cairn_dir(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("CAIRN_DIR", str(tmp_path / "nothing"))
    result = CliRunner().invoke(main, ["sync"])
    assert result.exit_code == 0 and "nothing to sync" in result.output


def test_sync_rejects_a_path_without_runs(tmp_path) -> None:
    result = CliRunner().invoke(main, ["sync", str(tmp_path)])
    assert result.exit_code != 0 and "no run directories" in result.output


def test_complete_requires_every_log(tmp_path) -> None:
    rd = make_run(tmp_path / "cd", "r")
    make_run(tmp_path / "cd", "r", label="w1", finish=False)
    for ref in rd.logs():
        ref.set_acked(ref.last_seq())
    assert not RunDir(rd.path).complete()  # w1 never detached
