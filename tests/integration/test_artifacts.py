"""Versioned artifacts end to end, every test on BOTH backends (a local repo
and a live server): builder entry kinds, shorthand, aliases, lineage,
download semantics, WAL-mode pending versions."""

from __future__ import annotations

import json
import logging
import pickle
from pathlib import Path

import numpy as np
import pytest

import cairn

QUIET = dict(capture_source=False, capture_stdout=False, capture_env=False,
             capture_system_metrics=False)


@pytest.fixture(params=["local", "http"])
def repo(request, tmp_path, monkeypatch):
    """A repo target string; the cwd is a scratch dir (downloads, caches)."""
    work = tmp_path / "work"
    work.mkdir()
    monkeypatch.chdir(work)
    monkeypatch.delenv("CAIRN_ARTIFACT_DIR", raising=False)
    if request.param == "local":
        return str(tmp_path / ".cairn")
    live = request.getfixturevalue("live_server")
    monkeypatch.setenv("CAIRN_WAL_DIR", str(tmp_path / "wal"))
    return live.replace("http://", "cairn://")


def _run(repo, name=None, project="p", **kw):
    return cairn.Run(project, name=name, repo=repo, **QUIET, **kw)


@pytest.fixture
def reader(repo):
    r = cairn.Reader(repo, cache=False)
    yield r
    r.close()


# ---------------------------------------------------------------------------
# Objects (the shorthand)
# ---------------------------------------------------------------------------

def test_object_round_trip(repo, reader):
    state = {"w": np.arange(6, dtype=np.float32).reshape(2, 3), "epoch": 3}
    arr = np.linspace(0, 1, 100)  # 1-D: once mistaken for audio
    with _run(repo, "producer") as run:
        v = run.log_artifact(state, "ckpt", type="model", step=3, metadata={"val": 0.5},
                             description="after epoch 3").wait()
        a = run.log_artifact(arr, "signal").wait()
    assert (v.ref, v.qualified_ref, v.type, v.project) == ("ckpt:v1", "p/ckpt:v1", "model", "p")
    assert (v.step, v.metadata, v.description, v.aliases) == (3, {"val": 0.5}, "after epoch 3", ["latest"])
    assert v.digest and len(v.digest) == 64 and v.size > 0
    (entry,) = v.files()
    assert (entry.path, entry.object_type, entry.mime) == ("ckpt.pkl", "pickle", "application/python-pickle")

    with _run(repo, "consumer") as run:
        got = run.use_artifact("ckpt").get()
        sig = run.use_artifact("signal:v1").get()
    assert got["epoch"] == 3 and np.array_equal(got["w"], state["w"])
    assert isinstance(sig, np.ndarray) and np.array_equal(sig, arr)

    back = reader.artifact("ckpt:latest", project="p")
    assert (back.ref, back.step, back.metadata, back.description) == ("ckpt:v1", 3, {"val": 0.5}, "after epoch 3")
    assert back.logged_by().name == "producer"


def test_torch_state_dict_round_trip(repo):
    torch = pytest.importorskip("torch")
    model = torch.nn.Linear(3, 2)
    with _run(repo) as run:
        run.log_artifact(model.state_dict(), "net", type="model")
        loaded = run.use_artifact("net").get()
    assert torch.equal(loaded["weight"], model.state_dict()["weight"])


def test_every_call_is_a_new_version(repo, reader):
    with _run(repo) as run:
        a = run.log_artifact(b"same", "blob").wait()
        b = run.log_artifact(b"same", "blob").wait()
    assert (a.version, b.version) == (1, 2)
    assert a.digest == b.digest
    assert [v.version for v in reader.artifact_versions("blob", project="p")] == [1, 2]


# ---------------------------------------------------------------------------
# The builder: every entry kind
# ---------------------------------------------------------------------------

def _tree(root: Path) -> Path:
    (root / "train" / "sub").mkdir(parents=True)
    (root / "train" / "a.txt").write_text("A")
    (root / "train" / "sub" / "b.bin").write_bytes(b"\x00\x01")
    (root / "train" / ".hidden").write_text("h")
    (root / "labels.json").write_text('{"0": "cat"}')
    return root


