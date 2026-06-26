"""Demo: image comparison across runs.

Creates a baseline run with reference images and several variant runs that
introduce controlled distortions. Open the Compare page, select all runs,
and try the different diff modes (signed, absolute, squared, etc.) and
compare modes (side-by-side, split slider, blend).

Usage::

    # terminal 1 — start the server
    uv run cairn server --repo /tmp/cairn-imgcmp/.cairn

    # terminal 2 — run this script
    CAIRN_SERVER=http://localhost:4300 uv run python examples/demo_image_comparison.py

    # browse http://localhost:4301/
"""

from __future__ import annotations

import math
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

import cairn


SZ = 512
NUM_STEPS = 20
PROJECT = "image-comparison-demo"


# ---------------------------------------------------------------------------
# Image generators
# ---------------------------------------------------------------------------

def make_scene(step: int) -> Image.Image:
    """Base scene: dark background, a moving circle, and a static grid."""
    img = Image.new("RGB", (SZ, SZ), (15, 15, 30))
    draw = ImageDraw.Draw(img)

    # Static grid
    for x in range(0, SZ, 64):
        draw.line([(x, 0), (x, SZ)], fill=(40, 40, 60), width=1)
    for y in range(0, SZ, 64):
        draw.line([(0, y), (SZ, y)], fill=(40, 40, 60), width=1)

    # Moving circle
    t = step / NUM_STEPS * 2 * math.pi
    cx = SZ // 2 + int(SZ * 0.25 * math.cos(t))
    cy = SZ // 2 + int(SZ * 0.25 * math.sin(t))
    r = 60
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(50, 130, 220))

    # Static square in corner
    draw.rectangle((30, 30, 130, 130), fill=(200, 60, 60))

    # Gradient bar at bottom
    for x in range(SZ):
        v = int(255 * x / SZ)
        draw.line([(x, SZ - 30), (x, SZ)], fill=(v, v, v))

    return img


def distort_brightness(img: Image.Image, factor: float) -> Image.Image:
    """Scale pixel values by a constant factor."""
    arr = np.array(img, dtype=np.float32)
    arr = np.clip(arr * factor, 0, 255).astype(np.uint8)
    return Image.fromarray(arr)


def distort_noise(img: Image.Image, sigma: float, seed: int) -> Image.Image:
    """Add Gaussian noise."""
    rng = np.random.default_rng(seed)
    arr = np.array(img, dtype=np.float32)
    noise = rng.normal(0, sigma, arr.shape).astype(np.float32)
    arr = np.clip(arr + noise, 0, 255).astype(np.uint8)
    return Image.fromarray(arr)


def distort_blur(img: Image.Image, radius: float) -> Image.Image:
    """Apply Gaussian blur."""
    return img.filter(ImageFilter.GaussianBlur(radius=radius))


def distort_shift(img: Image.Image, dx: int, dy: int) -> Image.Image:
    """Translate the image (wrapping)."""
    arr = np.array(img)
    arr = np.roll(arr, dx, axis=1)
    arr = np.roll(arr, dy, axis=0)
    return Image.fromarray(arr)


def distort_color(img: Image.Image, channel: int, offset: int) -> Image.Image:
    """Shift one color channel."""
    arr = np.array(img, dtype=np.int16)
    arr[:, :, channel] = np.clip(arr[:, :, channel] + offset, 0, 255)
    return Image.fromarray(arr.astype(np.uint8))


# ---------------------------------------------------------------------------
# Run definitions
# ---------------------------------------------------------------------------

