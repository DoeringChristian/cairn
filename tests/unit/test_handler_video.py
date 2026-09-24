"""Video handler — MP4 write via imageio-ffmpeg."""

from __future__ import annotations

import io

import numpy as np
import pytest
from PIL import Image as PILImage

from cairn.sdk.handlers.video import VideoHandler


@pytest.mark.media
def test_mp4_writes_and_is_reabable():
    pytest.importorskip("imageio_ffmpeg")
    imageio = pytest.importorskip("imageio")
    h = VideoHandler()
    frames = (np.random.default_rng(0).integers(0, 255, size=(10, 32, 48, 3))).astype(np.uint8)
    data, meta = h.serialize(frames, fps=15)
    assert data[4:8] == b"ftyp"  # MP4 magic
    assert meta["num_frames"] == 10
    assert meta["width"] == 48
    assert meta["height"] == 32
    assert meta["fps"] == 15
    assert meta["preview"].startswith("data:image/png;base64,")

    # Read back via imageio to confirm playable — write to a temp file
    # because the ffmpeg backend needs a real path.
    import tempfile
    from pathlib import Path

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        tmp.write(data)
        tmp_path = Path(tmp.name)
    try:
        reader = imageio.get_reader(str(tmp_path), format="FFMPEG")
        _first = reader.get_data(0)
        reader.close()
    finally:
        tmp_path.unlink(missing_ok=True)


def test_can_handle_requires_4d_and_dep_available():
    h = VideoHandler()
    # 3D arrays are not videos.
    assert not h.can_handle(np.zeros((10, 10, 3), dtype=np.uint8))


@pytest.mark.media
def test_can_handle_4d():
    pytest.importorskip("imageio_ffmpeg")
    h = VideoHandler()
    assert h.can_handle(np.zeros((2, 4, 4, 3), dtype=np.uint8))


@pytest.mark.media
def test_float_frames_are_unit_range_not_black():
    import base64

    pytest.importorskip("imageio_ffmpeg")
    frames = np.full((4, 16, 16, 3), 0.5, np.float32)
    _, meta = VideoHandler().serialize(frames, fps=4)
    preview = PILImage.open(io.BytesIO(base64.b64decode(meta["preview"].split(",", 1)[1])))
    assert abs(int(np.asarray(preview).mean()) - 128) <= 2


@pytest.mark.media
@pytest.mark.parametrize(
    "frames",
    [
        np.full((4, 3, 16, 24), 128, np.uint8),        # T×C×H×W (torch layout)
        np.full((4, 16, 24), 128, np.uint8),           # T×H×W grayscale
        np.full((4, 16, 24, 4), 128, np.uint8),        # RGBA: alpha dropped
        [np.full((3, 16, 24), 128, np.uint8)] * 4,     # list of CHW frames
    ],
)
def test_frame_layouts_become_hwc_rgb(frames):
    pytest.importorskip("imageio_ffmpeg")
    _, meta = VideoHandler().serialize(frames, fps=4)
    assert (meta["width"], meta["height"], meta["channels"]) == (24, 16, 3)


@pytest.mark.media
def test_torch_tchw_tensor():
    torch = pytest.importorskip("torch")
    pytest.importorskip("imageio_ffmpeg")
    _, meta = VideoHandler().serialize(torch.full((4, 3, 16, 24), 0.5), fps=4)
    assert (meta["width"], meta["height"]) == (24, 16)


@pytest.mark.media
def test_existing_file_is_stored_as_is(tmp_path):
    pytest.importorskip("imageio_ffmpeg")
    h = VideoHandler()
    data, _ = h.serialize(np.full((6, 16, 32, 3), 90, np.uint8), fps=6)
    clip = tmp_path / "clip.mp4"
    clip.write_bytes(data)
    stored, meta = h.serialize(clip)
    assert stored == data
    assert h.mime_type_for(str(clip)) == "video/mp4"
    assert meta["filename"] == "clip.mp4" and meta["width"] == 32 and meta["preview"].startswith("data:image/png")
    assert h.deserialize(stored, meta).shape[1:] == (16, 32, 3)


def test_missing_file_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        VideoHandler().serialize(tmp_path / "nope.mp4")
