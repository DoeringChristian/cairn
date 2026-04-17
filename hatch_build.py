"""Hatch build hook: run `npm run build` so the wheel includes the UI bundle.

Since cairn/ui/dist/ is committed to git, this hook is only needed when
building from a clean checkout without the pre-built assets. If dist/
already exists and contains index.html, the hook is a no-op.
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
        ui_dir = root / "cairn" / "ui"
        ui_dist = ui_dir / "dist"

        if os.environ.get("CAIRN_SKIP_UI_BUILD"):
            self.app.display_info("CAIRN_SKIP_UI_BUILD set — skipping UI build")
            return

        # If dist/ already has index.html (committed or from a prior build), skip.
        if (ui_dist / "index.html").exists():
            self.app.display_info("cairn/ui/dist/index.html exists — skipping UI build")
            return

        if not (ui_dir / "package.json").exists():
            self.app.display_warning(
                "cairn/ui/package.json not present; skipping UI build"
            )
            return

        npm = shutil.which("npm")
        if npm is None:
            self.app.display_warning(
                "npm not found on PATH; skipping UI build. Install Node.js to "
                "produce a wheel that includes the viewer."
            )
            return

        if not (ui_dir / "node_modules").exists():
            self.app.display_info("Running `npm ci` in cairn/ui/…")
            subprocess.check_call([npm, "ci"], cwd=str(ui_dir))

        self.app.display_info("Running `npm run build` in cairn/ui/…")
        subprocess.check_call([npm, "run", "build"], cwd=str(ui_dir))

        if not (ui_dist / "index.html").exists():
            self.app.display_warning(
                "UI build completed but no index.html was produced — check vite.config.ts"
            )
