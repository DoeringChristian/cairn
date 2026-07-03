"""Demo: 3D volume cards (Workstream V).

Logs dense scalar grids as ``cairn.Volume`` sequences across steps, exercising
the raymarch viewer's main features:

- an animated 3D gaussian blob (isotropic spacing) that translates and
  sharpens over steps — good for both MIP (glowing core) and ISO (a shrinking
  sphere-ish surface as it sharpens) modes.
- a static anisotropic-spacing volume (a hollow shell / SDF-ish field) with
  non-uniform ``spacing`` — exercises the physical-bounds / non-cubic-voxel
  path (the box mesh should render as a stretched box, not a cube).

Two runs are logged so the merge agent can build a 2-run comparison (panes).

Usage::

    uv run cairn init /tmp/cairn-volume
    CAIRN_REPO=/tmp/cairn-volume/.cairn uv run python examples/demo_volume.py
    uv run cairn ui --repo /tmp/cairn-volume/.cairn --port 4301
"""

from __future__ import annotations

import numpy as np

import cairn

PROJECT = "volume-demo"
NUM_STEPS = 10
N = 64  # cubic grid resolution for the animated blob


def gaussian_blob(n: int, center: np.ndarray, sigma: float) -> np.ndarray:
    """(n,n,n) float32 grid of a 3D gaussian centered at `center` (grid coords)."""
    zz, yy, xx = np.meshgrid(
        np.arange(n, dtype=np.float32),
        np.arange(n, dtype=np.float32),
        np.arange(n, dtype=np.float32),
        indexing="ij",
    )
    d2 = (zz - center[0]) ** 2 + (yy - center[1]) ** 2 + (xx - center[2]) ** 2
    return np.exp(-d2 / (2.0 * sigma * sigma)).astype(np.float32)


def hollow_shell(shape: tuple[int, int, int]) -> np.ndarray:
    """Anisotropic-shape volume: a hollow spherical shell (SDF-ish field)."""
    d, h, w = shape
    zz, yy, xx = np.meshgrid(
        np.linspace(-1, 1, d, dtype=np.float32),
        np.linspace(-1, 1, h, dtype=np.float32),
        np.linspace(-1, 1, w, dtype=np.float32),
        indexing="ij",
    )
    r = np.sqrt(zz**2 + yy**2 + xx**2)
    # Value peaks on a shell at r=0.6, falls off elsewhere — a clean isosurface.
    shell = np.exp(-((r - 0.6) ** 2) / (2 * 0.08**2))
    return shell.astype(np.float32)


def log_run(name: str, seed: int, direction: np.ndarray) -> None:
    rng = np.random.default_rng(seed)
    run = cairn.Run(project=PROJECT, name=name, tags=["volume"])
    run["grid_n"] = N

    start = np.array([N * 0.3, N * 0.3, N * 0.3], dtype=np.float32)
    for step in range(NUM_STEPS):
        t = step / max(NUM_STEPS - 1, 1)
        center = start + direction * (N * 0.35) * t  # translate across the grid
        sigma = 10.0 * (1.0 - 0.7 * t) + 1e-3  # sharpen over time
        blob = gaussian_blob(N, center, sigma)
        run.track(cairn.Volume(blob), name="blob", step=step)
        # a plain scalar too, per demo conventions
        run.track(float(sigma), name="blob_sigma", step=step)

    # One static anisotropic-spacing volume (non-cubic physical extent).
    shell = hollow_shell((24, 48, 96))
    run.track(
        cairn.Volume(shell, spacing=[2.0, 1.0, 0.5], origin=[0.0, 0.0, 0.0]),
        name="shell_anisotropic",
        step=0,
    )

    run.finish()
    print(f"  done: {name}")


def main() -> None:
    from cairn.config import resolve_target

    target = resolve_target()
    print(f"Logging to {target.kind} at {target.location}")
    log_run("run-a", seed=0, direction=np.array([1.0, 0.5, -0.6], dtype=np.float32))
    log_run("run-b", seed=7, direction=np.array([-0.8, 1.0, 0.4], dtype=np.float32))
    print(
        "\nAll done. Open the UI, add a Volume card (blob / shell_anisotropic), "
        "and build a 2-run comparison."
    )


if __name__ == "__main__":
    main()
