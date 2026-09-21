"""cairn.plot — the cairn-facing plotting surface (P2-M2 packaging shim).

The pure plotting library now lives in the standalone ``cairn_plot``
distribution (``import cairn_plot as cp``). This module re-exports its entire
public surface unchanged — the composable components (``cp.Line``/``cp.Image``/
``cp.Grid``/``cp.Compare``/…), the lowercase builders (``cp.scalar``/``cp.image``
/…), ``cp.Report``/``cp.report``, and the pure-numpy Plotly recipes
(``cp.confusion_matrix``/``cp.roc_curve``/``cp.bar``/…) — so every existing
``import cairn.plot as cp`` keeps working identically.

On top of that pure surface it layers cairn's run-integration extras, which
``cairn_plot`` itself must not couple to (packaging spec §3–§4):

* it registers the reader's ``DataRef`` type so a ``run[tag]`` handle is
  recognized by the pure components (``cp.Line(run["loss"])``), and the
  tracking-handler serializers so raw tabular / 3D-array data
  (``cp.Table(df)`` / ``cp.PointCloud(arr)``) shapes through the exact same
  ``handlers/*`` code the tracking path uses;
The comparison card helpers that used to live here moved to :mod:`cairn.ui`
(``cairn.ui.media_compare`` and friends): they build a card spec for the
browser's renderer rather than rendering anything, so they belong with the rest
of the viewer surface. They are re-exported below for one release.
"""

from __future__ import annotations

import json as _json
import uuid as _uuid
from typing import Any, Sequence

# Re-export the whole standalone surface (components, builders, recipes, Report).
import cairn_plot as _cairn_plot
from cairn_plot import *  # noqa: F401,F403
from cairn_plot import Boxes, Compare, Mesh, PointCloud, Volume  # noqa: F401
from cairn_plot.components import register_data_ref_type, register_resolvers

from .sdk.reader import ArtifactInfo, DataRef  # noqa: F401 - ArtifactInfo kept for callers


# ---------------------------------------------------------------------------
# Wire the DataRef seam (packaging spec §4): teach the pure plot components to
# recognize a cairn ``run[tag]`` handle without importing cairn.sdk.reader
# themselves.
# ---------------------------------------------------------------------------

register_data_ref_type(DataRef)


# ---------------------------------------------------------------------------
# Wire the tracking-handler serializers: the raw-table + 3D-array data paths
# need cairn's ``handlers/*`` (which ``cairn_plot`` must not import). Registered
# into the pure components' resolver seam so ``cp.Table(df)`` /
# ``cp.PointCloud(arr)`` / ``cp.Mesh(v, f)`` / … keep working unchanged.
# ---------------------------------------------------------------------------


def _table_json_from_raw(data: Any) -> dict[str, Any]:
    """Raw tabular data → the canonical table blob, via the same
    ``TableHandler`` the tracking path uses (columns/type inference identical)."""
    from .sdk.handlers.table import TableHandler

    if hasattr(data, "itertuples") and hasattr(data, "columns"):
        wrapper: dict[str, Any] = {"dataframe": data}
    elif isinstance(data, dict):
        wrapper = {"columns": list(data.keys()), "data": list(zip(*data.values()))} if data else {"data": []}
    else:
        rows = list(data)
        if rows and isinstance(rows[0], dict):
            columns: list[str] = []
            for r in rows:
                for k in r:
                    if k not in columns:
                        columns.append(k)
            wrapper = {"columns": columns, "data": [[r.get(c) for c in columns] for r in rows]}
        else:
            wrapper = {"data": rows}
    blob, _meta = TableHandler().serialize(wrapper)
    return _json.loads(blob.decode("utf-8"))


def _serialize_pointcloud(data: Any, values: Any = None) -> tuple[bytes, dict[str, Any]]:
    from .sdk.handlers.pointcloud import PointCloudHandler

    return PointCloudHandler().serialize(data, values=values)


def _serialize_mesh(payload: dict[str, Any]) -> tuple[bytes, dict[str, Any]]:
    from .sdk.handlers.mesh import MeshHandler

    return MeshHandler().serialize(payload)


def _serialize_volume(grid: Any, spacing: Any = None, origin: Any = None) -> tuple[bytes, dict[str, Any]]:
    from .sdk.handlers.volume import VolumeHandler

    return VolumeHandler().serialize(grid, spacing=spacing, origin=origin)


def _serialize_boxes3d(payload: dict[str, Any], kind: str = "boxes") -> tuple[bytes, dict[str, Any]]:
    from .sdk.handlers.boxes3d import Boxes3DHandler

    return Boxes3DHandler().serialize(payload, kind=kind)


register_resolvers(
    table_raw=_table_json_from_raw,
    serialize_pointcloud=_serialize_pointcloud,
    serialize_mesh=_serialize_mesh,
    serialize_volume=_serialize_volume,
    serialize_boxes3d=_serialize_boxes3d,
)

# Compatibility re-export: these now live in `cairn.ui`. Kept importable from
# `cairn.plot` for one release so existing notebooks keep working.
from .ui.compare import (  # noqa: E402,F401
    boxes_compare,
    image_compare,
    media_compare,
    mesh_compare,
    pointcloud_compare,
    volume_compare,
)

# The public surface = the standalone cairn_plot surface + the compatibility
# re-export of the card helpers above.
__all__ = list(_cairn_plot.__all__) + [
    "media_compare",
    "image_compare",
    "mesh_compare",
    "pointcloud_compare",
    "volume_compare",
    "boxes_compare",
]
