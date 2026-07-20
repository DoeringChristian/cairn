"""Resolver-registration ordering across the cairn_plot / cairn.plot seam.

``cairn_plot`` now ships DEFAULT raw-data resolvers (``_default_resolvers``,
routing through the vendored pure ``cairn_plot._sdk`` handlers) so the
standalone package's local(baked) data mode is self-contained. When the full
``cairn-track`` install is present, ``cairn.plot`` re-registers its own
resolvers (routing through cairn's tracking ``handlers/*``) ON TOP of those
defaults — a plain ``dict.update``, last-write-wins.

This guards the override ordering: the defaults must be registered by the pure
package, and importing ``cairn.plot`` must win. Run in subprocesses so the
import order (and therefore the registration order) is deterministic and not
polluted by whatever other tests already imported ``cairn.plot``.
"""

from __future__ import annotations

import subprocess
import sys

_RESOLVER_KEYS = (
    "table_raw",
    "serialize_pointcloud",
    "serialize_mesh",
    "serialize_volume",
    "serialize_boxes3d",
)


def _run(code: str) -> str:
    out = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        check=True,
    )
    return out.stdout.strip()


def test_pure_package_registers_self_contained_defaults():
    """`import cairn_plot` alone wires the vendored `_default_resolvers`."""
    code = (
        "import cairn_plot\n"
        "from cairn_plot import components\n"
        "mods = {k: getattr(components._RESOLVERS.get(k), '__module__', None)"
        f" for k in {_RESOLVER_KEYS!r}}}\n"
        "print(mods)\n"
    )
    result = eval(_run(code))
    assert result, "no resolvers registered by cairn_plot"
    for key in _RESOLVER_KEYS:
        assert result[key] == "cairn_plot._default_resolvers", (
            f"{key} should default to cairn_plot._default_resolvers, got {result[key]}"
        )


def test_cairn_plot_import_overrides_defaults():
    """`import cairn.plot` re-registers cairn's tracking-handler resolvers on top."""
    code = (
        "import cairn_plot  # registers defaults first\n"
        "import cairn.plot  # must override\n"
        "from cairn_plot import components\n"
        "mods = {k: getattr(components._RESOLVERS.get(k), '__module__', None)"
        f" for k in {_RESOLVER_KEYS!r}}}\n"
        "print(mods)\n"
    )
    result = eval(_run(code))
    for key in _RESOLVER_KEYS:
        assert result[key] == "cairn.plot", (
            f"{key} should be overridden by cairn.plot, got {result[key]}"
        )
