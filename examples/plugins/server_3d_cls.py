"""Interactive server-side 3D renderer.

Renders a rotating 3D wireframe cube using PIL. Mouse drag rotates the
camera. Each mouse-drag event triggers a re-render on the server and
streams the updated frame to the client.

This demonstrates the server plugin pattern for GPU-heavy rendering
(e.g. Mitsuba, Polyscope, PyTorch3D) where the server has the compute
and the browser just displays frames.
"""

from cairn import ServerPlugin
import math


class Server3DScene(ServerPlugin):
    """Interactive 3D wireframe cube, rendered server-side with PIL."""

    name = "server_3d"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.angle_x = 0.3
        self.angle_y = 0.5
        self._dragging = False
        self._last_mouse = (0, 0)

    def render(self, data, metadata, step):
        import io
        import struct

        from PIL import Image, ImageDraw

        w, h = 512, 512
        img = Image.new("RGB", (w, h), "#0d1117")
        draw = ImageDraw.Draw(img)

        # Cube vertices.
        verts = [
            (-1, -1, -1), ( 1, -1, -1), ( 1,  1, -1), (-1,  1, -1),
            (-1, -1,  1), ( 1, -1,  1), ( 1,  1,  1), (-1,  1,  1),
        ]
        edges = [
            (0,1),(1,2),(2,3),(3,0),  # back
            (4,5),(5,6),(6,7),(7,4),  # front
            (0,4),(1,5),(2,6),(3,7),  # sides
        ]

        # Animate based on step + interactive rotation.
        ax = self.angle_x + step * 0.05
        ay = self.angle_y + step * 0.07

        def project(x, y, z):
            # Rotate around Y then X.
            cy, sy = math.cos(ay), math.sin(ay)
            x2, z2 = x * cy - z * sy, x * sy + z * cy
            cx, sx = math.cos(ax), math.sin(ax)
            y2, z3 = y * cx - z2 * sx, y * sx + z2 * cx
            # Perspective.
            scale = 150 / (z3 + 4)
            return int(w/2 + x2 * scale), int(h/2 - y2 * scale)

        projected = [project(*v) for v in verts]

        # Draw edges with depth-based color.
        for i, j in edges:
            z_avg = (verts[i][2] + verts[j][2]) / 2
            brightness = int(100 + 80 * (z_avg + 1) / 2)
            color = (brightness // 3, brightness, brightness)
            draw.line([projected[i], projected[j]], fill=color, width=2)

        # Draw vertices.
        for px, py in projected:
            draw.ellipse([px-3, py-3, px+3, py+3], fill="#0969da")

        # HUD.
        draw.text((10, 10), f"step {step}  angle=({self.angle_x:.1f}, {self.angle_y:.1f})", fill="#8b949e")
        draw.text((10, h - 20), "drag to rotate", fill="#484f58")

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()

    def on_mouse(self, event):
        action = event.get("action")
        x, y = event.get("x", 0), event.get("y", 0)

        if action == "down":
            self._dragging = True
            self._last_mouse = (x, y)
        elif action == "up":
            self._dragging = False
        elif action == "move" and self._dragging:
            dx = x - self._last_mouse[0]
            dy = y - self._last_mouse[1]
            self.angle_y += dx * 0.01
            self.angle_x += dy * 0.01
            self._last_mouse = (x, y)
            self.request_rerender()
