"""Prebuilt Cairn viewer assets — ``pip install 'cairn-track[ui]'``.

Data only. The single thing this package does is say where the built bundle
landed. Every route, shell and injection decision lives in cairn-track
(``cairn/viewer.py``), so this wheel holds no logic that could drift from the
server that serves it.

``dist_path`` is deliberately ``__file__``-relative rather than going through
``importlib.resources``: Starlette's ``StaticFiles(directory=...)`` needs a real
filesystem directory, and every real installer (pip, uv, editable) unpacks one.
Zipimport is not supported.
"""

from __future__ import annotations

from pathlib import Path

#: Kept in lock-step with cairn-track; pinned by a test in that repo half.
__version__ = "0.2.0"

__all__ = ["__version__", "dist_path"]


def dist_path() -> Path:
    """Directory holding index.html / embed.html / plot.html / assets/."""
    return Path(__file__).resolve().parent / "_dist"
