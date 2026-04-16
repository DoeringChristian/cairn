"""Figure handler — matplotlib / plotly → dual storage (PNG primary + source).

Design: the primary artifact is always a flat PNG (so UI thumbnails render
without deserializing anything). When a usable interactive source (Plotly
JSON) exists, it is *also* stored — as a separate artifact — and referenced
from the PNG artifact's metadata via ``source_hash`` + ``source_format``.

The SDK ``Run.track`` path is responsible for uploading the source artifact
when metadata contains ``_source_blob``; we return it as part of metadata
rather than storing a second blob inline.
"""

from __future__ import annotations

import io
import logging
from typing import Any

from ..wrappers import _TypeWrapper
from ._optional import try_import

log = logging.getLogger(__name__)


class FigureHandler:
    object_type = "figure"
    mime_type = "image/png"

    def can_handle(self, obj: Any) -> bool:
        if isinstance(obj, _TypeWrapper):
            return False
        mpl = try_import("matplotlib")
        if mpl is not None:
            try:
                from matplotlib.figure import Figure as MplFigure

                if isinstance(obj, MplFigure):
                    return True
            except Exception:  # noqa: BLE001
                pass
        plotly = try_import("plotly")
        if plotly is not None:
            try:
                import plotly.graph_objects as go

                if isinstance(obj, go.Figure):
                    return True
            except Exception:  # noqa: BLE001
                pass
        return False

    @staticmethod
    def _rasterize_matplotlib(fig: Any) -> bytes:
        buf = io.BytesIO()
        fig.savefig(buf, format="png", bbox_inches="tight")
        return buf.getvalue()

    def serialize(self, obj: Any, **kwargs: Any) -> tuple[bytes, dict[str, Any]]:
        meta: dict[str, Any] = {"has_source": False, "source_format": None}

        plotly = try_import("plotly")
        if plotly is not None:
            try:
                import plotly.graph_objects as go

                if isinstance(obj, go.Figure):
                    # Native Plotly: rasterize via kaleido if present, else a
                    # tiny fallback PNG.
                    try:
                        png = obj.to_image(format="png")
                    except Exception:  # noqa: BLE001
                        # kaleido not installed; emit a minimal PNG so the
                        # artifact table always has primary bytes.
                        png = _blank_png()
                    source_json = obj.to_json().encode("utf-8")
                    meta["has_source"] = True
                    meta["source_format"] = "plotly_json"
                    meta["_source_blob"] = source_json
                    meta["_source_mime"] = "application/json"
                    return png, meta
            except Exception:  # noqa: BLE001
                pass

        mpl = try_import("matplotlib")
        if mpl is None:
            raise ImportError("figure handler requires matplotlib (cairn-track[media])")
        png = self._rasterize_matplotlib(obj)
        # Attempt mpl → plotly conversion for an interactive source.
        if plotly is not None:
            try:
                from plotly.tools import mpl_to_plotly

                plotly_fig = mpl_to_plotly(obj)
                source_json = plotly_fig.to_json().encode("utf-8")
                meta["has_source"] = True
                meta["source_format"] = "plotly_json"
                meta["_source_blob"] = source_json
                meta["_source_mime"] = "application/json"
            except Exception as exc:  # noqa: BLE001
                log.warning("mpl_to_plotly conversion failed: %s", exc)
        return png, meta


def _blank_png() -> bytes:
    """1x1 transparent PNG — placeholder when no rasterizer is available."""
    import base64

    return base64.b64decode(
        b"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
    )
