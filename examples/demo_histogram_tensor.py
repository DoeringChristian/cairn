"""Demo: histogram chart + tensor card (Workstream A).

Logs everything the two new cards need to exercise every feature:

* Histograms of a **shifting gaussian** over many steps (drives the per-step
  bar chart, the log-Y toggle, and — because there are > 3 steps — the
  step x bin heatmap view).
* A **2D tensor** that looks like an attention map (32x32), sharpening over
  steps (drives the tensor heatmap + client-computed histogram views).
* A **3D tensor** (4 heads x 16 x 16) to exercise the per-dimension slice
  selectors in the tensor heatmap.
* A **1D tensor** (a weight vector) to exercise the histogram fallback for
  tensors that can't be shown as a heatmap.

Usage::

    uv run cairn init /tmp/cairn-histtensor
    CAIRN_REPO=/tmp/cairn-histtensor/.cairn \
        uv run python examples/demo_histogram_tensor.py
    uv run cairn ui --repo /tmp/cairn-histtensor/.cairn --port 4311
"""

from __future__ import annotations

import numpy as np

import cairn

PROJECT = "histogram-tensor-demo"
NUM_STEPS = 12
SEED = 7


def softmax_2d(x: np.ndarray) -> np.ndarray:
    x = x - x.max(axis=-1, keepdims=True)
    e = np.exp(x)
    return e / e.sum(axis=-1, keepdims=True)


def attention_map(step: int, n: int, rng: np.random.Generator) -> np.ndarray:
    """A (n, n) attention-like matrix that sharpens toward the diagonal."""
    idx = np.arange(n)
    # Diagonal band that tightens as `step` grows.
    band = np.exp(-((idx[:, None] - idx[None, :]) ** 2) / (2 * (n / (2 + step)) ** 2))
    noise = rng.random((n, n)) * 0.3
    logits = (band + noise) * (1.0 + 0.4 * step)
    return softmax_2d(logits).astype(np.float32)


def log_run(name: str, seed: int) -> None:
    rng = np.random.default_rng(seed)
    run = cairn.Run(project=PROJECT, name=name, tags=["workstream-a", "demo"])
    run["config"] = {"num_steps": NUM_STEPS, "seed": seed}

    for step in range(NUM_STEPS):
        # --- Histogram: gaussian whose mean shifts and whose spread shrinks ---
        center = -2.0 + 4.0 * step / (NUM_STEPS - 1)
        std = 1.5 - 0.9 * step / (NUM_STEPS - 1)
        samples = rng.normal(center, std, size=5000)
        run.track(cairn.Histogram(samples, bins=64), name="weights/layer1", step=step)

        # A bimodal distribution as a second histogram metric.
        bimodal = np.concatenate([
            rng.normal(-1.0, 0.4, size=2500),
            rng.normal(1.0 + 0.1 * step, 0.4, size=2500),
        ])
        run.track(cairn.Histogram(bimodal, bins=48), name="activations", step=step)

        # --- 2D tensor: attention map (32x32) ---
        attn = attention_map(step, 32, rng)
        run.track(cairn.Tensor(attn), name="attention", step=step)

        # --- 3D tensor: 4 attention heads (4 x 16 x 16) ---
        heads = np.stack([attention_map(step, 16, rng) for _ in range(4)]).astype(
            np.float32
        )
        run.track(cairn.Tensor(heads), name="attention_heads", step=step)

        # --- 1D tensor: a weight vector (tests histogram fallback) ---
        vec = rng.normal(center, std, size=256).astype(np.float32)
        run.track(cairn.Tensor(vec), name="grad_norms", step=step)

        # A scalar so the run also has a normal metric.
        run.track(float(np.abs(samples).mean()), name="loss", step=step)

    run.finish()
    print(f"  done: {name}")


def main() -> None:
    from cairn.config import resolve_target

    target = resolve_target()
    print(f"Logging to {target.kind} at {target.location}")
    print(f"Creating 2 runs with {NUM_STEPS} steps each...")
    log_run("run-a", SEED)
    log_run("run-b", SEED + 1)
    print(
        "\nDone. Start the UI with:\n"
        "  uv run cairn ui --repo <repo>/.cairn --port 4311\n"
        "Open a run and add Histogram + Tensor cards."
    )


if __name__ == "__main__":
    main()
