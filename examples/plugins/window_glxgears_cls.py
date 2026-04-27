"""WindowPlugin example: stream glxgears (OpenGL demo) to the browser.

Launches glxgears inside a virtual X display (Xvfb) and streams
the window to the browser. Mouse and keyboard events are forwarded.

This demonstrates the WindowPlugin pattern for running ANY GUI
application (Polyscope, PyVista, Blender, etc.) on the server
and viewing it in the browser.

Requirements (server-side):
    apt install xvfb xdotool x11-utils mesa-utils imagemagick

Usage in demo script:
    run.track(GlxgearsViewer(b""), name="window.glxgears", step=0)
"""

import subprocess
from cairn import WindowPlugin


class GlxgearsViewer(WindowPlugin):
    """Stream glxgears (or any OpenGL app) from the server to the browser."""

    name = "glxgears"
    width = 640
    height = 480
    fps = 10

    def launch(self, data, metadata, step):
        # DISPLAY is already set to the Xvfb virtual display by the framework.
        # Just launch the application normally.
        return subprocess.Popen(
            ["glxgears", "-geometry", f"{self.width}x{self.height}"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
