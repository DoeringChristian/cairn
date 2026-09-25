"""A list of media of one kind under one name and step is ONE gallery point,
for every media kind (see cairn.sdk.gallery)."""

from __future__ import annotations

import json

import numpy as np
import pytest

import cairn
from cairn.sdk.gallery import GALLERY_MIME, GALLERY_TYPES, resolve_gallery
from cairn.sdk.handlers import default_registry
from cairn.sdk.reader import MediaRef

QUIET = dict(capture_source=False, capture_stdout=False, capture_env=False, capture_system_metrics=False)


@pytest.fixture(autouse=True)
def _reset_active_run():
    from cairn.sdk.capture import stdout as scap

    scap._active_run_id = None
    yield
    scap._active_run_id = None


@pytest.fixture
def repo(tmp_path):
    return tmp_path / ".cairn"


def _points(repo, run_id, name):
    reader = cairn.Reader(repo=repo)
    try:
        return list(reader.run(run_id).sequence(name))
    finally:
        reader.close()


def _manifest(repo, point):
    reader = cairn.Reader(repo=repo)
    try:
        return json.loads(reader._backend.get_artifact_bytes(point.artifact_hash))
    finally:
        reader.close()


def _rgb(seed):
    return np.random.default_rng(seed).random((8, 8, 3)).astype(np.float32)


def _track(repo, value, name="g", step=0, **kwargs):
    with cairn.Run(project="gal", repo=repo, **QUIET) as run:
        run.track(value, name, step, **kwargs)
    return run.id


# One case per kind: a list of wrappers (and raw values where a kind is
# auto-detected) → (the list, its object_type).
def _cases():
    pts = np.random.default_rng(0).random((20, 3)).astype(np.float32)
    mesh = {"vertices": np.eye(3, dtype=np.float32), "faces": np.array([[0, 1, 2]])}
    cases = {
        "image": [cairn.Image(_rgb(0)), cairn.Image(_rgb(1))],
        "text": [cairn.Text("one"), cairn.Text("two")],
        "html": [cairn.Html("<b>a</b>"), cairn.Html("<i>b</i>")],
        "markdown": [cairn.Markdown("# a"), cairn.Markdown("*b*")],
        "audio": [cairn.Audio(np.zeros(800, np.float32), sample_rate=8000),
                  cairn.Audio(np.ones(400, np.float32) * 0.1, sample_rate=8000)],
        "histogram": [cairn.Histogram(np.arange(10.0)), cairn.Histogram(np.arange(5.0))],
        "tensor": [cairn.Tensor(np.eye(3)), cairn.Tensor(np.ones((2, 2)))],
        "pointcloud": [cairn.PointCloud(pts), cairn.PointCloud(pts * 2)],
        "mesh": [cairn.Mesh(**mesh), cairn.Mesh(**mesh, colors=np.ones((3, 3), np.float32))],
        "boxes3d": [cairn.Boxes3D(mins=np.zeros((2, 3)), maxs=np.ones((2, 3))),
                    cairn.Boxes3D(mins=np.zeros((1, 3)), maxs=np.ones((1, 3)) * 2)],
        "volume": [cairn.Volume(np.zeros((4, 4, 4), np.float32)), cairn.Volume(np.ones((4, 4, 4), np.float32))],
    }
    return cases


@pytest.mark.parametrize("kind", sorted(_cases()))
def test_a_list_of_one_kind_is_one_gallery_point(repo, kind):
    value = _cases()[kind]
    run_id = _track(repo, value)
    (point,) = _points(repo, run_id, "g")
    assert point.object_type == kind
    manifest = _manifest(repo, point)
    assert len(manifest["items"]) == len(value)
    assert json.loads(point.artifact_metadata)["gallery"] == len(value)
    for item in manifest["items"]:
        assert set(item) >= {"hash", "mime_type", "metadata"}
        assert "caption" not in item

    reader = cairn.Reader(repo=repo)
    try:
        run = reader.run(run_id)
        refs = run.media("g")
        assert isinstance(refs, list) and len(refs) == len(value)
        assert all(isinstance(r, MediaRef) and r.object_type == kind for r in refs)
        decoded = run.artifact("g")
        assert isinstance(decoded, list) and len(decoded) == len(value)
        assert [r.load() for r in refs][0] is not None
    finally:
        reader.close()


def test_every_gallery_type_has_a_case():
    assert GALLERY_TYPES - {"figure", "video"} == set(_cases())


