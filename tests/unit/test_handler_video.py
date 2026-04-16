"""Video handler — MP4 write via imageio-ffmpeg."""

from __future__ import annotations

import numpy as np
import pytest

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
