"""Explicit type wrappers that force a specific handler (Aim-style).

Useful for disambiguating polymorphic inputs — e.g. a matplotlib ``Figure``
could reasonably be tracked as an ``image`` (flat PNG) or a ``figure``
(interactive Plotly). Wrappers let the user make the choice at the call site.
"""

from __future__ import annotations

from typing import Any


class _TypeWrapper:
    """Base class for explicit type wrappers.

    Subclasses set ``object_type`` as a class attribute. The ``obj`` and
    ``kwargs`` instance attributes are consumed by the handler dispatcher.
    """

    object_type: str = ""

    def __init__(self, obj: Any, **kwargs: Any):
        self.obj = obj
        self.kwargs = kwargs


class Image(_TypeWrapper):
    """Image, optionally with bounding-box and/or segmentation-mask overlays.

    Overlays are stored inline in the artifact metadata (no second blob).

    Usage::

        run.track(cairn.Image(
            img,
            boxes=[{
                "position": {"minX": 0.1, "minY": 0.2, "maxX": 0.5, "maxY": 0.6},
                "domain": "fraction",   # or "pixel"
                "class_id": 1,
                "label": "cat",
                "score": 0.92,
            }],
            masks={"seg": class_id_array_2d},   # uint8 class ids, 0 = background
            class_labels={0: "background", 1: "cat", 2: "dog"},
        ), name="detections", step=step)
    """

    object_type = "image"


class Figure(_TypeWrapper):
    object_type = "figure"


class Audio(_TypeWrapper):
    object_type = "audio"


class Video(_TypeWrapper):
    object_type = "video"


class Histogram(_TypeWrapper):
    object_type = "histogram"


class Tensor(_TypeWrapper):
    object_type = "tensor"


class Text(_TypeWrapper):
    object_type = "text"


class Table(_TypeWrapper):
    """Tabular data (columns + rows), stored as a compact JSON blob.

    Construct either from explicit ``columns`` + ``data``::

        run.track(
            cairn.Table(
                columns=["epoch", "loss", "correct"],
                data=[[0, 1.2, False], [1, 0.7, True]],
            ),
            name="predictions",
            step=0,
        )

    or from a pandas ``DataFrame``::

        run.track(cairn.Table(dataframe=df), name="predictions", step=0)

    Column types (``number``/``string``/``bool``/``other``) are inferred at log
    time. Rows are capped at 10,000 — larger tables are truncated (the original
    row count is recorded in metadata). Values that are not JSON-native are
    stringified. See ``handlers/table.py``.
    """

    object_type = "table"

    def __init__(
        self,
        columns: Any = None,
        data: Any = None,
        dataframe: Any = None,
        **kwargs: Any,
    ):
        # Unlike the positional-``obj`` wrappers, Table takes named tabular
        # inputs; the handler normalises them from this dict.
        self.obj = {"columns": columns, "data": data, "dataframe": dataframe}
        self.kwargs = kwargs


class Html(_TypeWrapper):
    """Sandboxed HTML report string.

    Rendered only inside a ``sandbox="allow-scripts"`` ``srcdoc`` iframe by
    the UI — never inline in the host document.

    Usage::

        run.track(cairn.Html("<h1>Report</h1><p>...</p>"), name="report", step=0)
    """
    object_type = "html"


class Markdown(_TypeWrapper):
    """Markdown text, rendered with GitHub-flavored-markdown support.

    Usage::

        run.track(cairn.Markdown("# Notes\\n\\n- [x] done\\n- [ ] todo"), name="notes", step=0)
    """
    object_type = "markdown"


