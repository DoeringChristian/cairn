"""Import-lint gate for the cairn-plot packaging split (P2-M1).

The pure plot modules — ``cairn.sdk.plot_components`` / ``plot_elements`` /
``plot_spec`` / ``plot_report`` / ``_plot_bundle`` — must be importable with
ZERO app/server coupling, so they move cleanly into the standalone
``cairn-plot`` distribution at M2. This test imports them in a FRESH
subprocess (so nothing another test already imported pollutes ``sys.modules``)
and asserts none of the cairn app/server/run modules got pulled in.

``cairn/plot.py`` itself is still allowed to be cairn-coupled at M1 (it
registers the ``DataRef`` adapter and reuses the reader) — this test only
guards the PURE modules' own import closure.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

# Repo root (…/cairn), so the subprocess resolves ``import cairn`` regardless of
# the pytest invocation cwd.
_REPO_ROOT = Path(__file__).resolve().parents[2]

# The pure modules under test (the ones that move to `cairn-plot` at M2).
_PURE_MODULES = [
    "cairn.sdk.plot_components",
    "cairn.sdk.plot_elements",
    "cairn.sdk.plot_spec",
    "cairn.sdk.plot_report",
    "cairn.sdk._plot_bundle",
]

# App/server/run-coupled modules that importing the pure set must NOT pull in.
# `*`-suffixed entries match a whole subtree (prefix match).
_FORBIDDEN = [
    "cairn.server*",
    "cairn.sdk.transport",
    "cairn.sdk.run",
    "cairn.sdk.wal",
    "cairn.sdk.local",
    "cairn.sdk.discovery",
    "cairn.sdk.buffer",
    "cairn.sdk.handlers*",
    "cairn.cli",
    "cairn.server.app",
    # The reader (DataRef/ArtifactInfo run-reading) pulls run/wal/local/server;
    # the pure modules recognize a run[tag] handle via the registered-type seam
    # instead, so the reader must be absent from THEIR closure. (cairn/plot.py
    # itself may still pull it — that is not imported here.)
    "cairn.sdk.reader",
]

# The pure modules must also not import each other's APP-side siblings — the
# split would be meaningless if e.g. plot_report reached back into report.py.
_APP_SIBLINGS = [
    "cairn.sdk.elements",
    "cairn.sdk.card_spec",
    "cairn.sdk.report",
]

_SUBPROCESS = r"""
import json, sys
import cairn.sdk.plot_components
import cairn.sdk.plot_elements
import cairn.sdk.plot_spec
import cairn.sdk.plot_report
import cairn.sdk._plot_bundle
print(json.dumps(sorted(sys.modules)))
"""

# The standalone package (`import cairn_plot`) must load NO ``cairn.*`` modules
# at all — it is the wheel a bare ``pip install cairn-plot`` ships, with no
# cairn-track in the environment (packaging spec §M2 gate).
_SUBPROCESS_STANDALONE = r"""
import json, sys
import cairn_plot
print(json.dumps(sorted(m for m in sys.modules if m == "cairn" or m.startswith("cairn."))))
"""


def _loaded_modules() -> list[str]:
    """Import the pure modules in a fresh interpreter and return its
    ``sys.modules`` keys."""
    env = dict(os.environ)
    env["PYTHONPATH"] = os.pathsep.join(
        [str(_REPO_ROOT), env.get("PYTHONPATH", "")]
    ).rstrip(os.pathsep)
    proc = subprocess.run(
        [sys.executable, "-c", _SUBPROCESS],
        capture_output=True,
        text=True,
        env=env,
    )
    assert proc.returncode == 0, (
        f"importing the pure plot modules failed:\n{proc.stderr}"
    )
    return json.loads(proc.stdout.strip().splitlines()[-1])


def _matches(module: str, pattern: str) -> bool:
    if pattern.endswith("*"):
        return module.startswith(pattern[:-1])
    return module == pattern


def test_pure_plot_modules_have_no_app_coupling() -> None:
    loaded = _loaded_modules()
    offenders = {
        pattern: [m for m in loaded if _matches(m, pattern)]
        for pattern in _FORBIDDEN
    }
    offenders = {k: v for k, v in offenders.items() if v}
    assert not offenders, (
        "importing the pure cairn-plot modules pulled in app/server-coupled "
        f"modules: {offenders}"
    )


def test_pure_plot_modules_do_not_import_app_siblings() -> None:
    loaded = set(_loaded_modules())
    reached = [m for m in _APP_SIBLINGS if m in loaded]
    assert not reached, (
        "the pure cairn-plot modules imported their app-side siblings "
        f"(the split leaked): {reached}"
    )


def test_pure_modules_all_present() -> None:
    """Sanity: the subprocess really did import every pure module (guards
    against a silent import failure masking the purity assertions)."""
    loaded = set(_loaded_modules())
    missing = [m for m in _PURE_MODULES if m not in loaded]
    assert not missing, f"pure modules failed to load in the subprocess: {missing}"


def test_standalone_cairn_plot_imports_no_cairn_modules() -> None:
    """``import cairn_plot`` (the standalone wheel) must pull in ZERO ``cairn.*``
    modules — it is installable and usable with no cairn-track present."""
    env = dict(os.environ)
    env["PYTHONPATH"] = os.pathsep.join(
        [str(_REPO_ROOT), env.get("PYTHONPATH", "")]
    ).rstrip(os.pathsep)
    proc = subprocess.run(
        [sys.executable, "-c", _SUBPROCESS_STANDALONE],
        capture_output=True,
        text=True,
        env=env,
    )
    assert proc.returncode == 0, f"importing cairn_plot failed:\n{proc.stderr}"
    cairn_modules = json.loads(proc.stdout.strip().splitlines()[-1])
    assert not cairn_modules, (
        "importing the standalone cairn_plot package pulled in cairn.* modules "
        f"(the split leaked): {cairn_modules}"
    )
