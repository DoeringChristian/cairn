"""Built-in type handlers. Importing this module registers them with the
default registry in LIFO order matching the spec's dispatch table.
"""

from __future__ import annotations

from .audio import AudioHandler
from .figure import FigureHandler
from .histogram import HistogramHandler
from .image import ImageHandler
from .plugin import PluginHandler
from .registry import (
    HandlerRegistry,
    TypeHandler,
    default_registry,
    register_handler,
)
from .scalar import ScalarHandler
from .tensor import TensorHandler
from .text import TextHandler
from .video import VideoHandler

# Register built-ins. Order is important for ``can_handle`` dispatch — later
# wins. We register scalar/text first (cheap, common), then media types.
# Figure before image means a matplotlib Figure is caught as 'figure' by
# default, which matches the spec's "automatic: whatever the registry decides
# — for matplotlib Figure, default is `figure`" statement.
_already_registered = False
if not _already_registered:
    default_registry.register(ScalarHandler())
    default_registry.register(TextHandler())
    default_registry.register(ImageHandler())
    default_registry.register(AudioHandler())
    default_registry.register(VideoHandler())
    default_registry.register(FigureHandler())
    # Histogram + Tensor only dispatch via wrapper, so their order among
    # themselves doesn't matter.
    default_registry.register(HistogramHandler())
    default_registry.register(TensorHandler())
    default_registry.register(PluginHandler())
    _already_registered = True


__all__ = [
    "HandlerRegistry",
    "TypeHandler",
    "default_registry",
    "register_handler",
    "ScalarHandler",
    "TextHandler",
    "ImageHandler",
    "AudioHandler",
    "VideoHandler",
    "FigureHandler",
    "HistogramHandler",
    "TensorHandler",
    "PluginHandler",
]
