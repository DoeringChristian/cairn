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
                    source_json = obj.to_json().encode("utf-8")
                    # Native Plotly: rasterize via kaleido if present, else a
                    # tiny fallback PNG.
                    try:
                        png = obj.to_image(format="png")
                    except Exception:  # noqa: BLE001
                        # kaleido not installed; emit a minimal PNG so the
                        # artifact table always has primary bytes. Content-
                        # address it against this figure's source JSON
                        # (rather than a fixed constant) so distinct figures
                        # don't rasterize to byte-identical placeholders —
                        # the artifacts table dedups by content hash with
                        # ON CONFLICT (hash) DO UPDATE that keeps only the
                        # first row's metadata, so a shared placeholder hash
                        # would silently clobber every subsequent figure's
                        # source_hash onto the first figure's.
                        png = _blank_png(source_json)
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

    def deserialize(self, data: bytes, metadata: dict[str, Any] | None = None) -> Any:
        """Decode the rasterized PNG back into a PIL Image.

        The original interactive Plotly source isn't returned here — it lives
        in a separate blob referenced by ``metadata['source_hash']``. Use
        ``run.artifact_bytes()`` with that hash if you need the source JSON.
        """
        import io as _io
        try:
            from PIL import Image as PILImage
        except ImportError as e:
            raise ImportError("Reading figure artifacts requires Pillow") from e
        return PILImage.open(_io.BytesIO(data))


def _png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    import struct
    import zlib

    return (
        struct.pack(">I", len(data))
        + chunk_type
        + data
        + struct.pack(">I", zlib.crc32(chunk_type + data) & 0xFFFFFFFF)
    )


def _blank_png(unique_seed: bytes | None = None) -> bytes:
    """1x1 transparent PNG — placeholder when no rasterizer is available.

    When ``unique_seed`` is given (e.g. a figure's source JSON bytes), a
    small ancillary ``tEXt`` chunk derived from it is embedded before
    ``IEND`` so distinct figures don't collapse onto the same content
    hash — decoders ignore unrecognized text chunks, so the image still
    renders identically as a blank placeholder.
    """
    import base64
    import hashlib

    base = base64.b64decode(
        b"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
    )
    if not unique_seed:
        return base
    digest = hashlib.sha256(unique_seed).hexdigest().encode("ascii")
    text_chunk = _png_chunk(b"tEXt", b"cairn:src\x00" + digest)
    # IEND is the trailing 12-byte chunk (4 length + 4 type + 0 data + 4 CRC).
    return base[:-12] + text_chunk + base[-12:]
