"""WindowPlugin: Stream Blender's viewport to the browser.

Launches Blender in a virtual display and streams the window.
Mouse and keyboard events are forwarded for interactive 3D navigation.

NOTE: Snap-installed Blender ignores env vars due to sandboxing.
This plugin uses `snap run --env=DISPLAY=...` for snap installs,
or passes env directly for system/manual installs.

Requirements:
    - blender (apt install blender, or snap install blender)
    - xvfb (apt install xvfb)
    - Optional: virtualgl for GPU-accelerated rendering
"""

import os
import shutil
import subprocess
from cairn import WindowPlugin


def _is_snap(binary: str) -> bool:
    """Check if a binary is a snap package."""
    resolved = shutil.which(binary)
    return resolved is not None and "/snap/" in resolved


class BlenderViewer(WindowPlugin):
    """Stream Blender's 3D viewport to the browser."""

    name = "blender"
    width = 1280
    height = 720
    fps = 30
    gpu = True

    def launch(self, data, metadata, step):
        env = self._cairn_env
        display = env.get("DISPLAY", ":0")

        blend_file = metadata.get("blend_file")

        if _is_snap("blender"):
            # Snap sandboxing ignores env= in Popen.
            # Use `snap run --env=DISPLAY=:X blender` instead.
            cmd = ["snap", "run", f"--env=DISPLAY={display}"]
            if env.get("GDK_BACKEND"):
                cmd.append(f"--env=GDK_BACKEND={env['GDK_BACKEND']}")
            cmd.append("blender")
            if blend_file:
                cmd.append(blend_file)
            # Wrap with vglrun if available.
            if shutil.which("vglrun") and self.gpu:
                cmd = ["vglrun"] + cmd
            return subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        else:
            # System install — env= works normally.
            cmd = ["blender"]
            if blend_file:
                cmd.append(blend_file)
            if shutil.which("vglrun") and self.gpu:
                cmd = ["vglrun"] + cmd
            return subprocess.Popen(
                cmd,
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
