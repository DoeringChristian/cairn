"""Demo: 3D mesh cards (Workstream M).

Logs deforming/colored/faceted meshes as ``cairn.Mesh`` sequences across
steps, exercising every card feature:

- a deforming "blob" sphere with per-vertex ``values`` (color mode
  "values", Colorbar with a real [min, max] range) that changes each step
- a rotating torus with explicit per-vertex ``colors`` (color mode
  "vertex-colors")
- a faceted cube with explicit per-vertex ``normals`` (flat shading via the
  provided normals; no ``computeVertexNormals`` needed)

Two runs are logged so the merge agent can build a 2-run comparison (panes).

Usage::

    uv run cairn init /tmp/cairn-mesh
    CAIRN_REPO=/tmp/cairn-mesh/.cairn uv run python examples/demo_mesh.py
    uv run cairn ui --repo /tmp/cairn-mesh/.cairn --port 4317
"""

from __future__ import annotations

import math

import numpy as np

import cairn

PROJECT = "mesh-demo"
NUM_STEPS = 10


def uv_sphere(n_lat: int, n_lon: int) -> tuple[np.ndarray, np.ndarray]:
    """Base unit UV-sphere: ``(vertices (N,3), faces (M,3))``."""
    verts = []
    for i in range(n_lat + 1):
        theta = math.pi * i / n_lat  # 0..pi
        for j in range(n_lon):
            phi = 2 * math.pi * j / n_lon
            x = math.sin(theta) * math.cos(phi)
            y = math.sin(theta) * math.sin(phi)
            z = math.cos(theta)
            verts.append((x, y, z))
    vertices = np.array(verts, dtype=np.float64)

    faces = []
    for i in range(n_lat):
        for j in range(n_lon):
            a = i * n_lon + j
            b = i * n_lon + (j + 1) % n_lon
            c = (i + 1) * n_lon + j
            d = (i + 1) * n_lon + (j + 1) % n_lon
            faces.append((a, b, c))
            faces.append((b, d, c))
    return vertices, np.array(faces, dtype=np.int64)


def blob_sphere(base: np.ndarray, theta: float, freq: float) -> tuple[np.ndarray, np.ndarray]:
    """Radially deform a unit sphere by a per-vertex sine bump.

    Returns ``(deformed vertices, per-vertex bump value)``.
    """
    lat = np.arccos(np.clip(base[:, 2], -1.0, 1.0))
    lon = np.arctan2(base[:, 1], base[:, 0])
    bump = 0.25 * np.sin(freq * lat + theta) * np.cos(2 * lon + theta)
    deformed = base * (1.0 + bump)[:, None]
    return deformed.astype(np.float32), bump.astype(np.float32)


def torus(n_u: int, n_v: int, big_r: float = 1.0, tube_r: float = 0.35) -> tuple[np.ndarray, np.ndarray]:
    verts = []
    for i in range(n_u):
        u = 2 * math.pi * i / n_u
        for j in range(n_v):
            v = 2 * math.pi * j / n_v
            x = (big_r + tube_r * math.cos(v)) * math.cos(u)
            y = (big_r + tube_r * math.cos(v)) * math.sin(u)
            z = tube_r * math.sin(v)
            verts.append((x, y, z))
    vertices = np.array(verts, dtype=np.float32)

    faces = []
    for i in range(n_u):
        for j in range(n_v):
            a = i * n_v + j
            b = i * n_v + (j + 1) % n_v
            c = ((i + 1) % n_u) * n_v + j
            d = ((i + 1) % n_u) * n_v + (j + 1) % n_v
            faces.append((a, b, c))
            faces.append((b, d, c))
    return vertices, np.array(faces, dtype=np.int64)


def torus_colors(vertices: np.ndarray, theta: float) -> np.ndarray:
    """Rainbow colors around the tube angle, rotating with ``theta`` (0-1 RGB)."""
    v_angle = np.arctan2(vertices[:, 2], np.hypot(vertices[:, 0], vertices[:, 1]) - 1.0)
    hue = ((v_angle + theta) % (2 * math.pi)) / (2 * math.pi)
    h6 = hue * 6.0
    x = 1 - np.abs(h6 % 2 - 1)
    conds = [h6 < 1, h6 < 2, h6 < 3, h6 < 4, h6 < 5, h6 <= 6]
    r = np.select(conds, [1, x, 0, 0, x, 1])
    g = np.select(conds, [x, 1, 1, x, 0, 0])
    b = np.select(conds, [0, 0, x, 1, 1, x])
    return np.stack([r, g, b], axis=1).astype(np.float32)


def faceted_cube() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """A cube with duplicated per-face vertices + explicit flat normals."""
    face_defs = [
        ((0, 0, 1), [(-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]),
        ((0, 0, -1), [(-1, 1, -1), (1, 1, -1), (1, -1, -1), (-1, -1, -1)]),
        ((0, 1, 0), [(-1, 1, -1), (-1, 1, 1), (1, 1, 1), (1, 1, -1)]),
        ((0, -1, 0), [(-1, -1, 1), (-1, -1, -1), (1, -1, -1), (1, -1, 1)]),
        ((1, 0, 0), [(1, -1, -1), (1, 1, -1), (1, 1, 1), (1, -1, 1)]),
        ((-1, 0, 0), [(-1, -1, 1), (-1, 1, 1), (-1, 1, -1), (-1, -1, -1)]),
    ]
    vertices: list[tuple[float, float, float]] = []
    normals: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int]] = []
    for normal, corners in face_defs:
        base = len(vertices)
        for c in corners:
            vertices.append(c)
            normals.append(normal)
        faces.append((base, base + 1, base + 2))
        faces.append((base, base + 2, base + 3))
    return (
        np.array(vertices, dtype=np.float32) * 0.7,
        np.array(normals, dtype=np.float32),
        np.array(faces, dtype=np.int64),
    )


def log_run(name: str, seed: int, phase: float) -> None:
    run = cairn.Run(project=PROJECT, name=name, tags=["mesh"])
    run["shape_seed"] = seed

    base_sphere, sphere_faces = uv_sphere(24, 36)
    torus_v, torus_f = torus(28, 14)
    cube_v, cube_n, cube_f = faceted_cube()

    for step in range(NUM_STEPS):
        theta = phase * step * (2 * math.pi / NUM_STEPS)

        deformed, values = blob_sphere(base_sphere, theta, freq=5.0)
        run.track(cairn.Mesh(deformed, sphere_faces, values=values), name="blob_sphere", step=step)

        colors = torus_colors(torus_v, theta)
        run.track(cairn.Mesh(torus_v, torus_f, colors=colors), name="rainbow_torus", step=step)

        # Static shape, but logged every step too so it shares the slider.
        run.track(cairn.Mesh(cube_v, cube_f, normals=cube_n), name="faceted_cube", step=step)

        run.track(0.9 ** step, name="loss", step=step)

    run.finish()
    print(f"  done: {name}")


def main() -> None:
    from cairn.config import resolve_target

    target = resolve_target()
    print(f"Logging to {target.kind} at {target.location}")
    log_run("run-a", seed=0, phase=1.0)
    log_run("run-b", seed=7, phase=-1.5)
    print(
        "\nAll done. Open the UI, add a 3D Mesh card (blob_sphere / "
        "rainbow_torus / faceted_cube), and build a 2-run comparison."
    )


if __name__ == "__main__":
    main()
