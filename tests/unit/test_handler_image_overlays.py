"""Image handler overlays — bounding boxes + segmentation masks in metadata."""

from __future__ import annotations

import base64
import io

import numpy as np
import pytest
from PIL import Image as PILImage

from cairn.sdk.handlers.image import (
    MAX_BOXES,
    MAX_MASK_B64_BYTES,
    ImageHandler,
)


@pytest.fixture
def handler() -> ImageHandler:
    return ImageHandler()


def _rgb(w: int = 16, h: int = 12) -> PILImage.Image:
    return PILImage.new("RGB", (w, h), (10, 20, 30))


def test_no_overlays_metadata_unchanged(handler):
    """Byte-for-byte: without overlays no overlay keys appear in metadata."""
    _, meta = handler.serialize(_rgb())
    assert "boxes" not in meta
    assert "masks" not in meta
    assert "class_labels" not in meta


def test_boxes_roundtrip(handler):
    boxes = [
        {
            "position": {"minX": 0.1, "minY": 0.2, "maxX": 0.5, "maxY": 0.6},
            "class_id": 1,
            "label": "cat",
            "score": 0.9,
        }
    ]
    _, meta = handler.serialize(
        _rgb(), boxes=boxes, class_labels={0: "bg", 1: "cat"}
    )
    assert len(meta["boxes"]) == 1
    b = meta["boxes"][0]
    assert b["domain"] == "fraction"  # default
    assert b["position"] == {"minX": 0.1, "minY": 0.2, "maxX": 0.5, "maxY": 0.6}
    assert b["class_id"] == 1
    assert b["label"] == "cat"
    assert b["score"] == 0.9
    # class_labels keys coerced to strings (JSON-safe)
    assert meta["class_labels"] == {"0": "bg", "1": "cat"}


def test_box_pixel_domain_and_optional_fields(handler):
    boxes = [
        {
            "position": {"minX": 1, "minY": 2, "maxX": 8, "maxY": 9},
            "domain": "pixel",
            "class_id": 0,
        }
    ]
    _, meta = handler.serialize(_rgb(), boxes=boxes)
    b = meta["boxes"][0]
    assert b["domain"] == "pixel"
    assert b["label"] is None
    assert b["score"] is None
    # No class_labels supplied -> key omitted
    assert "class_labels" not in meta


def test_box_bad_domain_raises(handler):
    boxes = [{"position": {"minX": 0, "minY": 0, "maxX": 1, "maxY": 1}, "domain": "nope"}]
    with pytest.raises(ValueError, match="domain must be"):
        handler.serialize(_rgb(), boxes=boxes)


def test_box_missing_position_raises(handler):
    with pytest.raises(ValueError, match="missing 'position'"):
        handler.serialize(_rgb(), boxes=[{"class_id": 1}])


def test_boxes_cap_enforced(handler):
    boxes = [
        {"position": {"minX": 0, "minY": 0, "maxX": 1, "maxY": 1}, "class_id": 0}
        for _ in range(MAX_BOXES + 1)
    ]
    with pytest.raises(ValueError, match="too many boxes"):
        handler.serialize(_rgb(), boxes=boxes)


def test_masks_roundtrip(handler):
    mask = np.zeros((12, 16), dtype=np.uint8)
    mask[2:6, 3:9] = 1
    mask[7:10, 10:14] = 2
    _, meta = handler.serialize(
        _rgb(), masks={"seg": mask}, class_labels={1: "cat", 2: "dog"}
    )
    entry = meta["masks"]["seg"]
    assert entry["class_labels"] == {"1": "cat", "2": "dog"}
    # Decode the base64 PNG back and confirm the class ids survived.
    png = base64.b64decode(entry["png_b64"])
    back = np.asarray(PILImage.open(io.BytesIO(png)))
    assert back.shape == (12, 16)
    assert set(np.unique(back).tolist()) == {0, 1, 2}
    np.testing.assert_array_equal(back, mask)


def test_mask_non_2d_raises(handler):
    with pytest.raises(ValueError, match="2D array"):
        handler.serialize(_rgb(), masks={"seg": np.zeros((4, 4, 3), dtype=np.uint8)})


def test_mask_out_of_range_raises(handler):
    with pytest.raises(ValueError, match="in \\[0, 255\\]"):
        handler.serialize(_rgb(), masks={"seg": np.array([[300]], dtype=np.int32)})


def test_mask_too_large_raises(handler):
    # A large incompressible random mask should exceed the 2MB base64 cap.
    big = (np.random.rand(4000, 4000) * 255).astype(np.uint8)
    with pytest.raises(ValueError, match="too large"):
        handler.serialize(_rgb(), masks={"seg": big})
    assert MAX_MASK_B64_BYTES == 2 * 1024 * 1024