def test_builder_entry_kinds(repo, reader, tmp_path):
    src = _tree(tmp_path / "src")
    art = cairn.Artifact("cifar", type="dataset", description="train split",
                         metadata={"n": 2})
    art.add_dir(src / "train", name="train")
    art.add_file(src / "labels.json")
    art.add_reference(str(src / "labels.json"), name="ref/labels.json")
    art.add_reference("s3://bucket/raw.tar", size=9, etag="abc")
    art.add({"mean": 0.5}, "stats.pkl")
    art.add(cairn.Text("hello"), "note.txt")
    art.add(b"\x00raw", "raw.bin")
    with art.new_file("made.json") as f:
        json.dump({"k": 1}, f)
    with art.new_file("made.bin", mode="wb") as f:
        f.write(b"\xff\xfe")
    staged = [e.path for e in art.files()]
    assert "train/.hidden" in staged and "train/sub/b.bin" in staged

    with _run(repo, "maker") as run:
        v = run.log_artifact(art, aliases=["norm"]).wait()
    assert (v.name, v.type, v.description, v.metadata) == ("cifar", "dataset", "train split", {"n": 2})
    assert v.aliases == ["latest", "norm"]
    files = {e.path: e for e in v.files()}
    assert sorted(files) == sorted([
        "train/a.txt", "train/sub/b.bin", "train/.hidden", "labels.json", "ref/labels.json",
        "raw.tar", "stats.pkl", "note.txt", "raw.bin", "made.json", "made.bin",
    ])
    assert files["raw.tar"].uri == "s3://bucket/raw.tar" and files["raw.tar"].digest is None
    assert (files["raw.tar"].size, files["raw.tar"].etag) == (9, "abc")
    assert files["ref/labels.json"].is_reference and files["ref/labels.json"].size == 12
    assert files["train/a.txt"].mime == "text/plain"
    # Size counts uploaded bytes only (references excluded).
    assert v.size == sum(e.size for e in files.values() if e.digest)

    back = reader.artifact("cifar:norm", project="p")
    assert back.get("stats.pkl") == {"mean": 0.5}
    assert back.get("note.txt") == "hello"
    assert back.get("raw.bin") == b"\x00raw"
    assert back.get("train/sub/b.bin") == b"\x00\x01"
    assert json.load(back.open("made.json", "r")) == {"k": 1}
    assert back.open("made.bin").read() == b"\xff\xfe"
    assert back.get_entry("labels.json").read() == b'{"0": "cat"}'
    assert back.get("ref/labels.json") == b'{"0": "cat"}'  # a local reference reads through
    with pytest.raises(ValueError, match="entries"):
        back.get()
    with pytest.raises(KeyError):
        back.get_entry("nope")


def test_builder_errors(tmp_path):
    art = cairn.Artifact("x")
    art.add(b"1", "a.bin")
    with pytest.raises(ValueError, match="already has an entry"):
        art.add(b"2", "a.bin")
    with pytest.raises(FileNotFoundError):
        art.add_file(tmp_path / "missing")
    with pytest.raises(ValueError, match="unsafe"):
        art.add(b"1", "../escape")
    art.add(b"1", "d/x")
    art.add(b"1", "d/y")
    art.remove("d")
    assert [e.path for e in art.files()] == ["a.bin"]
    with pytest.raises(KeyError):
        art.remove("d")
    with pytest.raises(ValueError):
        cairn.Artifact("a:b")
    with pytest.raises(ValueError):
        cairn.Artifact("a/b")
    with pytest.raises(TypeError):
        cairn.Artifact({"old": "pickle wrapper usage"})  # now cairn.Pickle


