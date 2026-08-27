"""Server-agnosticism lint — the one structural rule kept from the refactor.

The server (``cairn/server/``) is TYPE-AGNOSTIC: it stores rows +
content-addressed blobs + an opaque ``object_type`` and never imports the
SDK's handlers, wrappers, or card specs. The query grammar lives server-side
(``cairn/server/query_grammar.py`` + ``_operators.py``); the reader keeps a
MARKED MIRROR pinned by ``schema/query-vectors.json``.

The reverse direction (sdk → server) is legal in the monolith — local-mode
runs use the storage layer directly.
"""
from __future__ import annotations

import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SERVER = REPO / "cairn" / "server"


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
