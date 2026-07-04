"""Demo: 3D box-hierarchy cards (Workstream B — octree/BVH).

Logs two ``boxes3d`` sequences per run, exercising every Boxes / BVH card
feature:

- ``octree``   — ``cairn.Octree``, adaptively refined (deeper near a moving
  point cluster) each step → depth-range filter + "depth" color mode +
  step-slider-driven refinement animation.
- ``bvh``      — ``cairn.BVH`` built top-down over a random triangle set,
  each node's ``value`` = the number of triangles it contains (a cost
  proxy) → "value" color mode + Colorbar with a real min/max range.
- ``grid_boxes`` — a DETERMINISTIC uniform box grid (same ``n_boxes``/depth
  every step and across ``run-a``/``run-b``; only the per-box "cost" value
  differs) → the boxes3d card's ``diff-property`` native comparison mode on
  genuinely matched-topology data (``octree``/``bvh`` above are rng-driven
  and so do NOT share topology across runs — they exercise the "mismatched
  topology, mode disabled with reason" path instead).

A plain scalar metric is logged too (``loss``), and two runs (`run-a`/
`run-b`) are written so the merge agent can build a 2-run comparison.

Usage::

    uv run cairn init /tmp/cairn-boxes3d
    CAIRN_REPO=/tmp/cairn-boxes3d/.cairn uv run python examples/demo_boxes3d.py
    uv run cairn ui --repo /tmp/cairn-boxes3d/.cairn --port 4301
"""

from __future__ import annotations

import math

import numpy as np

import cairn

PROJECT = "boxes3d-demo"
NUM_STEPS = 10


