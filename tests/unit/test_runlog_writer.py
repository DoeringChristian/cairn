"""The run log writer: group commit, single ownership, reopening, segments,
concurrent reading, blobs."""

from __future__ import annotations

#: Test the client alone, without the server stand-in (tests/standin_server.py).
STANDIN = False

import os
import subprocess
import sys
import textwrap
import threading
import time
from pathlib import Path

import pytest

from cairn.sdk.runlog import codec
from cairn.sdk.runlog.blobs import verify_blob, write_blob
from cairn.sdk.runlog.log import (
    CorruptLog,
    LogLocked,
    LogReader,
    LogWriter,
    scan,
    segment_paths,
    sync_interval,
)


def _durable(log_dir: Path) -> list[int]:
    """The seqs on disk right now (another reader's view)."""
    return [r["seq"] for r in scan(log_dir).records]


def test_append_is_buffered_and_committed_within_the_interval(tmp_path) -> None:
    w = LogWriter(tmp_path / "log", interval=0.1)
    try:
        seq = w.append("x", {"i": 1})
        assert seq == 1
        deadline = time.monotonic() + 1.0
        while _durable(tmp_path / "log") != [1]:
            assert time.monotonic() < deadline, "not durable within the group-commit interval"
            time.sleep(0.01)
        while w.durable_seq != 1:  # set right after the fsync returns
            assert time.monotonic() < deadline
            time.sleep(0.01)
    finally:
        w.close()


def test_append_reaches_the_os_and_flush_is_immediate(tmp_path) -> None:
    """An appended record is in the file at once (a killed process loses
    nothing); ``flush`` fsyncs it now instead of at the next interval."""
    w = LogWriter(tmp_path / "log", interval=60)
    try:
        for i in range(5):
            w.append("x", {"i": i})
        assert _durable(tmp_path / "log") == [1, 2, 3, 4, 5]
        assert w.durable_seq == 0
        assert w.flush() == 5
        assert _durable(tmp_path / "log") == [1, 2, 3, 4, 5]
    finally:
        w.close()


def test_interval_env(monkeypatch) -> None:
    monkeypatch.setenv("CAIRN_SYNC_INTERVAL_MS", "250")
    assert sync_interval() == 0.25


def test_close_commits(tmp_path) -> None:
    w = LogWriter(tmp_path / "log", interval=60)
    w.append("a")
    w.close()
    assert _durable(tmp_path / "log") == [1]
    with pytest.raises(RuntimeError):
        w.append("b")


def test_single_writer_in_process(tmp_path) -> None:
    w = LogWriter(tmp_path / "log")
    try:
        with pytest.raises(LogLocked):
            LogWriter(tmp_path / "log")
    finally:
        w.close()
    LogWriter(tmp_path / "log").close()  # free again


def test_single_writer_across_processes(tmp_path) -> None:
    code = textwrap.dedent(f"""
        import sys, time
        from cairn.sdk.runlog.log import LogWriter
        w = LogWriter({str(tmp_path / 'log')!r})
        print("locked", flush=True)
        time.sleep(30)
    """)
    p = subprocess.Popen([sys.executable, "-c", code], stdout=subprocess.PIPE, text=True)
    try:
        assert p.stdout.readline().strip() == "locked"
        with pytest.raises(LogLocked):
            LogWriter(tmp_path / "log")
    finally:
        p.kill()
        p.wait()
    LogWriter(tmp_path / "log").close()  # a dead writer's lock is gone


def test_reopen_continues_and_drops_a_torn_tail(tmp_path) -> None:
    w = LogWriter(tmp_path / "log")
    for i in range(3):
        w.append("x", {"i": i})
    w.close()
    seg = segment_paths(tmp_path / "log")[-1]
    with open(seg, "ab") as fh:
        fh.write(b"\x10\x00\x00")  # a crash mid-append
    w = LogWriter(tmp_path / "log")
    assert w.last_seq == 3
    assert w.append("y") == 4
    w.close()
    res = scan(tmp_path / "log")
    assert [r["seq"] for r in res.records] == [1, 2, 3, 4] and not res.torn


def test_reopen_refuses_damage_before_the_tail(tmp_path) -> None:
    w = LogWriter(tmp_path / "log", segment_bytes=200)
    for i in range(10):
        w.append("x", {"pad": "p" * 50})
    w.close()
    first = segment_paths(tmp_path / "log")[0]
    data = bytearray(first.read_bytes())
    data[20] ^= 1
    first.write_bytes(bytes(data))
    with pytest.raises(CorruptLog):
        LogWriter(tmp_path / "log")


