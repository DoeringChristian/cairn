"""Demo: 3D point-cloud cards (Workstream F).

Logs rotating synthetic shapes as ``cairn.PointCloud`` sequences across steps,
exercising every card feature:

- ``xyzrgb`` clouds (a rotating RGB sphere)   → color mode "rgb"
- ``xyzc``  clouds (a categorical torus scan) → color mode "category"
- ``xyz``   clouds (height-only helix)        → color mode "height" (viridis)
- a >300k cloud                               → log-time downsample + note
- a deterministic ``grid_scan`` cloud with a named per-point ``values=``
  "signal" property (same index/count across steps and across runs — only
  ``theta`` differs) → Property selector + the card's ``diff-property``/
  ``diff-position`` native comparison modes on genuinely same-topology data

Two runs are logged so the merge agent can build a 2-run comparison (panes).

Usage::

    uv run cairn init /tmp/cairn-pointcloud
    CAIRN_REPO=/tmp/cairn-pointcloud/.cairn uv run python examples/demo_pointcloud.py
    uv run cairn ui --repo /tmp/cairn-pointcloud/.cairn --port 4316
"""

from __future__ import annotations

import math

import numpy as np

import cairn

PROJECT = "pointcloud-demo"
NUM_STEPS = 12


def rotate_z(pts: np.ndarray, theta: float) -> np.ndarray:
    """Rotate an (N,3) xyz array about the z axis."""
    c, s = math.cos(theta), math.sin(theta)
    rot = np.array([[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]])
    return pts @ rot.T


def sphere_rgb(n: int, theta: float, rng: np.random.Generator) -> np.ndarray:
    """(N,6) rotating unit sphere; rgb encodes the surface normal (0-255)."""
    v = rng.normal(size=(n, 3))
    v /= np.linalg.norm(v, axis=1, keepdims=True) + 1e-9
    xyz = rotate_z(v, theta)
    rgb = ((xyz * 0.5 + 0.5) * 255.0).astype(np.float32)  # 0-255, auto-detected
    return np.hstack([xyz, rgb]).astype(np.float32)


def torus_category(n: int, theta: float, rng: np.random.Generator) -> np.ndarray:
    """(N,4) rotating torus; category id from the tube angle (4 segments)."""
    R, r = 1.0, 0.35
    u = rng.uniform(0.0, 2 * math.pi, size=n)
    v = rng.uniform(0.0, 2 * math.pi, size=n)
    x = (R + r * np.cos(v)) * np.cos(u)
    y = (R + r * np.cos(v)) * np.sin(u)
    z = r * np.sin(v)
    xyz = rotate_z(np.stack([x, y, z], axis=1), theta)
    cat = np.floor(u / (2 * math.pi) * 4).astype(np.float32)  # 0..3
    return np.hstack([xyz, cat[:, None]]).astype(np.float32)


def helix_xyz(n: int, theta: float) -> np.ndarray:
    """(N,3) helix that grows along z; colored by height in the UI (viridis)."""
    t = np.linspace(0.0, 6 * math.pi, n)
    x = np.cos(t + theta)
    y = np.sin(t + theta)
    z = np.linspace(-1.0, 1.0, n)
    return np.stack([x, y, z], axis=1).astype(np.float32)


def grid_scan(n_side: int, theta: float) -> tuple[np.ndarray, np.ndarray]:
    """Deterministic ``(n_side**3, 3)`` grid + a per-point "signal" property.

    Unlike the rng-driven clouds above, point *index i* denotes the SAME
    physical grid cell across every call (no resampling) — a genuine
    same-topology, same-count series across steps AND across ``run-a``/
    ``run-b`` (only ``theta`` differs), so the point-cloud card's
    ``diff-property`` (this ``signal``) and ``diff-position`` (points are
    static here, so that mode reads as all-zero — still exercises the code
    path) native comparison modes have real, index-corresponding data.
    """
    lin = np.linspace(-1.0, 1.0, n_side, dtype=np.float32)
    xx, yy, zz = np.meshgrid(lin, lin, lin, indexing="ij")
    xyz = np.stack([xx.ravel(), yy.ravel(), zz.ravel()], axis=1)
    signal = np.sin(3.0 * xyz[:, 0] + theta) * np.cos(3.0 * xyz[:, 1] + theta)
    return xyz.astype(np.float32), signal.astype(np.float32)


def log_run(name: str, seed: int, spin: float) -> None:
    rng = np.random.default_rng(seed)
    run = cairn.Run(project=PROJECT, name=name, tags=["pointcloud"])
    run["shape_seed"] = seed

    for step in range(NUM_STEPS):
        theta = spin * step * (2 * math.pi / NUM_STEPS)
        run.track(cairn.PointCloud(sphere_rgb(8000, theta, rng)), name="sphere_rgb", step=step)
        run.track(cairn.PointCloud(torus_category(8000, theta, rng)), name="torus_category", step=step)
        run.track(cairn.PointCloud(helix_xyz(4000, theta)), name="helix_height", step=step)

        xyz, signal = grid_scan(14, theta)
        run.track(cairn.PointCloud(xyz, values=signal), name="grid_scan", step=step)
        # a couple of scalar metrics so the run has non-media context too
        run.track(0.9 ** step, name="loss", step=step)

    # One oversized cloud (>300k) to exercise the log-time downsample path.
    big = rng.normal(size=(350_000, 3)).astype(np.float32)
    run.track(cairn.PointCloud(big), name="big_scan", step=0)

    run.finish()
    print(f"  done: {name}")


def main() -> None:
    from cairn.config import resolve_target

    target = resolve_target()
    print(f"Logging to {target.kind} at {target.location}")
    log_run("run-a", seed=0, spin=1.0)
    log_run("run-b", seed=7, spin=-1.5)
    print(
        "\nAll done. Open the UI, add a Point Clouds card (sphere_rgb / "
        "torus_category / helix_height), and build a 2-run comparison."
    )


if __name__ == "__main__":
    main()