def test_draft_with_extra_arguments_and_shorthand_errors(repo):
    with _run(repo) as run:
        art = cairn.Artifact("x")
        art.add(b"1", "a")
        with pytest.raises(TypeError, match="cairn.Artifact"):
            run.log_artifact(art, "other")
        with pytest.raises(TypeError, match="cairn.Artifact"):
            run.log_artifact(art, type="model")
        with pytest.raises(TypeError, match="name"):
            run.log_artifact({"a": 1})
        with pytest.raises(FileNotFoundError):
            run.log_artifact("does/not/exist.pt", "ckpt")
        with pytest.raises(ValueError):
            run.log_artifact(cairn.Artifact("empty"))


def test_shorthand_paths(repo, tmp_path):
    src = _tree(tmp_path / "src")
    with _run(repo) as run:
        d = run.log_artifact(src / "train", "train-dir").wait()
        f = run.log_artifact(str(src / "labels.json"), "labels").wait()
    assert sorted(e.path for e in d.files()) == [".hidden", "a.txt", "sub/b.bin"]
    assert [e.path for e in f.files()] == ["labels.json"]
    assert f.get() == b'{"0": "cat"}'


def test_family_keeps_one_type(repo):
    with _run(repo) as run:
        run.log_artifact(b"1", "thing", type="model").wait()
        with pytest.raises(ValueError, match="type"):
            run.log_artifact(b"2", "thing", type="dataset")


# ---------------------------------------------------------------------------
# Aliases
# ---------------------------------------------------------------------------

def test_aliases(repo, reader):
    with _run(repo) as run:
        v1 = run.log_artifact(b"1", "ckpt", aliases=["best"]).wait()
        v2 = run.log_artifact(b"2", "ckpt").wait()
        v3 = run.log_artifact(b"3", "ckpt", aliases=["best"]).wait()
        with pytest.raises(ValueError, match="reserved"):
            run.log_artifact(b"4", "ckpt", aliases=["latest"])
        with pytest.raises(ValueError, match="reserved"):
            run.log_artifact(b"4", "ckpt", aliases=["v7"])
    assert v1.aliases == ["latest", "best"]  # snapshot at log time
    assert v2.aliases == ["latest"]
    assert v3.aliases == ["latest", "best"]
    # latest always moves; best moved to v3 when reassigned.
    assert [(v.version, v.aliases) for v in reader.artifact_versions("ckpt", project="p")] == [
        (1, []), (2, []), (3, ["latest", "best"]),
    ]
    assert reader.artifact("ckpt:best", project="p").version == 3

    old = reader.artifact("ckpt:v1", project="p")
    old.add_alias("best")
    assert old.aliases == ["best"]
    assert reader.artifact("ckpt:best", project="p").version == 1
    old.add_alias("prod")
    old.remove_alias("prod")
    assert old.aliases == ["best"]
    with pytest.raises(LookupError):
        reader.artifact("ckpt:prod", project="p")
    for bad in ("latest", "v2"):
        with pytest.raises(ValueError, match="reserved"):
            old.add_alias(bad)
        with pytest.raises(ValueError, match="reserved"):
            old.remove_alias(bad)

    (fam,) = reader.artifact_families("p")
    assert (fam.name, fam.versions, fam.aliases) == ("ckpt", 3, {"best": 1, "latest": 3})
    assert fam.version("best").version == 1
    assert [v.version for v in fam.versions_list()] == [1, 2, 3]


# ---------------------------------------------------------------------------
# Lineage
# ---------------------------------------------------------------------------