def test_base_seq_of_a_new_log(tmp_path) -> None:
    w = LogWriter(tmp_path / "log", base_seq=41)
    assert w.append("x") == 42
    w.close()
    assert _durable(tmp_path / "log") == [42]


def test_segments_rotate_and_read_back_in_order(tmp_path) -> None:
    w = LogWriter(tmp_path / "log", segment_bytes=1000)
    for i in range(200):
        w.append("x", {"i": i})
        if i % 17 == 0:
            w.flush()
    w.close()
    assert len(segment_paths(tmp_path / "log")) > 5
    for p in segment_paths(tmp_path / "log"):
        assert p.read_bytes()[:7] == codec.MAGIC
    r = LogReader(tmp_path / "log")
    out: list[dict] = []
    while batch := r.read(out[-1]["seq"] if out else 0, max_bytes=300):
        out += batch
    assert [x["seq"] for x in out] == list(range(1, 201))
    assert r.error is None


def test_reader_follows_a_live_writer(tmp_path) -> None:
    w = LogWriter(tmp_path / "log", interval=0.005, segment_bytes=4000)
    n = 3000

    def produce() -> None:
        for i in range(n):
            w.append("x", {"i": i, "pad": "z" * (i % 40)})
        w.close()

    t = threading.Thread(target=produce)
    t.start()
    r = LogReader(tmp_path / "log")
    seen: list[int] = []
    deadline = time.monotonic() + 30
    while len(seen) < n:
        assert time.monotonic() < deadline
        batch = r.read(seen[-1] if seen else 0, max_bytes=2000)
        assert r.error is None
        seen += [x["seq"] for x in batch]
    t.join()
    assert seen == list(range(1, n + 1))


def test_reader_rewinds_when_asked_for_earlier_records(tmp_path) -> None:
    w = LogWriter(tmp_path / "log")
    for _ in range(10):
        w.append("x")
    w.close()
    r = LogReader(tmp_path / "log")
    assert [x["seq"] for x in r.read(0)] == list(range(1, 11))
    assert [x["seq"] for x in r.read(4)] == list(range(5, 11))


def test_before_commit_hook_keeps_order(tmp_path) -> None:
    pending: list[int] = []
    holder: dict = {}

    def drain() -> None:
        if pending:
            holder["w"].append_from_hook("batch", {"points": list(pending)})
            pending.clear()

    w = LogWriter(tmp_path / "log", interval=60, before_commit=drain)
    holder["w"] = w
    pending.extend([1, 2])
    w.append("params")  # the points tracked before it land before it
    pending.append(3)
    w.close()
    assert [(r["op"], r.get("points")) for r in scan(tmp_path / "log").records] == [
        ("batch", [1, 2]), ("params", None), ("batch", [3])]


def test_durable_after_a_crash_without_flush(tmp_path) -> None:
    """os._exit skips every exit hook: what the group commit wrote survives."""
    code = textwrap.dedent(f"""
        import os, time
        from cairn.sdk.runlog.log import LogWriter
        w = LogWriter({str(tmp_path / 'log')!r}, interval=0.05)
        for i in range(100):
            w.append("x", {{"i": i}})
        time.sleep(0.4)
        w.append("lost?")
        os._exit(0)
    """)
    subprocess.run([sys.executable, "-c", code], check=True)
    seqs = _durable(tmp_path / "log")
    assert seqs[:100] == list(range(1, 101))


# ---- blobs ------------------------------------------------------------------------


def test_blob_written_atomically_and_deduplicated(tmp_path) -> None:
    d = tmp_path / "blobs"
    h = write_blob(d, b"hello")
    assert (d / h).read_bytes() == b"hello" and verify_blob(d / h, h)
    mtime = (d / h).stat().st_mtime_ns
    assert write_blob(d, b"hello") == h
    assert (d / h).stat().st_mtime_ns == mtime
    assert [p.name for p in d.iterdir()] == [h]  # no temp file left


def test_blob_replaces_a_torn_one(tmp_path) -> None:
    d = tmp_path / "blobs"
    d.mkdir()
    import hashlib

    h = hashlib.sha256(b"payload").hexdigest()
    (d / h).write_bytes(b"pay")  # never happens via write_blob, but must heal
    assert write_blob(d, b"payload") == h
    assert verify_blob(d / h, h)


