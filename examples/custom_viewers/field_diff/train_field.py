"""A 2D field a model learns to predict, for the ``field2d/`` custom viewer.

Every step logs the prediction (series ``field``) and the ground truth
(``field_target``) as ``cairn.Data({"field": (H, W) array}, kind="field/2d")``,
plus a gallery of the prediction's three components (``field_parts``) and a
scalar error. Two runs; the second learns more slowly.

    cd examples/custom_viewers/field_diff
    cairn init /tmp/cairn-viewers && export CAIRN_REPO=/tmp/cairn-viewers/.cairn
    python train_field.py            # publishes ./field2d (run.use_viewer)
    cairn ui                         # project "custom-viewers"

On the ``field`` card: gear > Compare > reference ``field_target`` shows the
error A - B on a symmetric colormap; hover a pixel for its values. The gear's
other settings: A | B, palette, range and threshold.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

import cairn

PROJECT = "custom-viewers"
STEPS = 15
H, W = 64, 96


def components() -> list[np.ndarray]:
    """The target's three parts: a wave, a vortex-like swirl and a bump."""
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    x, y = x / W * 2 - 1, y / H * 2 - 1
    wave = np.sin(4 * x + 2 * y)
    swirl = np.exp(-(x**2 + y**2) * 3) * np.sin(6 * np.arctan2(y, x))
    bump = 1.5 * np.exp(-((x - 0.5) ** 2 + (y + 0.3) ** 2) * 12)
    return [wave, swirl, bump]


def train(name: str, lr: float, seed: int) -> None:
    rng = np.random.default_rng(seed)
    parts = components()
    target = sum(parts)
    with cairn.Run(project=PROJECT, name=name) as run:
        run.config({"lr": lr, "shape": [H, W]})
        run.use_viewer(Path(__file__).parent / "field2d")  # publish the viewer when it changed
        for step in range(STEPS):
            # Each part is learned at its own pace (the bump last), plus shrinking noise.
            pace = [1 - np.exp(-lr * k * (step + 1)) for k in (1.5, 1.0, 0.4)]
            noise = (1 - pace[1]) * 0.3 * rng.standard_normal((H, W))
            learned = [(p * c).astype(np.float32) for p, c in zip(pace, parts)]
            pred = (sum(learned) + noise).astype(np.float32)
            run.track(cairn.Data({"field": pred}, kind="field/2d", meta={"lr": lr}), "field", step)
            run.track(cairn.Data({"field": target.astype(np.float32)}, kind="field/2d"), "field_target", step)
            run.track(
                [cairn.Data({"field": c}, kind="field/2d", caption=n) for c, n in zip(learned, ("wave", "swirl", "bump"))],
                "field_parts", step,
            )
            run.track(float(np.sqrt(((pred - target) ** 2).mean())), "rmse", step)
    print(f"logged {name}")


if __name__ == "__main__":
    train("field-fast", lr=0.35, seed=1)
    train("field-slow", lr=0.12, seed=2)