def test_lineage(repo, reader):
    with _run(repo, "base") as base:
        v = base.log_artifact(b"w", "base-ckpt", type="model", aliases=["best"]).wait()
        base_id = base.id
    with _run(repo, "other", project="q") as other:
        q = other.log_artifact(b"d", "data", type="dataset").wait()
    with _run(repo, "residual") as res:
        got = res.use_artifact("base-ckpt:best")
        again = res.use_artifact(got)  # idempotent
        res.use_artifact("q/data", role="dataset")
        res.log_artifact(b"r", "residual-ckpt")
        res_id = res.id
    assert got == again == v

    back = reader.artifact("base-ckpt:best", project="p")
    assert back.logged_by().id == base_id
    assert [r.name for r in back.used_by()] == ["residual"]
    assert back.used_by(role="dataset") == []
    run = reader.run(res_id)
    assert [x.qualified_ref for x in run.used_artifacts()] == ["p/base-ckpt:v1", "q/data:v1"]
    assert [x.ref for x in run.used_artifacts(role="dataset")] == ["data:v1"]
    assert [x.ref for x in run.logged_artifacts()] == ["residual-ckpt:v1"]
    assert reader.artifact("q/data").ref == q.ref
    graph = reader.lineage("p")
    assert {(e["kind"], e.get("role")) for e in graph["edges"]} == {
        ("produced", None), ("consumed", "input"),
    }
    with pytest.raises(LookupError):
        reader.artifact("nope", project="p")


def test_run_less_version(repo, reader, tmp_path):
    src = _tree(tmp_path / "src")
    v = cairn.log_artifact(src / "train", "raw", type="dataset", project="P Q", repo=repo,
                           aliases=["first"])
    assert (v.project, v.ref, v.aliases) == ("p-q", "raw:v1", ["latest", "first"])
    assert v.logged_by() is None
    assert reader.artifact("p-q/raw:first").get("a.txt") == b"A"


# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------

def test_download(repo, reader, tmp_path, monkeypatch, caplog):
    src = _tree(tmp_path / "src")
    art = cairn.Artifact("ds", type="dataset")
    art.add_dir(src / "train")
    art.add_reference(str(src / "labels.json"), name="labels.json")
    art.add_reference("nosuchscheme://bucket/raw.tar", size=9)
    with _run(repo) as run:
        run.log_artifact(art)
    v = reader.artifact("ds", project="p")

    with caplog.at_level(logging.WARNING):
        root = v.download()
    assert root == Path("artifacts/ds-v1")
    assert (root / "a.txt").read_text() == "A"
    assert (root / "sub" / "b.bin").read_bytes() == b"\x00\x01"
    assert (root / "labels.json").read_text() == '{"0": "cat"}'  # a readable reference
    assert not (root / "raw.tar").exists()
    assert "skipped reference" in caplog.text and "raw.tar" in caplog.text

    # A re-download fetches nothing that is already there with the right digest.
    fetched: list[str] = []
    real = v._backend.get_artifact_bytes
    monkeypatch.setattr(v._backend, "get_artifact_bytes", lambda d: fetched.append(d) or real(d))
    (root / "a.txt").write_text("tampered")
    v.download()
    assert (root / "a.txt").read_text() == "A"
    assert len(fetched) == 1

    monkeypatch.setenv("CAIRN_ARTIFACT_DIR", str(tmp_path / "store"))
    p = v.file("sub/b.bin")
    assert p == tmp_path / "store" / "ds-v1" / "sub" / "b.bin" and p.read_bytes() == b"\x00\x01"
    assert v.get_entry("a.txt").download(tmp_path / "x") == tmp_path / "x" / "a.txt"
    with pytest.raises(OSError):
        v.file("raw.tar")
    assert v.download(tmp_path / "explicit") == tmp_path / "explicit"


# ---------------------------------------------------------------------------
# WAL mode
# ---------------------------------------------------------------------------

def test_local_version_is_pending_until_wait(tmp_path):
    """A local run only logs the version: it is pending until the repo
    ingests the log; ``wait()`` catches up and fills it in."""
    repo = tmp_path / ".cairn"
    with cairn.Run("p", repo=repo, **QUIET) as run:
        v = run.log_artifact({"a": 1}, "ckpt", step=2, aliases=["best"])
        assert v.pending and v.version is None
        with pytest.raises(RuntimeError, match="pending"):
            v.files()
        with pytest.raises(ValueError, match="reserved"):
            run.log_artifact(b"x", "ckpt", aliases=["latest"])
        assert v.wait(timeout=30) is v
        assert not v.pending and (v.version, v.step) == (1, 2)
        assert sorted(v.aliases) == ["best", "latest"]
        assert v.get() == {"a": 1}
        # use_artifact catches up on this run's own log first.
        assert run.use_artifact("ckpt:best").id == v.id
    with cairn.Reader(repo) as reader:
        back = reader.artifact("ckpt:best", project="p")
        assert (back.version, back.step, back.id) == (1, 2, v.id)
        assert back.logged_by().id == run.id
        assert [r.id for r in back.used_by()] == [run.id]


