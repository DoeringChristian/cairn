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
import shutil
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
from server_heatmap_cls import ServerHeatmap
from server_3d_cls import Server3DScene
from webgl_demo_cls import WebGLDemo

# WindowPlugin: only available if Xvfb + glxgears are installed.
HAS_GLXGEARS = shutil.which("glxgears") is not None and shutil.which("Xvfb") is not None
if HAS_GLXGEARS:
    from window_glxgears_cls import GlxgearsViewer


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

        # Python WebGL — rotating triangle from Python
        run.track(WebGLDemo(b"", step=step), name="webgl.triangle", step=step)

        # Server-side heatmap (rendered with PIL on the server)
        blob, meta = make_heatmap(6, 6, step)
        run.track(ServerHeatmap(blob, **meta), name="server.heatmap", step=step)

        # Server-side interactive 3D scene (drag to rotate)
        run.track(Server3DScene(b""), name="server.3d_scene", step=step)

        # Window plugin: stream glxgears from Xvfb (if available)
        if HAS_GLXGEARS and step == 0:  # only track once — it's a live window
            run.track(GlxgearsViewer(b""), name="window.glxgears", step=0)

        # Regular scalar
        loss = 2.0 * math.exp(-step * 0.15) + 0.1
        run.track(loss, name="loss", step=step)

        print(f"  step {step}: loss={loss:.3f}")

    run.finish()
    print(f"\nDone! Run ID: {run.id}")
    print(f"View at: {run.url}")


if __name__ == "__main__":
    main()