VARIANTS = [
    {
        "name": "brightness-up",
        "tags": ["variant", "brightness"],
        "params": {"distortion": "brightness", "factor": 1.3},
        "fn": lambda img, step: distort_brightness(img, 1.3),
    },
    {
        "name": "brightness-down",
        "tags": ["variant", "brightness"],
        "params": {"distortion": "brightness", "factor": 0.7},
        "fn": lambda img, step: distort_brightness(img, 0.7),
    },
    {
        "name": "gaussian-noise-low",
        "tags": ["variant", "noise"],
        "params": {"distortion": "gaussian_noise", "sigma": 15},
        "fn": lambda img, step: distort_noise(img, 15, seed=step),
    },
    {
        "name": "gaussian-noise-high",
        "tags": ["variant", "noise"],
        "params": {"distortion": "gaussian_noise", "sigma": 40},
        "fn": lambda img, step: distort_noise(img, 40, seed=step),
    },
    {
        "name": "blur-mild",
        "tags": ["variant", "blur"],
        "params": {"distortion": "gaussian_blur", "radius": 2},
        "fn": lambda img, step: distort_blur(img, 2),
    },
    {
        "name": "blur-heavy",
        "tags": ["variant", "blur"],
        "params": {"distortion": "gaussian_blur", "radius": 6},
        "fn": lambda img, step: distort_blur(img, 6),
    },
    {
        "name": "shift-5px",
        "tags": ["variant", "shift"],
        "params": {"distortion": "translate", "dx": 5, "dy": 3},
        "fn": lambda img, step: distort_shift(img, 5, 3),
    },
    {
        "name": "red-tint",
        "tags": ["variant", "color"],
        "params": {"distortion": "color_shift", "channel": "red", "offset": 30},
        "fn": lambda img, step: distort_color(img, 0, 30),
    },
    {
        "name": "blue-tint",
        "tags": ["variant", "color"],
        "params": {"distortion": "color_shift", "channel": "blue", "offset": 30},
        "fn": lambda img, step: distort_color(img, 2, 30),
    },
]


def log_run(name: str, tags: list[str], params: dict, transform_fn) -> None:
    """Log a single run with transformed images + a quality metric."""
    run = cairn.Run(project=PROJECT, name=name, tags=tags)
    run["distortion"] = params

    for step in range(NUM_STEPS):
        base = make_scene(step)
        result = transform_fn(base, step)

        run.track(result, name="output", step=step)

        # Also log the reference so per-run comparison is possible
        run.track(base, name="reference", step=step)

        # Scalar metric: mean absolute error vs reference
        mae = np.mean(np.abs(
            np.array(result, dtype=np.float32) - np.array(base, dtype=np.float32)
        ))
        psnr = 10 * np.log10(255.0**2 / max(np.mean(
            (np.array(result, dtype=np.float32) - np.array(base, dtype=np.float32))**2
        ), 1e-10))
        run.track(float(mae), name="quality.mae", step=step)
        run.track(float(psnr), name="quality.psnr", step=step)

    run.finish()
    print(f"  done: {name}")


def main() -> None:
    from cairn.config import resolve_target
    target = resolve_target()
    print(f"Logging to {target.kind} at {target.location}")

    # 1. Baseline run — logs the unmodified scene as both output and reference
    print("Creating baseline run...")
    baseline = cairn.Run(
        project=PROJECT,
        name="baseline",
        tags=["baseline"],
    )
    baseline["distortion"] = {"type": "none"}

    for step in range(NUM_STEPS):
        img = make_scene(step)
        baseline.track(img, name="output", step=step)
        baseline.track(img, name="reference", step=step)
        baseline.track(0.0, name="quality.mae", step=step)
        baseline.track(float("inf"), name="quality.psnr", step=step)

    baseline.finish()
    print("  done: baseline")

    # 2. Variant runs — each applies a different distortion
    print(f"Creating {len(VARIANTS)} variant runs...")
    for v in VARIANTS:
        log_run(v["name"], v["tags"], v["params"], v["fn"])
        time.sleep(0.05)

    print(f"\nAll done! Open the UI and create a comparison with these {1 + len(VARIANTS)} runs.")
    print("Try: diff modes (signed, absolute, squared), compare modes (side-by-side, split, blend)")


if __name__ == "__main__":
    main()
