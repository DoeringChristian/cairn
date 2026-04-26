"""Class-based server plugin: heatmap rendered server-side with PIL."""

from cairn import ServerPlugin


class ServerHeatmap(ServerPlugin):
    """Heatmap rendered on the server using PIL. Frames streamed via WebSocket."""

    name = "server_heatmap"

    def render(self, data, metadata, step):
        import io
        import struct

        from PIL import Image, ImageDraw, ImageFont

        rows = metadata.get("rows", 1)
        cols = metadata.get("cols", 1)
        values = struct.unpack(f"<{rows * cols}f", bytes(data))

        vmin = min(values)
        vmax = max(values)
        vrange = vmax - vmin or 1.0

        cell = 50
        pad = 30
        w = cols * cell + pad * 2
        h = rows * cell + pad * 2

        img = Image.new("RGB", (w, h), "#0d1117")
        draw = ImageDraw.Draw(img)

        # Title.
        label = metadata.get("label", "Heatmap")
        draw.text((w // 2, 10), f"{label} — step {step}", fill="#c9d1d9", anchor="mt")

        # Cells.
        for r in range(rows):
            for c in range(cols):
                v = values[r * cols + c]
                t = (v - vmin) / vrange
                red = int(68 + t * 187)
                green = int(1 + t * 215)
                blue = int(84 + (1 - t) * 74 - t * 50)
                x0 = pad + c * cell
                y0 = pad + r * cell
                draw.rectangle([x0, y0, x0 + cell - 1, y0 + cell - 1], fill=(red, green, blue))
                # Value text.
                txt_color = "#000" if t > 0.5 else "#fff"
                draw.text((x0 + cell // 2, y0 + cell // 2), f"{v:.2f}",
                          fill=txt_color, anchor="mm")

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()
