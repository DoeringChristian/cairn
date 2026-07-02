"""Demo: image bounding-box + segmentation-mask overlays.

Logs synthetic detection scenes with two object classes. Each ``detections``
image carries:

* ``boxes`` — one per object, class 1 ("cat", fraction domain) and class 2
  ("dog", pixel domain), each with a per-step confidence score.
* ``masks`` — a per-pixel class-id segmentation that evolves over steps.

It also logs a plain ``reference`` image (no overlays) so you can exercise
split/blend compare modes (overlay renders on the FOREGROUND only), and a
``plain`` sequence with no overlay at all to confirm plain images are
byte-identical to before.

Usage::

    uv run cairn init /tmp/cairn-overlays
    CAIRN_REPO=/tmp/cairn-overlays/.cairn uv run python examples/demo_image_overlays.py
    uv run cairn ui --repo /tmp/cairn-overlays/.cairn --port 4313
"""

from __future__ import annotations

import math

import numpy as np
from PIL import Image, ImageDraw

import cairn

SZ = 256
NUM_STEPS = 16
PROJECT = "image-overlays-demo"
CLASS_LABELS = {0: "background", 1: "cat", 2: "dog"}


def _object_positions(step: int) -> tuple[tuple[int, int, int, int], tuple[int, int, int, int]]:
    """Pixel bounding boxes (minX, minY, maxX, maxY) for the cat + dog objects."""
    t = step / NUM_STEPS * 2 * math.pi
    # Class 1 "cat" — a circle orbiting the center.
    cx = SZ // 2 + int(SZ * 0.22 * math.cos(t))
    cy = SZ // 2 + int(SZ * 0.22 * math.sin(t))
    r = 34
    cat = (cx - r, cy - r, cx + r, cy + r)
    # Class 2 "dog" — a square sliding horizontally.
    dx = int(SZ * 0.15 + SZ * 0.5 * (0.5 + 0.5 * math.sin(t)))
    dy = int(SZ * 0.62)
    s = 40
    dog = (dx - s, dy - s, dx + s, dy + s)
    return cat, dog


def make_scene(step: int) -> Image.Image:
    """Base RGB scene with two moving objects."""
    img = Image.new("RGB", (SZ, SZ), (18, 18, 32))
    draw = ImageDraw.Draw(img)
    for x in range(0, SZ, 32):
        draw.line([(x, 0), (x, SZ)], fill=(38, 38, 58), width=1)
    for y in range(0, SZ, 32):
        draw.line([(0, y), (SZ, y)], fill=(38, 38, 58), width=1)
    cat, dog = _object_positions(step)
    draw.ellipse(cat, fill=(70, 150, 230))
    draw.rectangle(dog, fill=(220, 90, 70))
    return img


def make_plain(step: int) -> Image.Image:
    """A visually distinct, overlay-free scene (distinct bytes so content-address
    dedup never collapses it into an annotated `detections` artifact)."""
    img = Image.new("RGB", (SZ, SZ), (32, 20, 20))
    draw = ImageDraw.Draw(img)
    for x in range(SZ):
        v = int(255 * ((x + step * 8) % SZ) / SZ)
        draw.line([(x, 0), (x, SZ)], fill=(v, v // 2, 255 - v))
    return img


def make_mask(step: int) -> np.ndarray:
    """Per-pixel class-id mask (0 bg, 1 cat, 2 dog)."""
    mask = np.zeros((SZ, SZ), dtype=np.uint8)
    cat, dog = _object_positions(step)
    yy, xx = np.mgrid[0:SZ, 0:SZ]
    ccx = (cat[0] + cat[2]) / 2
    ccy = (cat[1] + cat[3]) / 2
    cr = (cat[2] - cat[0]) / 2
    mask[(xx - ccx) ** 2 + (yy - ccy) ** 2 <= cr**2] = 1
    mask[dog[1]:dog[3], dog[0]:dog[2]] = 2
    return mask


def make_boxes(step: int) -> list[dict]:
    """Two boxes with per-step confidence scores (fraction + pixel domains)."""
    cat, dog = _object_positions(step)
    # Scores climb over time so the score-threshold slider is easy to test.
    cat_score = 0.55 + 0.4 * step / NUM_STEPS
    dog_score = 0.95 - 0.5 * step / NUM_STEPS
    return [
        {
            "position": {
                "minX": cat[0] / SZ,
                "minY": cat[1] / SZ,
                "maxX": cat[2] / SZ,
                "maxY": cat[3] / SZ,
            },
            "domain": "fraction",
            "class_id": 1,
            "label": "cat",
            "score": round(float(cat_score), 3),
        },
        {
            "position": {"minX": dog[0], "minY": dog[1], "maxX": dog[2], "maxY": dog[3]},
            "domain": "pixel",
            "class_id": 2,
            "label": "dog",
            "score": round(float(dog_score), 3),
        },
    ]


def log_run(name: str, jitter: int) -> None:
    run = cairn.Run(project=PROJECT, name=name, tags=["overlays"])
    run["config"] = {"jitter": jitter}
    for step in range(NUM_STEPS):
        scene = make_scene(step)

        # detections: image WITH boxes + mask overlays
        run.track(
            cairn.Image(
                scene,
                boxes=make_boxes(step),
                masks={"seg": make_mask(step)},
                class_labels=CLASS_LABELS,
            ),
            name="detections",
            step=step,
        )

        # reference: plain image (used as split/blend baseline)
        run.track(scene, name="reference", step=step)

        # plain: a totally overlay-free sequence (regression guard). Distinct
        # bytes so content-address dedup never reuses a `detections` artifact.
        run.track(make_plain((step + jitter) % NUM_STEPS), name="plain", step=step)

    run.finish()
    print(f"  done: {name}")


def main() -> None:
    from cairn.config import resolve_target

    target = resolve_target()
    print(f"Logging to {target.kind} at {target.location}")
    for name, jitter in [("model-a", 0), ("model-b", 3)]:
        log_run(name, jitter)
    print(
        "\nDone. Open the 'detections' image card: boxes (cat/dog) + mask overlay.\n"
        "Try the Overlays settings section (toggles, score threshold, mask opacity,\n"
        "per-class visibility). Drag the 'reference' chip as a baseline and switch to\n"
        "split/blend to confirm the overlay stays on the foreground only.\n"
        "The 'plain' card must look exactly as before (no overlay controls)."
    )


if __name__ == "__main__":
    main()
