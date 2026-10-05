"""Log a histogram over training steps for two runs; ./hist draws it (see README.md)."""

from pathlib import Path

import numpy as np

import cairn

for seed in (0, 1):
    rng = np.random.default_rng(seed)
    with cairn.Run(project="viewers-minimal", name=f"minimal-{seed}") as run:
        run.use_viewer(Path(__file__).parent / "hist")  # publishes ./hist when it changed
        for step in range(0, 100, 10):
            samples = rng.normal(loc=seed + step / 40, scale=1 + step / 100, size=4000)
            counts, _ = np.histogram(samples, bins=24, range=(-3, 6))
            run.track(cairn.Data({"values": counts.astype(np.float32)}, kind="demo/hist"), "hist", step)
