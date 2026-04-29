"""WindowPlugin: Stream Blender's viewport to the browser.

Launches Blender in a virtual display with GPU acceleration (if available)
and streams the window. Mouse and keyboard events are forwarded, allowing
interactive 3D viewport navigation.

Requirements:
    - blender (apt install blender, or snap install blender)
    - xvfb (apt install xvfb)
    - Optional: virtualgl for GPU-accelerated rendering
"""

import shutil
import subprocess
from cairn import WindowPlugin


class BlenderViewer(WindowPlugin):
    """Stream Blender's 3D viewport to the browser."""

    name = "blender"
    width = 1280
    height = 720
    fps = 30
    gpu = True

    def launch(self, data, metadata, step):
        cmd = ["blender"]

        # If a .blend file path is in metadata, open it.
        blend_file = metadata.get("blend_file")
        if blend_file:
            cmd.append(blend_file)

        # Wrap with vglrun for GPU acceleration if available.
        if shutil.which("vglrun"):
            cmd = ["vglrun"] + cmd

        return subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
