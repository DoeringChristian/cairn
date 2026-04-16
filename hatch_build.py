"""Hatch build hook: run `npm run build` so the wheel includes the UI bundle.

If Node/npm isn't available (or ui-src/ is missing), print a warning and
skip — the wheel will ship without the UI, which is fine for API-only
deployments or for developers building from an editable checkout.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class CairnUIBuildHook(BuildHookInterface):
    PLUGIN_NAME = "cairn-ui"

    def initialize(self, version: str, build_data: dict) -> None:
        root = Path(self.root)
        ui_src = root / "ui-src"
        ui_dist = root / "cairn" / "ui" / "dist"

        if os.environ.get("CAIRN_SKIP_UI_BUILD"):
            self.app.display_info("CAIRN_SKIP_UI_BUILD set — skipping UI build")
            return

        if not ui_src.exists():
            self.app.display_warning(
                "ui-src/ not present; skipping UI build (wheel will have no UI bundle)"
            )
            return

        npm = shutil.which("npm")
        if npm is None:
            self.app.display_warning(
                "npm not found on PATH; skipping UI build. Install Node.js to "
                "produce a wheel that includes the viewer."
            )
            return

        # Only run `npm ci` if node_modules is missing (avoid reinstalling
        # on every incremental build).
        if not (ui_src / "node_modules").exists():
            self.app.display_info("Running `npm ci` in ui-src/…")
            subprocess.check_call([npm, "ci"], cwd=str(ui_src))

        self.app.display_info("Running `npm run build` in ui-src/…")
        subprocess.check_call([npm, "run", "build"], cwd=str(ui_src))

        if not (ui_dist / "index.html").exists():
            self.app.display_warning(
                "UI build completed but no index.html was produced — check vite.config.ts"
            )