class PointCloud(_TypeWrapper):
    """3D point cloud from an ``(N, C)`` numpy/torch array.

    Accepts three channel layouts (``C`` inferred from the array):

    - ``(N, 3)`` — ``xyz`` positions only.
    - ``(N, 4)`` — ``xyz`` + an integer ``category`` id per point.
    - ``(N, 6)`` — ``xyz`` + ``rgb`` color. Color is auto-detected as either
      ``0-255`` or ``0-1`` and normalized to ``0-1`` at log time.

    Clouds larger than 300,000 points are uniformly downsampled (seeded) at
    log time; the original count is preserved in metadata.

    Optional ``values``: a length-``N`` scalar array (canonicalized to a
    single ``"value"`` property) or a ``dict[str, array]`` of named
    per-point scalar properties (e.g. curvature, per-point loss), downsampled
    together with the cloud. Feeds a "Property" selector + colormap/Colorbar
    in the UI, same mechanism as ``Mesh``/``Boxes3D``.

    Usage::

        run.track(cairn.PointCloud(xyz), name="cloud", step=0)          # (N, 3)
        run.track(cairn.PointCloud(xyz_rgb), name="scan", step=0)        # (N, 6)
        run.track(cairn.PointCloud(xyz_cat), name="segments", step=0)    # (N, 4)
        run.track(cairn.PointCloud(xyz, values=per_point_loss), name="cloud", step=0)
        run.track(cairn.PointCloud(xyz, values={"loss": l, "curvature": c}), name="cloud", step=0)
    """

    object_type = "pointcloud"

    def __init__(self, points: Any, values: Any = None, **kwargs: Any):
        self.obj = points
        self.kwargs = {**kwargs, "values": values}


class Mesh(_TypeWrapper):
    """3D indexed triangle mesh from vertex/face numpy/torch arrays.

    ``vertices`` is an ``(N, 3)`` array of positions; ``faces`` is an
    ``(M, 3)`` array of triangle vertex indices (validated ``< N``). Faces
    are expected to be wound counter-clockwise as seen from outside the
    surface (the right-hand-rule convention: ``cross(v1-v0, v2-v0)`` points
    outward). You don't have to get this perfect — at log time ``serialize``
    normalizes winding topologically: orientation is propagated across
    shared edges within each connected component (repairing MIXED winding —
    e.g. after boolean ops or concatenating inconsistently-wound sub-meshes
    — exactly, for any manifold shape), then each component is globally
    oriented outward by signed volume when closed (exact for any closed
    manifold, torus/concave shapes included) or by a centroid-direction
    majority vote when open (approximate; see ``handlers/mesh.py``).
    Non-manifold meshes (an edge shared by >2 faces) are stored with their
    winding completely untouched and flagged ``winding: "unnormalized"`` in
    metadata; the UI's double-sided rendering default keeps those (and any
    open-surface residuals) displayable. Optional per-vertex attributes:

    - ``values``: a length-``N`` scalar array (canonicalized to a single
      ``"value"`` property), or a ``dict[str, array]`` of named per-vertex
      scalar properties (e.g. curvature, temperature, a training signal per
      vertex) — each is colored via a colormap in the UI, with a "Property"
      selector shown when more than one is logged.
    - ``colors``: an ``(N, 3)`` RGB array. Color is auto-detected as either
      ``0-255`` or ``0-1`` and normalized to ``0-1`` at log time.
    - ``normals``: an ``(N, 3)`` array; the UI computes smooth-shading
      normals itself when omitted (from the post-winding-normalization
      faces). Supplied normals are per-vertex and are never modified by
      winding normalization, which only reorders each face's own indices.

    Usage::

        run.track(cairn.Mesh(vertices, faces), name="mesh", step=0)
        run.track(cairn.Mesh(vertices, faces, values=curvature), name="mesh", step=0)
        run.track(cairn.Mesh(vertices, faces, values={"curvature": c, "loss": l}), name="mesh", step=0)
        run.track(cairn.Mesh(vertices, faces, colors=vertex_rgb), name="mesh", step=0)
    """

    object_type = "mesh"

    def __init__(
        self,
        vertices: Any,
        faces: Any,
        values: Any = None,
        colors: Any = None,
        normals: Any = None,
        **kwargs: Any,
    ):
        self.obj = {
            "vertices": vertices,
            "faces": faces,
            "values": values,
            "colors": colors,
            "normals": normals,
        }
        self.kwargs = kwargs


