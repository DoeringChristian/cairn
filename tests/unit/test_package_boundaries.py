"""Server-agnosticism lint — the one structural rule kept from the refactor.

The server (``cairn/server/``) is TYPE-AGNOSTIC: it stores rows +
content-addressed blobs + an opaque ``object_type`` and never imports the
SDK's handlers, wrappers, or card specs. The query grammar lives server-side
(``cairn/server/query_grammar.py`` + ``_operators.py``); the reader keeps a
MARKED MIRROR pinned by ``schema/query-vectors.json``.

The reverse direction (sdk → server) is legal in the monolith — local-mode
runs use the storage layer directly.

The second rule is the packaging one: ``cairn-track`` ships no UI. ``cairn/`` is
the wheel payload, so it must hold Python and nothing else, and exactly one
module may know where the viewer bundle lives.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
SERVER = REPO / "cairn" / "server"
VIEWER = REPO / "cairn" / "viewer.py"


def _py_files(root: Path):
    return [p for p in root.rglob("*.py") if "__pycache__" not in p.parts]


def test_server_never_imports_the_sdk() -> None:
    offenders: list[str] = []
    for p in _py_files(SERVER):
        src = p.read_text()
        for m in re.finditer(
            r"^\s*(?:from|import)\s+(?:cairn\.sdk|\.\.sdk)(?:\.|\s|$)", src, re.M
        ):
            offenders.append(f"{p.relative_to(REPO)}: {m.group(0).strip()}")
    assert not offenders, (
        "cairn/server must stay type-agnostic: no imports of cairn.sdk "
        "(rows + blobs + opaque object_type only):\n" + "\n".join(offenders)
    )


# Tokens that mean "I know where the viewer bundle lives on disk".
_UI_PATH_TOKENS = re.compile(
    r"""CAIRN_UI_DIST
      | \bcairn_ui\b
      | ["'](?:index|embed|plot)\.html["']
      | ["']assets["']
      | ["']_dist["']
      | ["']packages/cairn-ui""",
    re.X,
)


def test_only_cairn_viewer_knows_where_the_ui_bundle_lives() -> None:
    """One module owns the viewer's location; everyone else asks it.

    If a second module learns the bundle's path, the next person to touch it
    re-couples the wheel to the viewer without noticing.
    """
    offenders: list[str] = []
    for p in _py_files(REPO / "cairn"):
        if p == VIEWER:
            continue
        for lineno, line in enumerate(p.read_text().splitlines(), 1):
            if line.lstrip().startswith("#"):
                continue  # prose may name the path
            if _UI_PATH_TOKENS.search(line):
                offenders.append(f"{p.relative_to(REPO)}:{lineno}: {line.strip()}")
    assert not offenders, (
        "only cairn/viewer.py may name the viewer bundle's location — use "
        "viewer.dist_path() / assets_dir() / shell():\n" + "\n".join(offenders)
    )


_UI_SUFFIXES = {".html", ".css", ".ts", ".tsx", ".js", ".mjs", ".map", ".woff2"}


def test_the_cairn_track_wheel_payload_holds_no_ui_bytes() -> None:
    """`packages = ["cairn"]` ships EVERYTHING under cairn/, not just .py.

    The bundle was only half of it: cairn/ui/src/** rode along too — 87 .ts and
    79 .tsx files. The only defence a stray file cannot defeat is "cairn/ holds
    Python and nothing else".
    """
    strays = sorted(
        str(p.relative_to(REPO))
        for p in (REPO / "cairn").rglob("*")
        if p.is_file() and p.suffix in _UI_SUFFIXES and "__pycache__" not in p.parts
    )
    assert not strays, (
        "cairn/ is the cairn-track wheel payload; UI assets belong in "
        "packages/cairn-ui/:\n" + "\n".join(strays)
    )


def test_cairn_ui_is_pinned_in_lock_step_with_cairn_track() -> None:
    """Bundle and /api/* contract ship together; a version window would lie."""
    try:
        import tomllib
    except ModuleNotFoundError:  # py3.10
        import tomli as tomllib  # type: ignore[no-redef]

    ui_pyproject = REPO / "packages" / "cairn-ui" / "pyproject.toml"
    if not ui_pyproject.is_file():
        pytest.skip("packages/cairn-ui absent (installed or sdist checkout)")

    root = tomllib.loads((REPO / "pyproject.toml").read_text())
    ui = tomllib.loads(ui_pyproject.read_text())
    version = root["project"]["version"]
    assert ui["project"]["version"] == version
    assert root["project"]["optional-dependencies"]["ui"] == [f"cairn-ui=={version}"]


def test_default_create_app_never_imports_the_viewer_package() -> None:
    """`pip install cairn-track` pulls no UI: prove the default path agrees.

    A fresh subprocess, because sys.modules pollution from another test would
    make an in-process check vacuous.
    """
    code = (
        "import sys;"
        "from cairn.server.app import create_app;"
        "create_app();"
        "sys.exit(1 if 'cairn_ui' in sys.modules else 0)"
    )
    env = {**os.environ, "PYTHONPATH": str(REPO)}
    env.pop("CAIRN_UI_DIST", None)
    result = subprocess.run([sys.executable, "-c", code], env=env, cwd=REPO)
    assert result.returncode == 0, "a default create_app() imported cairn_ui"