@pytest.mark.media
def test_figure_galleries_raw_and_wrapped(repo):
    go = pytest.importorskip("plotly.graph_objects")
    plt = pytest.importorskip("matplotlib.pyplot")
    figs = [go.Figure(go.Scatter(y=[1, 2, 3])), go.Figure(go.Bar(y=[3, 1]))]
    mpl = plt.figure()
    plt.plot([0, 1], [1, 0])
    with cairn.Run(project="gal", repo=repo, **QUIET) as run:
        run.track(figs, "raw", 0)
        run.track([cairn.Figure(f, caption=f"#{i}") for i, f in enumerate(figs)], "wrapped", 0)
        run.track([mpl, figs[0]], "mixed_libs", 0)  # both detected as figures
    plt.close(mpl)
    for name in ("raw", "wrapped", "mixed_libs"):
        (point,) = _points(repo, run.id, name)
        assert point.object_type == "figure"
        items = _manifest(repo, point)["items"]
        assert len(items) == 2
    wrapped = _manifest(repo, _points(repo, run.id, "wrapped")[0])["items"]
    assert [i["caption"] for i in wrapped] == ["#0", "#1"]
    # Each Plotly item keeps its interactive source as an artifact of its own.
    reader = cairn.Reader(repo=repo)
    try:
        for item in wrapped:
            assert item["metadata"]["source_format"] == "plotly_json"
            assert reader._backend.get_artifact_bytes(item["metadata"]["source_hash"])
    finally:
        reader.close()


@pytest.mark.media
def test_video_gallery_and_a_list_of_frames_stays_a_video(repo):
    pytest.importorskip("imageio_ffmpeg")
    frames = (np.random.default_rng(0).random((4, 16, 16, 3)) * 255).astype(np.uint8)
    with cairn.Run(project="gal", repo=repo, **QUIET) as run:
        run.track([cairn.Video(frames, fps=4), cairn.Video(frames[::-1], fps=4)], "clips", 0)
        run.track(list(frames), "frames", 0)  # a list of raw frames is ONE video
    (clips,) = _points(repo, run.id, "clips")
    assert clips.object_type == "video"
    assert [i["mime_type"] for i in _manifest(repo, clips)["items"]] == ["video/mp4", "video/mp4"]
    (video,) = _points(repo, run.id, "frames")
    assert video.object_type == "video"
    assert "gallery" not in json.loads(video.artifact_metadata)


def test_captions_per_item_and_per_point(repo):
    run_id = _track(repo, [cairn.Text("a", caption="first"), cairn.Text("b")], caption="both")
    (point,) = _points(repo, run_id, "g")
    assert point.caption == "both"
    assert [i.get("caption") for i in _manifest(repo, point)["items"]] == ["first", None]
    reader = cairn.Reader(repo=repo)
    try:
        assert [r.caption for r in reader.run(run_id).media("g")] == ["first", None]
    finally:
        reader.close()


def test_track_keywords_apply_to_every_item(repo):
    run_id = _track(repo, [cairn.Audio(np.zeros(100, np.float32)), cairn.Audio(np.zeros(100, np.float32), sample_rate=4000)],
                    sample_rate=8000)
    (point,) = _points(repo, run_id, "g")
    rates = [i["metadata"]["sample_rate"] for i in _manifest(repo, point)["items"]]
    assert rates == [8000, 8000]


def test_mixed_kinds_are_an_error(repo):
    with cairn.Run(project="gal", repo=repo, **QUIET) as run:
        with pytest.raises(ValueError, match="one media type.*html.*image"):
            run.track([cairn.Image(_rgb(0)), cairn.Html("<p/>")], "g", 0)


@pytest.mark.parametrize("value", [
    [1.0, 2.0, 3.0],
    ["a", "b"],
    [{"a": 1}],
    [[1, 2], [3, 4]],
    [cairn.Text("x"), "raw"],
])
def test_plain_lists_are_not_galleries(repo, value):
    assert resolve_gallery(default_registry, value) is None
    with cairn.Run(project="gal", repo=repo, **QUIET) as run:
        with pytest.raises(TypeError, match="No handler for value of type list"):
            run.track(value, "g", 0)


def test_non_media_kinds_are_not_galleries(repo):
    table = cairn.Table(columns=["a"], data=[[1]])
    with cairn.Run(project="gal", repo=repo, **QUIET) as run:
        with pytest.raises(TypeError, match="not a gallery"):
            run.track([table, table], "g", 0)


def test_rules_on_a_gallery_are_an_error(repo):
    with cairn.Run(project="gal", repo=repo, **QUIET) as run:
        with pytest.raises(ValueError, match="scalar metrics only"):
            run.track([cairn.Text("a")], "g", 0, summary="max")
        with pytest.raises(ValueError, match="scalar metrics only"):
            run.track([cairn.Text("a")], "g", 0, x="epoch")


def test_single_item_list_is_a_gallery(repo):
    run_id = _track(repo, (cairn.Markdown("# only"),))
    (point,) = _points(repo, run_id, "g")
    assert point.object_type == "markdown"
    assert len(_manifest(repo, point)["items"]) == 1


def test_single_value_media_ref(repo):
    run_id = _track(repo, cairn.Text("solo"))
    reader = cairn.Reader(repo=repo)
    try:
        ref = reader.run(run_id).media("g")
        assert isinstance(ref, MediaRef) and ref.load() == "solo"
    finally:
        reader.close()


def test_gallery_mime_is_generic():
    assert GALLERY_MIME == "application/vnd.cairn.gallery+json"