class Boxes3D(_TypeWrapper):
    """Axis-aligned box hierarchy (octree/BVH) from ``mins``/``maxs`` arrays.

    Both an octree's cells and a BVH's node bounds are just axis-aligned
    boxes with a depth level and an optional per-box scalar value — the
    renderer treats them identically, so ``Boxes3D``/``Octree``/``BVH`` all
    serialize to the same ``boxes3d`` object type. ``kind`` is metadata-only
    (drives labeling in the UI); the array contract is shared.

    - ``mins``/``maxs``: ``(N, 3)`` numpy/torch arrays, one row per box.
      Every box must satisfy ``mins <= maxs`` elementwise.
    - ``depth``: optional ``(N,)`` integer array (defaults to all zeros —
      a flat, unstructured box set).
    - ``values``: optional ``(N,)`` float array for value-based coloring, or
      a ``dict[str, array]`` of named per-box scalar properties (e.g. node
      cost, IoU) — a "Property" selector appears in the UI when more than
      one is logged.

    Box sets larger than 200,000 rows raise (no silent truncation).

    Usage::

        run.track(cairn.Boxes3D(mins, maxs), name="boxes", step=0)
        run.track(cairn.Octree(mins, maxs, depth=depth), name="octree", step=0)
        run.track(cairn.BVH(mins, maxs, values=node_cost), name="bvh", step=0)
        run.track(cairn.BVH(mins, maxs, values={"cost": c, "iou": iou}), name="bvh", step=0)
    """

    object_type = "boxes3d"
    kind = "boxes"

    def __init__(
        self,
        mins: Any,
        maxs: Any,
        depth: Any = None,
        values: Any = None,
        **kwargs: Any,
    ):
        self.obj = {"mins": mins, "maxs": maxs, "depth": depth, "values": values}
        self.kwargs = {**kwargs, "kind": self.kind}


class Octree(Boxes3D):
    """``Boxes3D`` with ``kind="octree"`` metadata (nested cell boxes)."""

    kind = "octree"


class BVH(Boxes3D):
    """``Boxes3D`` with ``kind="bvh"`` metadata (bounding-volume-hierarchy node boxes)."""

    kind = "bvh"


class Volume(_TypeWrapper):
    """Dense scalar 3D volume from a ``(D, H, W)`` numpy/torch array.

    Rendered in the UI via WebGL2 raymarching (maximum-intensity-projection
    or isosurface modes, with a colormap transfer function and per-axis box
    clipping for slicing). Optional ``spacing``/``origin`` (each length-3,
    matching the ``[D, H, W]`` axis order) place the grid in physical space;
    both default to ``[1, 1, 1]`` / ``[0, 0, 0]`` (a unit-per-voxel grid at
    the origin) when omitted.

    Capped at 128MB pre-compression (as float32) — larger volumes raise
    ``ValueError`` at log time rather than being silently truncated.

    Usage::

        run.track(cairn.Volume(density), name="blob", step=0)
        run.track(cairn.Volume(density, spacing=[2.0, 1.0, 1.0]), name="scan", step=0)
    """

    object_type = "volume"


class Artifact(_TypeWrapper):
    """Pickle-serialized Python object.

    Wraps any Python object and stores it as a pickle blob. Useful for
    tracking checkpoints, configs, custom dataclasses, model state dicts,
    or any other Python object that doesn't fit into the typed wrappers.

    Download via the UI yields a ``.pkl`` file that can be loaded with
    ``pickle.load(open("file.pkl", "rb"))``.

    Usage::

        run.track(cairn.Artifact({"lr": 1e-3, "model": "cnn"}), name="config", step=0)
        run.track(cairn.Artifact(model.state_dict()), name="checkpoint", step=100)
        run.log_artifact(cairn.Artifact(my_dataclass), name="final_state")
    """
    object_type = "artifact"
