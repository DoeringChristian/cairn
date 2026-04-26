"""Demo: class-based plugin API.

Plugin classes work like cairn.Image / cairn.Figure — instantiate to wrap data.
Auto-registers on first track() call.

::

    cairn init
    python examples/demo_plugins_v2.py
    cairn ui --host 0.0.0.0
"""

from __future__ import annotations

import math
import struct
from pathlib import Path

import cairn

# Import plugin classes — they're defined in separate files for clarity,
# but can also be defined inline in the same script.
import sys
sys.path.insert(0, str(Path(__file__).parent / "plugins"))
from heatmap_cls import Heatmap
from histogram_cls import Histogram
from surface3d_cls import Surface3D


def make_heatmap(rows: int, cols: int, step: int) -> tuple[bytes, dict]:
    values = []
    for r in range(rows):
        for c in range(cols):
            v = math.sin(r * 0.5 + step * 0.3) * math.cos(c * 0.5 + step * 0.2)
            values.append(v)
    return struct.pack(f"<{len(values)}f", *values), {"rows": rows, "cols": cols, "label": "Activation Map"}


def make_histogram(n: int, step: int) -> tuple[bytes, dict]:
    import random
    random.seed(step)
    mean = 0.5 * math.sin(step * 0.2)
    std = 0.3 + 0.2 * math.cos(step * 0.1)
    values = [random.gauss(mean, std) for _ in range(n)]
    return struct.pack(f"<{len(values)}f", *values), {"label": "Weight Distribution", "bins": 40}


def make_surface(rows: int, cols: int, step: int) -> tuple[bytes, dict]:
    values = []
    for r in range(rows):
        for c in range(cols):
            x = (c - cols / 2) / cols * 4
            y = (r - rows / 2) / rows * 4
            z = math.sin(x * 2 + step * 0.1) * math.cos(y * 2 + step * 0.15)
            values.append(z)
    return struct.pack(f"<{len(values)}f", *values), {
        "rows": rows, "cols": cols,
        "x_label": "learning rate", "y_label": "weight decay", "z_label": "loss",
    }


def main():
    run = cairn.Run(project="plugin-v2", name="class-based-demo")

    print("Logging 20 steps with class-based plugins...")
    for step in range(20):
        # JS heatmap — just instantiate the class with data + kwargs
        blob, meta = make_heatmap(8, 8, step)
        run.track(Heatmap(blob, **meta), name="activations", step=step)

        # Python histogram
        blob, meta = make_histogram(500, step)
        run.track(Histogram(blob, **meta), name="weights.distribution", step=step)

        # Python 3D surface
        blob, meta = make_surface(20, 20, step)
        run.track(Surface3D(blob, **meta), name="landscape.loss_surface", step=step)

        # Regular scalar
        loss = 2.0 * math.exp(-step * 0.15) + 0.1
        run.track(loss, name="loss", step=step)

        print(f"  step {step}: loss={loss:.3f}")

    run.finish()
    print(f"\nDone! Run ID: {run.id}")
    print(f"View at: {run.url}")


if __name__ == "__main__":
    main()
