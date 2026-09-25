"""cairn.ui — the Cairn viewer's Python surface, if it is installed.

A binding, not an implementation: the code lives in ``cairn_ui.cards``, shipped
by the ``cairn-ui`` distribution alongside the browser bundle it drives. This
module exists so the import reads ``cairn.ui`` rather than ``cairn_ui.cards``,
exactly as ``cairn.plot`` binds onto ``cairn_plot``.

Needs ``pip install 'cairn-track[ui]'``; ``cairn.__getattr__`` turns a missing
distribution into that hint.
"""

from __future__ import annotations

from cairn_ui.cards import *  # noqa: F401,F403
from cairn_ui.cards import __all__ as __all__