def test_http_version_wait_returns_at_once(live_server, tmp_path, monkeypatch):
    monkeypatch.setenv("CAIRN_WAL_DIR", str(tmp_path / "wal"))
    with cairn.Run("p", repo=live_server.replace("http://", "cairn://"), **QUIET) as run:
        v = run.log_artifact(b"x", "blob")
        assert not v.pending and v.version == 1
        assert v.wait(timeout=0) is v


def test_pickle_wrapper_tracks():
    assert cairn.Pickle({"a": 1}).object_type == "pickle"
    assert pickle.loads(pickle.dumps({"a": 1})) == {"a": 1}


# ---------------------------------------------------------------------------
# Tags, edits, deletes
# ---------------------------------------------------------------------------

def test_tags(repo, reader):
    art = cairn.Artifact("tagged", tags=["raw"])
    art.add(b"1", "a.bin")
    with _run(repo) as run:
        v = run.log_artifact(art, tags=["candidate", "raw"]).wait()
        w = run.log_artifact(b"2", "tagged", tags=["candidate"]).wait()
        with pytest.raises(ValueError):
            run.log_artifact(b"3", "tagged", tags=[""])
    assert v.tags == ["raw", "candidate"] and w.tags == ["candidate"]  # tags may repeat across versions
    back = reader.artifact("tagged:v1", project="p")
    back.add_tag("reviewed")
    back.add_tag("reviewed")
    back.remove_tag("raw")
    assert back.tags == ["candidate", "reviewed"]
    assert reader.artifact("tagged:v1", project="p").tags == ["candidate", "reviewed"]


def test_update_description_and_metadata(repo, reader):
    with _run(repo) as run:
        run.log_artifact(b"1", "notes", metadata={"a": 1, "b": 2}, description="first")
    v = reader.artifact("notes", project="p")
    v.update(description="second", metadata={"b": 3, "c": None})
    assert (v.description, v.metadata) == ("second", {"a": 1, "b": 3, "c": None})
    v.update(metadata={"d": 4})
    assert reader.artifact("notes", project="p").metadata == {"a": 1, "b": 3, "c": None, "d": 4}
    assert reader.artifact("notes", project="p").description == "second"


def test_delete_versions_and_artifacts(repo, reader):
    with _run(repo) as run:
        run.log_artifact(b"1", "ckpt", aliases=["best"])
        run.log_artifact(b"2", "ckpt")
        run.log_artifact(b"3", "ckpt")
    with _run(repo, "user") as user:
        user.use_artifact("ckpt:v2")

    v2 = reader.artifact("ckpt:v2", project="p")
    v2.delete()                                         # no alias: fine; its consumption goes too
    assert [v.version for v in reader.artifact_versions("ckpt", project="p")] == [1, 3]
    v3 = reader.artifact("ckpt:latest", project="p")
    with pytest.raises(ValueError, match="aliases"):
        v3.delete()                                     # "latest" names it
    v3.delete(force=True)
    assert reader.artifact("ckpt:latest", project="p").version == 1  # latest moved back
    with _run(repo) as run:
        assert run.log_artifact(b"4", "ckpt").wait().version == 4  # numbers are never reused
    with pytest.raises(LookupError):
        reader.artifact("ckpt:v3", project="p")

    (fam,) = [f for f in reader.artifact_families("p") if f.name == "ckpt"]
    fam.delete()
    assert [f.name for f in reader.artifact_families("p")] == []
    with pytest.raises(LookupError):
        reader.artifact("ckpt", project="p")
