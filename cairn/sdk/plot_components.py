"""Compatibility shim — the composable ``cairn.plot`` component API moved to
:mod:`cairn_plot.components` (P2-M2 packaging split).

Re-exported here so ``from cairn.sdk.plot_components import ...`` (used by
``cairn.plot`` and the tests) keeps working unchanged. ``cairn.plot`` also uses
the registry seams (:func:`register_data_ref_type` / :func:`register_resolvers`)
to wire the cairn-side ``DataRef`` recognition and the tracking-handler
serializers into the pure package.
"""

from __future__ import annotations

from cairn_plot.components import (  # noqa: F401 - re-exported for zero caller changes
    Bar,
    Boxes,
    Compare,
    Component,
    Figure,
    Grid,
    Heatmap,
    Histogram,
    Image,
    Line,
    Mesh,
    ParallelCoordinates,
    PointCloud,
    Scatter,
    Shared,
    Table,
    Volume,
    _is_data_ref,
    register_data_ref_type,
    register_resolvers,
)
