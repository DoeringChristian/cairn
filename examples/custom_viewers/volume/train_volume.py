"""A density field that a (pretend) reconstruction refines over training, for
the ``raymarch/`` custom viewer.

Every step logs the current reconstruction as a built-in ``cairn.Volume``
(series ``density``) next to the ground truth (``density_target``). Nothing
here is custom data: the viewer's manifest accepts ``volume``, so once it is
published every volume card of the project is drawn by it. Two runs: one
converges faster than the other.

    cd examples/custom_viewers/volume
    cairn init /tmp/cairn-viewers && export CAIRN_REPO=/tmp/cairn-viewers/.cairn
    python train_volume.py           # publishes ./raymarch (run.use_viewer)
    cairn ui --repo $CAIRN_REPO       # project "viewers-volume"

Drag to orbit, wheel to zoom; the gear has the colormap, density, steps,
threshold and a slice plane. Gear > Compare > reference ``density_target``
shows reconstruction and target side by side with one camera.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

import cairn

PROJECT = "viewers-volume"
STEPS = 10
SHAPE = (48, 64, 80)  # (D, H, W)
SPACING = (1.5, 1.0, 1.0)  # physical size of a voxel along D, H, W


def target_field() -> np.ndarray:
    """A torus with two blobs inside a box of SHAPE."""
    z, y, x = np.meshgrid(*(np.linspace(-1, 1, n, dtype=np.float32) for n in SHAPE), indexing="ij")
    ring = (np.sqrt(x**2 + y**2) - 0.55) ** 2 + (z * 1.5) ** 2
    torus = np.exp(-ring / 0.02)
    blobs = np.exp(-((x - 0.3) ** 2 + y**2 + z**2) / 0.03) + 0.7 * np.exp(-((x + 0.35) ** 2 + (y - 0.2) ** 2 + z**2) / 0.05)
    return (torus + blobs).astype(np.float32)


def blur(v: np.ndarray, passes: int) -> np.ndarray:
    """A cheap box blur (each pass averages every voxel with its 6 neighbours)."""
    for _ in range(passes):
        v = (v + sum(np.roll(v, s, a) for a in range(3) for s in (-1, 1))) / 7
    return v


def train(name: str, speed: float, seed: int) -> None:
    rng = np.random.default_rng(seed)
    target = target_field()
    with cairn.Run(project=PROJECT, name=name) as run:
        run.config({"speed": speed, "shape": list(SHAPE)})
        run.use_viewer(Path(__file__).parent / "raymarch")  # publish the viewer when it changed
        for step in range(STEPS):
            progress = 1 - np.exp(-speed * (step + 1))
            # Early steps: blurry and noisy; later ones approach the target.
            noise = (1 - progress) * 0.4 * rng.random(SHAPE, dtype=np.float32)
            recon = blur(target, int(round(8 * (1 - progress)))) * progress + noise
            run.track(cairn.Volume(recon, spacing=SPACING), "density", step)
            run.track(cairn.Volume(target, spacing=SPACING), "density_target", step)
            run.track(float(np.abs(recon - target).mean()), "l1", step)
    print(f"logged {name}")


if __name__ == "__main__":
    train("volume-fast", speed=0.5, seed=1)
    train("volume-slow", speed=0.2, seed=2)
