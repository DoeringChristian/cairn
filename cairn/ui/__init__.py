"""cairn.ui — drive the Cairn browser viewer from Python.

Needs ``pip install 'cairn-track[ui]'``. This is the authoring half of the
viewer: it builds card specs the browser's renderer consumes, and elements that
embed those cards in a notebook. It renders nothing itself.

Not to be confused with two neighbours:

* ``cairn-ui`` — the separate distribution holding the built browser bundle.
  This package drives that viewer; it does not contain it, and never names its
  files (see :mod:`cairn.viewer`, which owns that).
* :mod:`cairn.plot` — the renderer surface (``cairn-track[plot]``). Use it to
  draw a chart; use this to put a Cairn *card* on screen.

Everything here needs a reachable cairn server that is *serving* the viewer,
since a card is ultimately rendered by the browser at ``/embed/card``. Without
one the elements degrade to an inline notice rather than raising.

That server may be remote, which is why this module imports under
``cairn-track[plot]`` alone: constructing a card spec needs the renderer's
``Element`` and spec models, not a locally installed bundle. ``[ui]`` is what
you want if the viewer should also run *here* — it adds the bundle and implies
``[plot]``.
"""

from __future__ import annotations

from .card_spec import CardSettingsSpec, CardSpec, SeriesRef
from .compare import (
    boxes_compare,
    image_compare,
    media_compare,
    mesh_compare,
    pointcloud_compare,
    volume_compare,
)
from .elements import CardElement, HtmlElement
from .report import Report

__all__ = [
    "CardElement",
    "HtmlElement",
    "Report",
    "CardSpec",
    "CardSettingsSpec",
    "SeriesRef",
    "media_compare",
    "image_compare",
    "mesh_compare",
    "pointcloud_compare",
    "volume_compare",
    "boxes_compare",
]