def build_octree(
    root_min: np.ndarray,
    root_max: np.ndarray,
    center: np.ndarray,
    max_depth: int,
    rng: np.random.Generator,
    refine_prob: float = 0.85,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Adaptive octree: subdivides more eagerly near ``center``.

    Returns ``(mins, maxs, depth)`` covering every visited cell (internal
    nodes included, not just leaves), so the depth-range filter has
    something to show at every level.
    """
    mins: list[np.ndarray] = []
    maxs: list[np.ndarray] = []
    depths: list[int] = []

    def recurse(mn: np.ndarray, mx: np.ndarray, depth: int) -> None:
        mins.append(mn)
        maxs.append(mx)
        depths.append(depth)
        if depth >= max_depth:
            return
        c = (mn + mx) / 2.0
        dist = float(np.linalg.norm(c - center))
        p = refine_prob * math.exp(-dist * 1.5)
        if depth < 1 or rng.random() < p:
            size = (mx - mn) / 2.0
            for ox in (0.0, 1.0):
                for oy in (0.0, 1.0):
                    for oz in (0.0, 1.0):
                        offset = np.array([ox, oy, oz]) * size
                        child_min = mn + offset
                        child_max = child_min + size
                        recurse(child_min, child_max, depth + 1)

    recurse(root_min, root_max, 0)
    return (
        np.array(mins, dtype=np.float32),
        np.array(maxs, dtype=np.float32),
        np.array(depths, dtype=np.uint16),
    )


def random_triangles(
    n: int, rng: np.random.Generator
) -> tuple[np.ndarray, np.ndarray]:
    """``n`` random triangles' per-triangle bounding boxes (as (mins, maxs))."""
    centers = rng.uniform(-2.0, 2.0, size=(n, 3))
    verts = centers[:, None, :] + rng.normal(scale=0.15, size=(n, 3, 3))
    mins = verts.min(axis=1).astype(np.float32)
    maxs = verts.max(axis=1).astype(np.float32)
    return mins, maxs


def build_bvh(
    prim_mins: np.ndarray,
    prim_maxs: np.ndarray,
    rng: np.random.Generator,
    max_depth: int = 7,
    min_prims: int = 2,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Top-down median-split BVH. Each node's value = primitive count."""
    mins: list[np.ndarray] = []
    maxs: list[np.ndarray] = []
    depths: list[int] = []
    values: list[float] = []

    def recurse(idxs: np.ndarray, depth: int) -> None:
        mn = prim_mins[idxs].min(axis=0)
        mx = prim_maxs[idxs].max(axis=0)
        mins.append(mn)
        maxs.append(mx)
        depths.append(depth)
        values.append(float(len(idxs)))
        if len(idxs) <= min_prims or depth >= max_depth:
            return
        centers = (prim_mins[idxs] + prim_maxs[idxs]) / 2.0
        axis = int(np.argmax(mx - mn))
        order = idxs[np.argsort(centers[:, axis])]
        mid = len(order) // 2
        recurse(order[:mid], depth + 1)
        recurse(order[mid:], depth + 1)

    recurse(np.arange(len(prim_mins)), 0)
    return (
        np.array(mins, dtype=np.float32),
        np.array(maxs, dtype=np.float32),
        np.array(depths, dtype=np.uint16),
        np.array(values, dtype=np.float32),
    )


def fixed_grid_boxes(
    n_side: int = 4, half: float = 2.0
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """A deterministic uniform ``n_side**3`` box grid (mins, maxs, depth=1).

    Unlike ``build_octree``/``build_bvh`` above (which are rng-driven and so
    produce a DIFFERENT ``n_boxes``/topology per run — no matched-topology
    pair to diff), this grid has an identical box layout every call: a
    genuine same-``n_boxes``-and-``depth`` pair across ``run-a``/``run-b``
    for the boxes3d card's ``diff-property`` native comparison mode.
    """
    edges = np.linspace(-half, half, n_side + 1, dtype=np.float32)
    mins = []
    maxs = []
    for i in range(n_side):
        for j in range(n_side):
            for k in range(n_side):
                mins.append([edges[i], edges[j], edges[k]])
                maxs.append([edges[i + 1], edges[j + 1], edges[k + 1]])
    mins_arr = np.array(mins, dtype=np.float32)
    maxs_arr = np.array(maxs, dtype=np.float32)
    depth = np.ones(len(mins_arr), dtype=np.uint16)
    return mins_arr, maxs_arr, depth


def grid_box_values(mins: np.ndarray, maxs: np.ndarray, center: np.ndarray) -> np.ndarray:
    """Per-box "cost" = distance from each box's center to a moving ``center``."""
    box_centers = (mins + maxs) / 2.0
    return np.linalg.norm(box_centers - center[None, :], axis=1).astype(np.float32)


def log_run(name: str, seed: int, orbit_radius: float) -> None:
    rng = np.random.default_rng(seed)
    run = cairn.Run(project=PROJECT, name=name, tags=["boxes3d"])
    run["orbit_radius"] = orbit_radius

    root_min = np.array([-2.0, -2.0, -2.0], dtype=np.float32)
    root_max = np.array([2.0, 2.0, 2.0], dtype=np.float32)
    grid_mins, grid_maxs, grid_depth = fixed_grid_boxes()

    for step in range(NUM_STEPS):
        theta = step * (2 * math.pi / NUM_STEPS)
        center = np.array(
            [orbit_radius * math.cos(theta), orbit_radius * math.sin(theta), 0.0]
        )
        mins, maxs, depth = build_octree(root_min, root_max, center, max_depth=4, rng=rng)
        run.track(cairn.Octree(mins, maxs, depth=depth), name="octree", step=step)

        # Deterministic same-topology grid (see fixed_grid_boxes docstring) —
        # only the per-box "cost" value differs, real data for
        # boxes3d's diff-property native comparison mode across run-a/run-b.
        grid_values = grid_box_values(grid_mins, grid_maxs, center)
        run.track(
            cairn.Boxes3D(grid_mins, grid_maxs, depth=grid_depth, values=grid_values),
            name="grid_boxes",
            step=step,
        )

        # BVH over a triangle set that grows slightly over steps.
        n_tris = 80 + step * 10
        prim_mins, prim_maxs = random_triangles(n_tris, rng)
        bvh_mins, bvh_maxs, bvh_depth, bvh_values = build_bvh(prim_mins, prim_maxs, rng)
        run.track(
            cairn.BVH(bvh_mins, bvh_maxs, depth=bvh_depth, values=bvh_values),
            name="bvh",
            step=step,
        )

        run.track(0.9 ** step, name="loss", step=step)

    run.finish()
    print(f"  done: {name}")


def main() -> None:
    from cairn.config import resolve_target

    target = resolve_target()
    print(f"Logging to {target.kind} at {target.location}")
    log_run("run-a", seed=0, orbit_radius=1.0)
    log_run("run-b", seed=7, orbit_radius=1.5)
    print(
        "\nAll done. Open the UI, add an Octree / BVH card (octree / bvh), "
        "and build a 2-run comparison."
    )


if __name__ == "__main__":
    main()