def test_blob_tmp_files_are_not_blobs(tmp_path, monkeypatch) -> None:
    """A crash mid-write leaves only a temp file, never a blob under its hash."""
    import cairn.sdk.runlog.blobs as blobs

    def boom(*a, **k):
        raise OSError("disk full")

    monkeypatch.setattr(blobs.os, "replace", boom)
    with pytest.raises(OSError):
        write_blob(tmp_path / "b", b"data")
    assert not any(p.name[0] != "." for p in (tmp_path / "b").iterdir())
    assert not list((tmp_path / "b").iterdir())  # and the temp file is cleaned up


def test_signal_finishes_the_run_durably(tmp_path) -> None:
    """SIGTERM: the run records 'killed' and its log is fsynced."""
    code = textwrap.dedent("""
        import os, signal, cairn
        run = cairn.Run("p", capture_system_metrics=False, capture_source=False,
                        capture_stdout=False)
        print(run.id, flush=True)
        for i in range(50):
            run.track(float(i), "loss", i)
        os.kill(os.getpid(), signal.SIGTERM)
    """)
    env = {**os.environ, "CAIRN_DIR": str(tmp_path / "cd"), "CAIRN_UPLOADER": "off",
           "CAIRN_REPO": str(tmp_path / "repo"), "CAIRN_AGENT_DIR": str(tmp_path / "ag")}
    p = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True)
    assert p.returncode == -15, p.stderr
    run_id = p.stdout.strip()
    recs = scan(tmp_path / "repo" / "runs" / run_id / "log").records
    points = [pt["step"] for r in recs if r["op"] == "batch" for pt in r["points"]]
    assert points == list(range(50))
    assert recs[-1]["op"] == "finish" and recs[-1]["status"] == "killed"


def _script_records(tmp_path, body: str) -> tuple[subprocess.CompletedProcess, list[dict]]:
    code = textwrap.dedent("""
        import os, signal, cairn
        run = cairn.Run("p", capture_system_metrics=False, capture_source=False,
                        capture_stdout=False)
        print(run.id, flush=True)
        for i in range(50):
            run.track(float(i), "loss", i)
    """) + textwrap.dedent(body)
    env = {**os.environ, "CAIRN_DIR": str(tmp_path / "cd"), "CAIRN_UPLOADER": "off",
           "CAIRN_REPO": str(tmp_path / "repo"), "CAIRN_AGENT_DIR": str(tmp_path / "ag"),
           # A long interval: only the exit path can have committed the points.
           "CAIRN_SYNC_INTERVAL_MS": "60000"}
    p = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True)
    run_id = p.stdout.split()[0]
    return p, scan(tmp_path / "repo" / "runs" / run_id / "log").records


def _points(recs: list[dict]) -> list[int]:
    return [pt["step"] for r in recs if r["op"] == "batch" for pt in r["points"]]


def test_sigint_finishes_the_run_durably(tmp_path) -> None:
    p, recs = _script_records(tmp_path, "os.kill(os.getpid(), signal.SIGINT)\n")
    assert p.returncode != 0 and "KeyboardInterrupt" in p.stderr
    assert _points(recs) == list(range(50))
    assert recs[-1]["op"] == "finish" and recs[-1]["status"] == "killed"


def test_interpreter_exit_finishes_the_run(tmp_path) -> None:
    """No finish() call: the atexit hook records 'completed' and commits."""
    p, recs = _script_records(tmp_path, "")
    assert p.returncode == 0, p.stderr
    assert _points(recs) == list(range(50))
    assert recs[-1]["op"] == "finish" and recs[-1]["status"] == "completed"


def test_unhandled_exception_finishes_the_run_failed(tmp_path) -> None:
    p, recs = _script_records(tmp_path, "raise RuntimeError('boom')\n")
    assert p.returncode == 1 and "boom" in p.stderr
    assert _points(recs) == list(range(50))
    assert recs[-1]["op"] == "finish" and recs[-1]["status"] == "failed"


def test_sigterm_with_a_long_interval_still_commits(tmp_path) -> None:
    p, recs = _script_records(tmp_path, "os.kill(os.getpid(), signal.SIGTERM)\n")
    assert p.returncode == -15, p.stderr
    assert _points(recs) == list(range(50))
    assert recs[-1]["status"] == "killed"
