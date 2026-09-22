"""Server-agnosticism lint — the one structural rule kept from the refactor.

The server (``cairn/server/``) is TYPE-AGNOSTIC: it stores rows +
content-addressed blobs + an opaque ``object_type`` and never imports the
SDK's handlers, wrappers, or card specs. The query grammar lives server-side
(``cairn/server/query_grammar.py`` + ``_operators.py``); the reader keeps a
MARKED MIRROR pinned by ``schema/query-vectors.json``. (An earlier version of
this docstring also claimed a TypeScript mirror pinned by the same file from the
UI's test suite. There is none — the UI filters runs client-side through its own
run-selector. Do not assert a guarantee nothing enforces.)

The reverse direction (sdk → server) is legal in the monolith — local-mode
runs use the storage layer directly.

The second rule is the packaging one: ``cairn-track`` ships no UI. ``cairn/`` is
the wheel payload, so it must hold Python and nothing else, and exactly one
module may know where the viewer bundle lives.
"""
from __future__ import annotations

import json
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
      | \bcairn_ui\b(?!\.cards)   # the bundle-locating package, not the card surface
      | ["'](?:index|embed|plot)\.html["']
      | ["']assets["']
      | ["']_dist["']
      | ["']vendor/cairn-ui""",
    re.X,
)


def test_only_cairn_viewer_knows_where_the_ui_bundle_lives() -> None:
    """One module owns where the bundle's FILES are; everyone else asks it.

    If a second module learns the bundle's path, the next person to touch it
    re-couples the wheel to the viewer without noticing. Binding to
    ``cairn_ui.cards`` — the viewer's own Python surface — is a different thing
    and stays allowed: that is a package import, not filesystem knowledge.
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
        "vendor/cairn-ui/:\n" + "\n".join(strays)
    )


def _load_toml(path):
    try:
        import tomllib
    except ModuleNotFoundError:  # py3.10
        import tomli as tomllib  # type: ignore[no-redef]
    return tomllib.loads(path.read_text())


def _submodule_head(name: str) -> str:
    """The commit vendor/<name> is actually checked out at.

    Deliberately the working-tree HEAD rather than the pointer recorded in the
    parent commit: the suite runs against the checked-out submodule, so that is
    the code under test, and a pin naming anything else means what was tested is
    not what an install would fetch.
    """
    return subprocess.run(
        ["git", "-C", str(REPO / "vendor" / name), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()


def _pin_sha(requirements: list[str], dist: str) -> str:
    """The commit a `dist @ git+...@<sha>` requirement names."""
    for req in requirements:
        m = re.match(rf"^{re.escape(dist)}\s*@\s*git\+\S+@([0-9a-f]{{40}})$", req)
        if m:
            return m.group(1)
    raise AssertionError(
        f"no 40-char git pin for {dist!r} in {requirements!r}. Neither cairn-plot "
        f"nor cairn-ui is on an index, so a bare version specifier cannot "
        f"resolve — pip answers 404 and the extra is uninstallable."
    )


def test_cairn_ui_is_pinned_in_lock_step_with_cairn_track() -> None:
    """Bundle and /api/* contract ship together; a version window would lie."""
    ui_pyproject = REPO / "vendor" / "cairn-ui" / "pyproject.toml"
    if not ui_pyproject.is_file():
        pytest.skip("vendor/cairn-ui absent (installed or sdist checkout)")

    root = _load_toml(REPO / "pyproject.toml")
    ui = _load_toml(ui_pyproject)
    assert ui["project"]["version"] == root["project"]["version"]


def test_the_optional_extras_name_commits_that_exist_here() -> None:
    """A git pin that drifts from the submodule ships untested code.

    The extras must install exactly the cairn-plot and cairn-ui the suite just
    exercised. This is the check that catches a bumped submodule with a stale
    pin, which resolves fine and is silently the wrong build.
    """
    if not (REPO / "vendor" / "cairn-ui" / ".git").exists():
        pytest.skip("submodules absent (installed or sdist checkout)")

    extras = _load_toml(REPO / "pyproject.toml")["project"]["optional-dependencies"]
    assert _pin_sha(extras["plot"], "cairn-plot") == _submodule_head("cairn-plot")
    assert _pin_sha(extras["ui"], "cairn-ui") == _submodule_head("cairn-ui")


def test_only_this_repo_names_the_cairn_plot_commit() -> None:
    """Exactly one voice may pin cairn-plot, and it is `cairn-track[ui]`.

    cairn-ui needs cairn-plot too, but if it names a URL as well, uv refuses the
    pair the moment a dev checkout redirects cairn-plot to a local path —
    "conflicting URLs for package cairn-plot". A range there is satisfied by
    whatever this pin provides, so the range is the correct thing for it to
    declare and this test stops the URL growing back.
    """
    ui_pyproject = REPO / "vendor" / "cairn-ui" / "pyproject.toml"
    if not ui_pyproject.is_file():
        pytest.skip("vendor/cairn-ui absent (installed or sdist checkout)")

    theirs = _load_toml(ui_pyproject)["project"]["dependencies"]
    urls = [r for r in theirs if "@" in r and "git+" in r]
    assert not urls, (
        "vendor/cairn-ui must declare version ranges, not URLs — cairn-track[ui] "
        "is the single place that names a commit:\n" + "\n".join(urls)
    )


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


#: Modules that drive the browser viewer from Python. They are reachable only
#: with the `ui` extra, so nothing on the tracking or serving path may import
#: them — that is what keeps `pip install cairn-track` free of a renderer.
_VIEWER_MODULES = re.compile(
    r"^\s*(?:from|import)\s+"
    r"(?:cairn\.)?(?:\.*)"
    r"(?:plot|sdk\.plot|sdk\.elements|sdk\.report|sdk\.card_spec)"
    r"(?:\.|\s|$)",
    re.M,
)

#: The tracking path proper, plus the server. Everything here must work from a
#: base install.
_TRACKING_ROOTS = (
    REPO / "cairn" / "sdk" / "run.py",
    REPO / "cairn" / "sdk" / "reader.py",
    REPO / "cairn" / "sdk" / "transport.py",
    REPO / "cairn" / "sdk" / "wal.py",
    REPO / "cairn" / "sdk" / "handlers",
    REPO / "cairn" / "server",
)


def test_the_tracking_path_never_imports_the_viewer_surface() -> None:
    """cairn-track is the tracker and the server; the viewer is an extra."""
    offenders: list[str] = []
    for root in _TRACKING_ROOTS:
        files = _py_files(root) if root.is_dir() else [root]
        for p in files:
            for m in _VIEWER_MODULES.finditer(p.read_text()):
                offenders.append(f"{p.relative_to(REPO)}: {m.group(0).strip()}")
    assert not offenders, (
        "the tracking path must work without `cairn-track[ui]`; these reach "
        "the viewer surface:\n" + "\n".join(offenders)
    )


def test_logging_a_run_never_imports_the_renderer() -> None:
    """A training job pulls no renderer — proven, not assumed.

    Fresh subprocess: sys.modules pollution from another test would make an
    in-process check vacuous.
    """
    code = (
        "import sys, cairn;"
        "cairn.Run;"
        "import cairn.sdk.run;"
        "sys.exit(1 if 'cairn_plot' in sys.modules else 0)"
    )
    env = {**os.environ, "PYTHONPATH": str(REPO)}
    result = subprocess.run([sys.executable, "-c", code], env=env, cwd=REPO)
    assert result.returncode == 0, "the tracking path imported cairn_plot"


def test_standalone_cairn_plot_imports_no_cairn_modules() -> None:
    """``import cairn_plot`` must pull in ZERO ``cairn.*`` modules.

    The renderer is a separate distribution, installable and usable with no
    cairn-track present; if it reached back into cairn the two would be a cycle.
    Inherited from the import-purity gate that policed the original extraction.
    """
    probe = (
        "import json, sys, cairn_plot;"
        "print(json.dumps(sorted("
        "m for m in sys.modules if m == 'cairn' or m.startswith('cairn.'))))"
    )
    env = {**os.environ, "PYTHONPATH": str(REPO)}
    proc = subprocess.run(
        [sys.executable, "-c", probe], capture_output=True, text=True, env=env, cwd=REPO
    )
    if proc.returncode != 0:
        pytest.skip("cairn_plot not installed (base install, no `ui` extra)")
    leaked = json.loads(proc.stdout.strip().splitlines()[-1])
    assert not leaked, f"importing cairn_plot pulled in cairn modules: {leaked}"
