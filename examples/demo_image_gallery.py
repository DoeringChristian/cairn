"""Demo: several images per step (an image gallery).

Tracking a LIST of ``cairn.Image`` under one name at one step records a
gallery: one point whose images are shown side by side, with the step slider
moving through steps as usual.

This demo "trains" a toy denoiser for a few steps. At every logged step it
records:

* ``samples`` — 8 validation images (noisy → cleaner as training goes on),
  each with its own caption (``cairn.Image(..., caption=...)``), plus a
  caption for the whole gallery (``run.track(..., caption=...)``).
* ``pairs`` — for 3 samples, input and prediction as a 2-image gallery each
  step, to show small galleries.

Two runs with different learning rates make the compare view useful: each
run's gallery sits in its own pane.

Usage::

    uv run cairn init /tmp/cairn-gallery
    CAIRN_REPO=/tmp/cairn-gallery/.cairn uv run python examples/demo_image_gallery.py
    uv run cairn ui --repo /tmp/cairn-gallery/.cairn --port 4317

    # browse http://localhost:4317/
    #   - A run → Metrics & Media: the ``samples`` card shows 8 images per
    #     step; drag the step slider to watch them denoise.
    #   - Select both runs → Compare: one gallery per run.
"""

from __future__ import annotations

import numpy as np

import cairn

PROJECT = "gallery-demo"
H = W = 64
N_SAMPLES = 8
STEPS = [0, 25, 50, 75, 100]


def targets(rng: np.random.Generator) -> list[np.ndarray]:
    """Clean target images: coloured discs and stripes, float in [0, 1]."""
    yy, xx = np.mgrid[0:H, 0:W] / H
    out = []
    for i in range(N_SAMPLES):
        colour = rng.uniform(0.2, 1.0, 3)
        cx, cy, r = rng.uniform(0.3, 0.7), rng.uniform(0.3, 0.7), rng.uniform(0.15, 0.3)
        disc = ((xx - cx) ** 2 + (yy - cy) ** 2 < r**2).astype(np.float32)
        stripes = 0.5 + 0.5 * np.sin((xx + yy) * (4 + i) * np.pi)
        img = disc[..., None] * colour + (1 - disc[..., None]) * stripes[..., None] * 0.3
        out.append(img.astype(np.float32))
    return out


def main() -> None:
    for name, lr in [("lr-small", 0.01), ("lr-large", 0.04)]:
        rng = np.random.default_rng(0)
        clean = targets(rng)
        noise = [rng.normal(0, 0.5, (H, W, 3)).astype(np.float32) for _ in clean]

        run = cairn.Run(project=PROJECT, name=name)
        run.config(lr=lr, n_samples=N_SAMPLES)
        for step in STEPS:
            # How much noise the "model" still leaves in its predictions.
            residual = float(np.exp(-lr * step))
            preds = [np.clip(c + residual * n, 0, 1) for c, n in zip(clean, noise)]
            errors = [float(np.mean((p - c) ** 2)) for p, c in zip(preds, clean)]

            run.track(float(np.mean(errors)), "val.mse", step, summary="min")
            run.track(
                [cairn.Image(p, caption=f"sample {i} · mse {e:.4f}") for i, (p, e) in enumerate(zip(preds, errors))],
                "samples",
                step,
                caption=f"step {step}: {N_SAMPLES} validation samples",
            )
            for i in range(3):
                noisy = np.clip(clean[i] + 0.5 * noise[i], 0, 1)
                run.track(
                    [cairn.Image(noisy, caption="input"), cairn.Image(preds[i], caption="prediction")],
                    f"pairs.sample{i}",
                    step,
                )
        run.finish()
        print(f"{name}: logged {len(STEPS)} steps")


if __name__ == "__main__":
    main()
