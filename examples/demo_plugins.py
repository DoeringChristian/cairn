"""Demo script for Cairn's plugin system.

Registers JS and Python viewer plugins, then logs synthetic data at
multiple steps to exercise each one.

**Quick start**::

    uv run cairn init /tmp/cairn-plugins
    CAIRN_REPO=/tmp/cairn-plugins/.cairn uv run python examples/demo_plugins.py
    uv run cairn ui --repo /tmp/cairn-plugins/.cairn --host 0.0.0.0

    # browse http://localhost:4301/

Plugins used:
  - heatmap.js       — Canvas 2D heatmap (JS)
  - histogram.py     — Distribution histogram (Python/matplotlib)
  - confusion_matrix.py — Annotated confusion matrix (Python/matplotlib)
  - surface3d.py     — 3D surface plot (Python/matplotlib)
"""

from __future__ import annotations

import math
import struct
from pathlib import Path

import cairn

PLUGINS_DIR = Path(__file__).parent / "plugins"


def make_heatmap(rows: int, cols: int, step: int) -> tuple[bytes, dict]:
    """Generate a synthetic heatmap that evolves over steps."""
    values = []
    for r in range(rows):
        for c in range(cols):
            v = math.sin(r * 0.5 + step * 0.3) * math.cos(c * 0.5 + step * 0.2)
            v += 0.1 * math.sin(step * 0.1 + r * c * 0.01)
            values.append(v)
    blob = struct.pack(f"<{len(values)}f", *values)
    meta = {"rows": rows, "cols": cols, "label": "Activation Map"}
    return blob, meta


def make_histogram(n: int, step: int) -> tuple[bytes, dict]:
    """Generate a distribution that shifts over steps."""
    import random

    random.seed(step)
    mean = 0.5 * math.sin(step * 0.2)
    std = 0.3 + 0.2 * math.cos(step * 0.1)
    values = [random.gauss(mean, std) for _ in range(n)]
    blob = struct.pack(f"<{len(values)}f", *values)
    meta = {"label": "Weight Distribution", "bins": 40}
    return blob, meta


def make_confusion_matrix(n_classes: int, step: int) -> tuple[bytes, dict]:
    """Generate a confusion matrix that improves over steps."""
    import random

    random.seed(step)
    labels = [f"class_{i}" for i in n_classes * [None]] if n_classes <= 5 else []
    labels = [f"class_{i}" for i in range(n_classes)]

    values = []
    # Start noisy, converge to diagonal.
    accuracy = min(0.95, 0.3 + step * 0.05)
    for i in range(n_classes):
        row = []
        for j in range(n_classes):
            if i == j:
                row.append(accuracy * 100 + random.uniform(-5, 5))
            else:
                row.append((1 - accuracy) / (n_classes - 1) * 100 + random.uniform(-2, 2))
        values.extend(row)
    values = [max(0, v) for v in values]
    blob = struct.pack(f"<{len(values)}f", *values)
    meta = {"rows": n_classes, "cols": n_classes, "labels": labels}
    return blob, meta


def make_surface(rows: int, cols: int, step: int) -> tuple[bytes, dict]:
    """Generate a 3D loss landscape that changes over steps."""
    values = []
    for r in range(rows):
        for c in range(cols):
            x = (c - cols / 2) / cols * 4
            y = (r - rows / 2) / rows * 4
            # Evolving loss landscape: multiple minima that shift.
            z = (
                math.sin(x * 2 + step * 0.1) * math.cos(y * 2 + step * 0.15)
                + 0.5 * math.exp(-(x**2 + y**2) / (2 + step * 0.1))
                + 0.3 * math.sin(x * y + step * 0.05)
            )
            values.append(z)
    blob = struct.pack(f"<{len(values)}f", *values)
    meta = {
        "rows": rows,
        "cols": cols,
        "x_label": "learning rate",
        "y_label": "weight decay",
        "z_label": "loss",
    }
    return blob, meta


def main():
    run = cairn.Run(project="plugin-demo", name="plugin-showcase")

    # Register all plugins.
    run.register_plugin("heatmap", PLUGINS_DIR / "heatmap.js")
    run.register_plugin("test_interactive", PLUGINS_DIR / "test_interactive.js")
    run.register_plugin("histogram", PLUGINS_DIR / "histogram.py")
    run.register_plugin("confusion", PLUGINS_DIR / "confusion_matrix.py")
    run.register_plugin("surface3d", PLUGINS_DIR / "surface3d.py")

    print("Logging 20 steps with 4 plugin viewers...")

    for step in range(20):
        # JS heatmap — 8x8 activation map.
        blob, meta = make_heatmap(8, 8, step)
        run.track(cairn.Plugin(blob, plugin="heatmap", **meta), name="activations", step=step)

        # JS interactive test — button + draggable box.
        run.track(cairn.Plugin(b"test", plugin="test_interactive"), name="interactive_test", step=step)

        # Python histogram — weight distribution.
        blob, meta = make_histogram(500, step)
        run.track(cairn.Plugin(blob, plugin="histogram", **meta), name="weights.distribution", step=step)

        # Python confusion matrix — 5 classes.
        blob, meta = make_confusion_matrix(5, step)
        run.track(cairn.Plugin(blob, plugin="confusion", **meta), name="eval.confusion", step=step)

        # Python 3D surface — 20x20 loss landscape.
        blob, meta = make_surface(20, 20, step)
        run.track(cairn.Plugin(blob, plugin="surface3d", **meta), name="landscape.loss_surface", step=step)

        # Also log a regular scalar so the run has charts too.
        loss = 2.0 * math.exp(-step * 0.15) + 0.1
        run.track(loss, name="loss", step=step)

        print(f"  step {step}: loss={loss:.3f}")

    run.finish()
    print(f"\nDone! Run ID: {run.id}")
    print(f"View at: {run.url}")


if __name__ == "__main__":
    main()
