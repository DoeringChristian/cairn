"""Compatibility shim — the cairn-plot bundle access + serialization helpers
moved to :mod:`cairn_plot.bundle` (P2-M2 packaging split).

Re-exported here so ``from cairn.sdk import _plot_bundle as pb`` and the emit
tests (``pb.json_script_safe`` / ``pb.inline_core_js`` / …) keep working
unchanged. The re-exported callables ARE the same objects
``cairn_plot.elements`` / ``cairn_plot.report`` call, so their ``lru_cache`` and
the resolved dist stay in lock-step.
"""

from __future__ import annotations

from cairn_plot.bundle import (  # noqa: F401 - re-exported for zero caller changes
    BundleUnavailable,
    inline_bundle_css,
    inline_bundle_js,
    inline_core_css,
    inline_core_js,
    inline_figure_addon_js,
    inline_gpu_image_addon_js,
    inline_three_addon_js,
    js_inline_safe,
    json_script_safe,
    link_asset_urls,
)
