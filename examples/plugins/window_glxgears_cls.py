"""WindowPlugin example: stream glxgears (OpenGL demo) to the browser.

Uses VirtualGL (vglrun) for GPU-accelerated rendering when available.
Without VirtualGL, glxgears falls back to software rendering (CPU-heavy).

Requirements (server-side):
    apt install xvfb mesa-utils
    # Optional for GPU acceleration:
    apt install virtualgl
"""

import shutil
import subprocess
from cairn import WindowPlugin


class GlxgearsViewer(WindowPlugin):
    """Stream glxgears with GPU acceleration via VirtualGL."""

    name = "glxgears"
    width = 640
    height = 480
    fps = 30
    gpu = True  # Use VirtualGL for GPU-accelerated OpenGL

    def launch(self, data, metadata, step):
        # If VirtualGL is available and gpu=True, wrap with vglrun.
        # The framework sets VGL_DISPLAY=:0 when gpu=True.
        cmd = ["glxgears", "-geometry", f"{self.width}x{self.height}"]
        if shutil.which("vglrun"):
            cmd = ["vglrun"] + cmd
        return subprocess.Popen(
            cmd,
            env=self._cairn_env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
