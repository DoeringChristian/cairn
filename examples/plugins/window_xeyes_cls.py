"""WindowPlugin example: stream xeyes to the browser.

xeyes follows the mouse cursor — a simple test that mouse events
are being forwarded from the browser to the virtual display.

Requirements (server-side):
    apt install xvfb xdotool x11-apps imagemagick
"""

import subprocess
from cairn import WindowPlugin


class XEyesViewer(WindowPlugin):
    """Stream xeyes — eyes follow the mouse cursor."""

    name = "xeyes"
    width = 400
    height = 300
    fps = 15

    def launch(self, data, metadata, step):
        return subprocess.Popen(
            ["xeyes", "-geometry", f"{self.width}x{self.height}+0+0"],
            env=self._cairn_env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
