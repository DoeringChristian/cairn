"""cairn.Data: custom data kinds (npz / json / bytes), galleries, Reader decode."""

from __future__ import annotations

import io
import json
import zipfile

import numpy as np
import pytest

import cairn
from cairn.sdk.handlers.custom import CustomHandler

QUIET = dict(capture_source=False, capture_stdout=False, capture_env=False, capture_system_metrics=False)


@pytest.fixture(autouse=True)
def _reset_active_run():
    from cairn.sdk.capture import stdout as scap

    scap._active_run_id = None
    yield
    scap._active_run_id = None


def test_npz_layout_is_browser_readable():
    h = CustomHandler()
    payload = {
        "mu": np.arange(12, dtype=">f4").reshape(4, 3),  # big-endian → little
        "mask": np.array([True, False]),
        "f": np.asfortranarray(np.ones((2, 3))),
        "n": np.int64(3),
        "name": "lobes",
    }
    data, meta = h.serialize(payload, kind="guiding/vmf", meta={"units": "sr"})
    assert h.mime_type_for(payload) == "application/x-npz"
    assert meta["kind"] == "guiding/vmf" and meta["format"] == "npz"
    assert meta["meta"] == {"units": "sr"}
    assert meta["arrays"] == {
        "mu": {"shape": [4, 3], "dtype": "float32"},
        "mask": {"shape": [2], "dtype": "bool"},
        "f": {"shape": [2, 3], "dtype": "float64"},
    }
    assert meta["values"] == {"n": 3, "name": "lobes"}
    assert meta["size_bytes"] == len(data)
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        infos = {i.filename: i for i in zf.infolist()}
        assert set(infos) == {"mu.npy", "mask.npy", "f.npy"}
        assert all(i.compress_type == zipfile.ZIP_DEFLATED for i in infos.values())
        for name in infos:
            header = zf.read(name)[:128].decode("latin1")
            assert "'fortran_order': False" in header
            assert "'descr': '>" not in header
    out = h.deserialize(data, meta)
    assert out["n"] == 3 and out["name"] == "lobes"
    np.testing.assert_array_equal(out["mu"], np.arange(12).reshape(4, 3))


def test_json_and_bytes_formats():
    h = CustomHandler()
    data, meta = h.serialize({"a": [1, 2], "b": np.float32(0.5)}, kind="k")
    assert meta["format"] == "json" and meta["arrays"] == {} and meta["values"] == {}
    assert json.loads(data) == {"a": [1, 2], "b": 0.5}
    assert h.deserialize(data, meta) == {"a": [1, 2], "b": 0.5}
    assert h.mime_type_for([1]) == "application/json"
    data, meta = h.serialize(b"\x00raw", kind="k")
    assert meta["format"] == "bytes" and data == b"\x00raw"
    assert h.mime_type_for(b"x") == "application/octet-stream"
    assert h.deserialize(data, meta) == b"\x00raw"


@pytest.mark.parametrize("kind", ["Bad", "", "a//b", "/a", "a/", "a b", 3])
def test_invalid_kind(kind):
    with pytest.raises(ValueError, match="invalid data kind"):
        cairn.Data({}, kind=kind)


def test_rejected_payloads():
    h = CustomHandler()
    with pytest.raises(TypeError, match="dtype"):
        h.serialize({"c": np.ones(2, np.complex64)}, kind="k")
    with pytest.raises(TypeError, match="dtype"):
        h.serialize({"s": np.array(["a"]), "x": np.ones(1)}, kind="k")
    with pytest.raises(TypeError):
        h.serialize(object(), kind="k")
    with pytest.raises(TypeError, match="keys"):
        h.serialize({"a/b": np.ones(1)}, kind="k")
    with pytest.raises(ValueError):
        h.serialize({"x": float("nan")}, kind="k")
    with pytest.raises(TypeError, match="meta"):
        cairn.Data({}, kind="k", meta=[1])


def test_round_trip_through_a_run_and_reader(tmp_path):
    repo = tmp_path / ".cairn"
    with cairn.Run(project="cd", repo=repo, **QUIET) as run:
        for step in range(2):
            run.track(cairn.Data({"mu": np.full(3, step, np.float32), "n": step}, kind="guiding/vmf",
                                 caption=f"s{step}"), "guide", step)
        run.track(cairn.Data({"x": [1, 2]}, kind="j"), "j", 0)
        run.track(cairn.Data(b"abc", kind="b/raw"), "b", 0)
    reader = cairn.Reader(repo=repo)
    try:
        r = reader.run(run.id)
        ref = r.media("guide", 1)
        assert ref.object_type == "custom"
        assert ref.metadata["kind"] == "guiding/vmf"
        out = ref.load()
        assert out["n"] == 1
        np.testing.assert_array_equal(out["mu"], np.ones(3, np.float32))
        assert r.media("j", 0).load() == {"x": [1, 2]}
        assert r.media("b", 0).load() == b"abc"
        points = list(r.sequence("guide"))
        assert [p.caption for p in points] == ["s0", "s1"]
    finally:
        reader.close()


def test_gallery_is_homogeneous_by_kind(tmp_path):
    repo = tmp_path / ".cairn"
    with cairn.Run(project="cd", repo=repo, **QUIET) as run:
        run.track([cairn.Data({"a": np.zeros(2)}, kind="k/x"), cairn.Data([1], kind="k/x")], "g", 0)
        with pytest.raises(ValueError, match="one kind"):
            run.track([cairn.Data([1], kind="k/x"), cairn.Data([1], kind="k/y")], "h", 0)
    reader = cairn.Reader(repo=repo)
    try:
        (point,) = list(reader.run(run.id).sequence("g"))
        assert point.object_type == "custom"
        assert json.loads(point.artifact_metadata) == {"gallery": 2, "kind": "k/x"}
        refs = reader.run(run.id).media("g", 0)
        assert [r.metadata["kind"] for r in refs] == ["k/x", "k/x"]
        assert refs[1].load() == [1]
    finally:
        reader.close()
