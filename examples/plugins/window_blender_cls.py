"""ServerPlugin: Render a Blender scene and stream it to the browser.

Uses Blender's Python API in headless mode to render frames.
Mouse drag rotates the camera. No Xvfb or VirtualGL needed —
Blender renders directly with its own GPU/CPU engine.

Requirements:
    - blender (apt install blender, or snap install blender)
    - Pillow
"""

import math
import shutil
import subprocess
import tempfile
from cairn import ServerPlugin


class BlenderViewer(ServerPlugin):
    """Render a Blender scene headlessly and stream frames."""

    name = "blender"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.angle_x = 0.3
        self.angle_y = 0.5
        self._dragging = False
        self._last_mouse = (0, 0)

    def render(self, data, metadata, step):
        import io
        from PIL import Image

        width, height = 640, 480
        blend_file = metadata.get("blend_file", "")

        # Build a Blender Python script that renders the scene.
        cam_x = 5 * math.cos(self.angle_y) * math.cos(self.angle_x)
        cam_y = 5 * math.sin(self.angle_y) * math.cos(self.angle_x)
        cam_z = 5 * math.sin(self.angle_x)

        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            out_path = f.name

        script = f"""
import bpy, mathutils
bpy.context.scene.render.resolution_x = {width}
bpy.context.scene.render.resolution_y = {height}
bpy.context.scene.render.resolution_percentage = 100
bpy.context.scene.render.image_settings.file_format = 'PNG'
bpy.context.scene.render.filepath = '{out_path}'

# Set camera position
cam = bpy.context.scene.camera
if cam:
    cam.location = ({cam_x}, {cam_y}, {cam_z})
    direction = mathutils.Vector((0, 0, 0)) - cam.location
    rot = direction.to_track_quat('-Z', 'Y')
    cam.rotation_euler = rot.to_euler()

# If no objects exist, create a default cube
if len(bpy.data.objects) <= 2:  # camera + light only
    bpy.ops.mesh.primitive_monkey_add(size=1.5)

bpy.ops.render.render(write_still=True)
"""

        with tempfile.NamedTemporaryFile(suffix=".py", mode="w", delete=False) as sf:
            sf.write(script)
            script_path = sf.name

        try:
            cmd = ["blender"]
            if blend_file:
                cmd.append(blend_file)
            else:
                cmd.append("--factory-startup")
            cmd.extend(["--background", "--python", script_path, "--", out_path])

            subprocess.run(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=30,
            )

            img = Image.open(out_path).convert("RGB")
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            return buf.getvalue()
        except Exception as e:
            # Return error frame.
            img = Image.new("RGB", (width, height), (13, 17, 23))
            from PIL import ImageDraw
            draw = ImageDraw.Draw(img)
            draw.text((10, 10), f"Blender render failed: {e}", fill=(255, 80, 80))
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            return buf.getvalue()
        finally:
            import os
            for p in (out_path, script_path):
                try:
                    os.unlink(p)
                except OSError:
                    pass

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
