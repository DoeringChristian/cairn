"""Cairn — open-source ML experiment tracker."""

from __future__ import annotations

__version__ = "0.1.0"

# Top-level API (re-exports from cairn.sdk).
from .config import configure  # noqa: E402
from .sdk import handlers  # noqa: E402, F401  - registers built-in handlers
from .sdk.handlers.registry import register_handler  # noqa: E402
from .sdk.run import Run  # noqa: E402
from .sdk.wrappers import (  # noqa: E402
    Audio,
    Figure,
    Histogram,
    Image,
    Plugin,
    Tensor,
    Text,
    Video,
)

__all__ = [
    "__version__",
    "Run",
    "configure",
    "register_handler",
    "Image",
    "Figure",
    "Audio",
    "Video",
    "Histogram",
    "Tensor",
    "Text",
    "Plugin",
]
