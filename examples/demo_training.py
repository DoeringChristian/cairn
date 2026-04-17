"""Demo script for manually testing the Cairn viewer.

Simulates a short training run that exercises every built-in media type so
you can click around the UI and confirm each card renders correctly.

**Server mode** (two terminals)::

    # terminal 1
    uv run cairn server --repo /tmp/cairn-demo/.cairn

    # terminal 2
    CAIRN_SERVER=http://localhost:4300 uv run python examples/demo_training.py

    # browse http://localhost:4301/  (server spawns the UI automatically)

**Local mode** (no tracking server)::

    uv run cairn init /tmp/cairn-demo
    CAIRN_REPO=/tmp/cairn-demo/.cairn uv run python examples/demo_training.py
    uv run cairn ui --repo /tmp/cairn-demo/.cairn

    # browse http://localhost:4301/
"""

from __future__ import annotations

import math
import random
import time

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image, ImageDraw

import cairn


def make_sample_image(step: int) -> Image.Image:
    """A 64×64 RGB image whose contents change each step."""
    step += 1
    img = Image.new("RGB", (64, 64), (20, 20, 40))
    draw = ImageDraw.Draw(img)
    # Moving circle
    cx = 32 + int(20 * math.cos(step / 5.0))
    cy = 32 + int(20 * math.sin(step / 5.0))
    r = 8 + (step % 4)
    color = (
        (50 + step * 7) % 256,
        (100 + step * 3) % 256,
        (150 + step * 5) % 256,
    )
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=color)
    return img


def make_matplotlib_figure(step: int) -> plt.Figure:
    fig, ax = plt.subplots(figsize=(5, 3))
    x = np.linspace(0, 4 * np.pi, 200)
    ax.plot(x, np.sin(x + step * 0.1), label="sin")
    ax.plot(x, np.cos(x + step * 0.1), label="cos", linestyle="--")
    ax.set_title(f"step {step}")
    ax.legend()
    ax.grid(True)
    return fig


def make_audio_clip(step: int, sample_rate: int = 16000) -> np.ndarray:
    """A 0.5 s sine wave at a step-dependent frequency."""
    freq = 220.0 + (step * 30.0) % 440.0
    t = np.linspace(0, 0.5, int(sample_rate * 0.5), endpoint=False, dtype=np.float32)
    return 0.4 * np.sin(2 * np.pi * freq * t)


def main() -> None:
    # Destination is auto-resolved: CAIRN_REPO > CAIRN_SERVER > ./.cairn > default.
    from cairn.config import resolve_target

    target = resolve_target()
    print(f"Logging to {target.kind} at {target.location}")

    # No need for `with cairn.Run(...) as run:` or `run.finish()` — the SDK
    # registers an atexit hook so cleanup happens automatically when the
    # script exits. Use the context manager form only if you want a run to
    # finish at a specific point mid-script.
    run = cairn.Run(
        project="demo",
        task="viewer-smoke",
        name="full-demo",
        tags=["demo", "smoke"],
        notes="Exercises every built-in handler for manual UI testing.",
        # Keep source + system metrics on so the Source / Environment / System
        # tabs also have content to show.
        capture_source=True,
        capture_stdout=True,
        capture_env=True,
        capture_system_metrics=True,
        system_metrics_interval=5.0,
    )

    # Params (nested dicts get flattened into dotted keys)
    run["hparams"] = {
        "lr": 3e-4,
        "batch_size": 32,
        "optimizer": "adamw",
        "scheduler": {"type": "cosine", "warmup_steps": 100},
    }
    run["dataset"] = {"name": "cifar10", "num_classes": 10}

    num_steps = 50
    random.seed(0)

    print("Logging scalars + per-step images...")
    for step in range(num_steps):
        # Scalars — train and val loss with context
        train_loss = 2.5 * math.exp(-step / 15.0) + random.uniform(0, 0.05)
        val_loss = train_loss + 0.1 + random.uniform(-0.02, 0.1)
        acc = min(0.99, 0.1 + (1 - math.exp(-step / 10.0)) * 0.9)

        run.track(train_loss, name="train.loss", step=step)
        run.track(val_loss, name="train.loss", step=step, context={"subset": "val"})
        run.track(acc, name="train.accuracy", step=step)
        run.track(
            acc + random.uniform(-0.05, 0.0),
            name="train.accuracy",
            step=step,
            context={"subset": "val"},
        )

        # Metric that lives in its own section (no dot prefix)
        run.track(random.uniform(0.5, 1.0), name="grad_norm", step=step)

        # Image every 5 steps — moving-circle animation
        if step % 5 == 0:
            run.track(make_sample_image(step), name="predictions.sample", step=step)

        # Figure every 10 steps — matplotlib (the registry picks the figure
        # handler by default; use cairn.Image(fig) if you want a flat PNG).
        if step % 10 == 0:
            fig = make_matplotlib_figure(step)
            run.track(fig, name="training_curves", step=step)
            plt.close(fig)

        # Histogram of random weights every 10 steps (forced via wrapper)
        if step % 10 == 0:
            weights = np.random.default_rng(step).normal(
                loc=0.0, scale=1.0 + step / 100.0, size=10_000
            )
            run.track(
                cairn.Histogram(weights, bins=64),
                name="layer0.weights",
                step=step,
            )

        # Audio clip every 15 steps
        if step % 15 == 0:
            clip = make_audio_clip(step)
            run.track(
                cairn.Audio(clip, sample_rate=16000),
                name="synth.sample",
                step=step,
            )

        # Small tensor snapshot every 20 steps
        if step % 20 == 0:
            grad = np.random.default_rng(step).normal(size=(8, 8)).astype(np.float32)
            run.track(cairn.Tensor(grad), name="grads.layer0", step=step)

        # Text every so often — simulate generated output
        if step % 12 == 0:
            run.track(
                cairn.Text(
                    f"Step {step}: the model generated this demo caption. "
                    f"val_loss={val_loss:.3f}, acc={acc:.3f}."
                ),
                name="generations.caption",
                step=step,
            )

        # Use stdout capture — this shows up in the Logs tab
        print(f"step={step:03d}  loss={train_loss:.4f}  acc={acc:.3f}")

        # Breathe so the viewer has time to poll & you can watch live
        time.sleep(0.1)

    # One-off artifact (not tied to a step) — exercises log_artifact path
    final_checkpoint = (
        np.random.default_rng(42).normal(size=(32, 32)).astype(np.float32)
    )
    run.log_artifact(cairn.Tensor(final_checkpoint), name="final_weights")

    # A dedicated figure artifact attached to the run itself
    fig = make_matplotlib_figure(num_steps)
    run.log_artifact(cairn.Image(fig), name="summary_plot")
    plt.close(fig)

    run.add_note(
        "Demo finished. Check every tab: Overview (params/git/env), "
        "Metrics (loss curves, grad_norm, accuracy), Media (sample images, "
        "audio, figures, histogram), Logs (stdout), Source, Environment."
    )
    print("\nAll done. Run ID:", run.id)
    print("Open:", run.url)
    # No run.finish() required — the atexit hook handles it on interpreter exit.


if __name__ == "__main__":
    main()
