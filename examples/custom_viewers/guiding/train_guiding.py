"""A path-guiding distribution that learns to match a reference, for the
``vmf/`` custom viewer.

Every step logs the learned von Mises-Fisher mixture as ``cairn.Data(...,
kind="guiding/vmf")`` (series ``guide``), the reference it converges to
(``guide_ref``), a gallery of four per-pixel distributions (``guide_pixels``)
and a scalar loss. Two runs with different learning rates.

    cd examples/custom_viewers/guiding
    cairn init /tmp/cairn-viewers && export CAIRN_REPO=/tmp/cairn-viewers/.cairn
    python train_guiding.py          # publishes ./vmf (run.use_viewer)
    cairn ui --repo $CAIRN_REPO       # project "viewers-guiding"

In a run's page the ``guide`` card is drawn by the viewer. Open its gear >
Compare and pick ``guide_ref`` as the reference: learned and reference show
side by side, one camera. Edit the viewer live with
``cairn viewer dev vmf --project viewers-guiding``.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

import cairn

PROJECT = "viewers-guiding"
STEPS = 12


def unit(v: np.ndarray) -> np.ndarray:
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


def reference_mixture(rng: np.random.Generator) -> dict[str, np.ndarray]:
    """A fixed 'environment': a sharp sun, a few broad sky lobes."""
    mu = unit(rng.normal(size=(6, 3)))
    mu[0] = unit(np.array([0.3, 0.9, 0.2]))
    kappa = np.array([120.0, 8, 15, 4, 25, 10])
    weight = np.array([0.35, 0.2, 0.15, 0.1, 0.1, 0.1])
    return {"mu": mu.astype(np.float32), "kappa": kappa.astype(np.float32), "weight": weight.astype(np.float32)}


def learned_mixture(ref: dict[str, np.ndarray], start: dict[str, np.ndarray], a: float) -> dict[str, np.ndarray]:
    """The learned lobes `a` of the way (0..1) from their start to their reference lobe."""
    k = len(start["mu"])
    target = np.arange(k) % len(ref["mu"])
    mu = unit((1 - a) * start["mu"] + a * ref["mu"][target])
    kappa = np.exp((1 - a) * np.log(start["kappa"]) + a * np.log(ref["kappa"][target]))
    share = ref["weight"][target] / np.bincount(target)[target]
    weight = (1 - a) * start["weight"] + a * share
    return {
        "mu": mu.astype(np.float32),
        "kappa": kappa.astype(np.float32),
        "weight": (weight / weight.sum()).astype(np.float32),
    }


def rotate(mix: dict[str, np.ndarray], angle: float) -> dict[str, np.ndarray]:
    """The mixture rotated about the y axis (a neighbouring pixel's distribution)."""
    c, s = np.cos(angle), np.sin(angle)
    r = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]], dtype=np.float32)
    return {**mix, "mu": mix["mu"] @ r.T}


def train(name: str, lr: float, lobes: int, seed: int) -> None:
    rng = np.random.default_rng(seed)
    ref = reference_mixture(np.random.default_rng(0))  # the same reference for every run
    start = {
        "mu": unit(rng.normal(size=(lobes, 3))).astype(np.float32),
        "kappa": np.full(lobes, 1.0, np.float32),
        "weight": np.full(lobes, 1.0 / lobes, np.float32),
    }
    with cairn.Run(project=PROJECT, name=name) as run:
        run.config({"lr": lr, "lobes": lobes})
        run.use_viewer(Path(__file__).parent / "vmf")  # publish the viewer when it changed
        for step in range(STEPS):
            a = 1 - np.exp(-lr * (step + 1))
            mix = learned_mixture(ref, start, a)
            run.track(cairn.Data(mix, kind="guiding/vmf", meta={"lobes": lobes}), "guide", step)
            run.track(cairn.Data(ref, kind="guiding/vmf", meta={"lobes": 6}), "guide_ref", step)
            # A gallery: one distribution per pixel of a 2x2 tile.
            run.track(
                [cairn.Data(rotate(mix, i * np.pi / 3), kind="guiding/vmf", caption=f"pixel {i}") for i in range(4)],
                "guide_pixels", step,
            )
            run.track(float(1 - a), "loss", step)
    print(f"logged {name}")


if __name__ == "__main__":
    train("guiding-fast", lr=0.45, lobes=24, seed=1)
    train("guiding-slow", lr=0.15, lobes=48, seed=2)
