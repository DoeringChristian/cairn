"""Editing runs after the fact: ``reader.run(id).edit()`` and the rename /
delete-keys ops on every write path."""

from __future__ import annotations

import json
import os

import pytest

import cairn
from cairn.server.storage.datadir import DataDir

_RUN_KW = dict(
    capture_source=False,
    capture_stdout=False,
    capture_env=False,
    capture_system_metrics=False,
)


@pytest.fixture(autouse=True)
def _reset_capture_state():
    from cairn.sdk.capture import stdout as scap

    scap._active_run_id = None
    yield
    scap._active_run_id = None


def _seed(repo) -> str:
    with cairn.Run(project="p", name="orig", tags=["a"], repo=repo, **_RUN_KW) as run:
        run.config(lr=0.1, hparams={"wd": 0.01, "beta": 0.9}, hparams_extra=1)
        run.summary(acc=0.5, loss=1.0)
        return run.id


def _edit_and_check(repo, run_id):
    with cairn.Reader(repo) as reader:
        run = reader.run(run_id)
        with run.edit() as e:
            e.set_config(lr=0.2, new_key="x")
            e.set_summary({"acc": 0.9})
            e.delete_keys("config", ["hparams"])
            e.delete_keys("summary", ["loss"])
            e.add_tag("best")
            e.add_tag("best")
            e.remove_tag("a")
            e.rename("renamed")
            e.set_notes("hello")
        # The Run the editor came from sees the edits...
        assert run.name == "renamed" and run.tags == ["best"] and run.notes == "hello"
        assert run.config == {"lr": 0.2, "new_key": "x", "hparams_extra": 1}
        assert run.summary == {"acc": 0.9}
    # ...and so does a fresh read.
    with cairn.Reader(repo) as reader:
        run = reader.run(run_id)
        assert (run.name, run.tags, run.notes) == ("renamed", ["best"], "hello")
        assert run.config == {"lr": 0.2, "new_key": "x", "hparams_extra": 1}
        assert run.summary == {"acc": 0.9}


def test_edit_local_repo(tmp_path):
    repo = tmp_path / ".cairn"
    _edit_and_check(repo, _seed(repo))


def test_edit_over_http(live_server):
    repo = "cairn://" + live_server.removeprefix("http://")
    _edit_and_check(repo, _seed(repo))


def test_edit_local_repo_held_by_a_server_goes_over_http(tmp_path, live_server):
    # The live_server app serves tmp_path/"cairn"; claim it the way `cairn ui` does.
    served = "cairn://" + live_server.removeprefix("http://")
    run_id = _seed(served)
    host, port = live_server.removeprefix("http://").split(":")
    dd = DataDir(tmp_path / "cairn")
    dd.lock_path.write_text(json.dumps({
        "pid": os.getpid(), "mode": "ui", "host": host, "port": int(port),
        "started_at": "2026-01-01T00:00:00Z",
    }))
    with cairn.Reader(dd.root) as reader:
        with reader.run(run_id).edit() as e:
            from cairn.sdk.transport import Transport

            assert isinstance(e._transport, Transport)
            e.rename("via-server")
    with cairn.Reader(served) as reader:
        assert reader.run(run_id).name == "via-server"


def test_edit_zip_reader_raises(tmp_path):
    import zipfile

    from cairn.server.run_archive import write_archive

    repo = tmp_path / ".cairn"
    run_id = _seed(repo)
    zip_path = tmp_path / "run.zip"
    with cairn.Reader(repo) as reader, zipfile.ZipFile(zip_path, "w") as zf:
        b = reader._backend
        write_archive(b._db, b._blobs, b._dd, [run_id], zf)
    with cairn.Reader(zip_path) as reader:
        with pytest.raises(ValueError, match="exported archive"):
            reader.run(run_id).edit()


def test_delete_keys_rejects_unknown_section(tmp_path):
    repo = tmp_path / ".cairn"
    run_id = _seed(repo)
    with cairn.Reader(repo) as reader, reader.run(run_id).edit() as e:
        with pytest.raises(ValueError):
            e.delete_keys("params", ["lr"])


def test_rename_and_delete_keys_replay_from_local_wal(tmp_path):
    repo = tmp_path / ".cairn"
    with cairn.Run(project="p", name="orig", repo=repo, local_wal=True, **_RUN_KW) as run:
        run.config(lr=0.1, hparams={"wd": 0.01})
        run._transport.rename_run(run.id, "wal-renamed")
        run._transport.delete_keys(run.id, "params", ["hparams"])
        run_id = run.id
    # The Reader drains the WAL before reading; a second drain is a no-op.
    for _ in range(2):
        with cairn.Reader(repo) as reader:
            run = reader.run(run_id)
            assert run.name == "wal-renamed"
            assert run.config == {"lr": 0.1}


def test_patch_and_delete_routes(client):
    rid = client.post("/api/runs", json={"project": "p", "name": "n", "notes": "old"}).json()["run_id"]
    client.post(f"/api/runs/{rid}/params", json={"params": {"a": 1, "b": {"c": 2}, "bc": 3}})
    r = client.patch(f"/api/runs/{rid}", json={"display_name": "m"})
    assert r.status_code == 200
    run = client.get(f"/api/runs/{rid}").json()
    assert run["run"]["display_name"] == "m" and run["run"]["notes"] == "old"
    r = client.request("DELETE", f"/api/runs/{rid}/params", json={"keys": ["b"]})
    assert r.status_code == 200
    keys = {p["key"] for p in client.get(f"/api/runs/{rid}").json()["params"]}
    assert keys == {"a", "bc"}
    assert client.patch("/api/runs/nope", json={"notes": "x"}).status_code == 404
    assert client.request("DELETE", "/api/runs/nope/summary", json={"keys": ["x"]}).status_code == 404
