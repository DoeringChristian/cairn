"""The default viewer of each kind of data, per project.

Every kind of data a card shows has exactly one default viewer:

* a **built-in type** (``volume``, ``image``, ``mesh``, ...) shows in its
  built-in renderer until the project names a custom viewer for it;
* **custom data** (``custom:<kind>``) shows in the viewer the project names
  for it. A viewer becomes the default of a custom kind when it is published
  declaring it (``default_for``), and the first viewer ever published that
  accepts a custom kind nobody is the default of becomes its default. Built-in
  types never change implicitly: only ``default_for`` or an explicit edit (the
  Defaults page, ``PUT /api/projects/{p}/viewer-defaults``) does that.

Rows of ``viewer_defaults`` map a key to a viewer name. A key is a built-in
type or ``custom:<kind glob>`` (the viewer's ``accepts`` pattern it was
declared for); the default of a series is the row whose key matches it most
specifically (an exact key over a glob; among globs, more literal characters).
No row for a built-in type means its built-in renderer.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Iterable

from .storage.db import Database
from .viewer_manifest import accepts_matches


def resolve(project: dict[str, str], builtin: dict[str, str], subject: str) -> str | None:
    """The default viewer of a series: the project's, else a built-in viewer's,
    else None (a built-in type's renderer)."""
    return default_for_subject(project, subject) or default_for_subject(builtin, subject)

#: The built-in types a custom viewer may be the default of (every logged
#: kind with a built-in card except scalars).
BUILTIN_TYPES = (
    "image", "figure", "audio", "video", "histogram", "tensor", "text", "table", "html",
    "markdown", "pointcloud", "mesh", "boxes3d", "volume", "preset", "artifact",
)

_CUSTOM_GLOB = re.compile(r"[a-z0-9_.\-/*?]+")


def normalize_kind(kind: str) -> str:
    """``"volume"`` -> ``"volume"``; ``"guiding/vmf"`` or ``"custom:guiding/vmf"``
    -> ``"custom:guiding/vmf"``. A bare name that is not a built-in type is
    custom data. ``ValueError`` when it is neither."""
    if not isinstance(kind, str) or not kind.strip():
        raise ValueError("a default_for kind must be a non-empty string")
    k = kind.strip()
    if k in BUILTIN_TYPES:
        return k
    glob = k[len("custom:"):] if k.startswith("custom:") else k
    if not _CUSTOM_GLOB.fullmatch(glob):
        raise ValueError(
            f"{kind!r} is neither a built-in type ({', '.join(BUILTIN_TYPES)}) "
            "nor a custom kind (custom:<kind> of [a-z0-9_.-/*?])"
        )
    return "custom:" + glob


def viewer_accepts(accepts: Iterable[Any], key: str) -> bool:
    """Whether a viewer with these ``accepts`` patterns can be the default of ``key``."""
    return any(isinstance(p, str) and accepts_matches(p, key) for p in accepts)


def normalize_default_for(default_for: Iterable[str] | None, accepts: Iterable[Any], name: str) -> list[str]:
    """The keys of a ``default_for`` list, each one the viewer accepts."""
    out: list[str] = []
    accepts = list(accepts or [])
    for kind in default_for or []:
        key = normalize_kind(kind)
        if not viewer_accepts(accepts, key):
            raise ValueError(
                f"viewer {name!r} cannot be the default for {key!r}: its accepts "
                f"({', '.join(map(str, accepts))}) do not match it"
            )
        if key not in out:
            out.append(key)
    return out


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def list_defaults(db: Database, project_id: str) -> dict[str, str]:
    """``{key: viewer}`` of the project."""
    rows = db.read_columns(
        "SELECT kind, viewer FROM viewer_defaults WHERE project_id = ? ORDER BY kind", [project_id],
    )
    return {r["kind"]: r["viewer"] for r in rows}


def set_default(con: Any, project_id: str, key: str, viewer: str | None) -> None:
    """Set (``viewer``) or clear (``None``: a built-in type's renderer) one
    default, on an open connection/transaction."""
    if viewer is None:
        con.execute("DELETE FROM viewer_defaults WHERE project_id = ? AND kind = ?", [project_id, key])
        return
    con.execute(
        """INSERT INTO viewer_defaults (project_id, kind, viewer, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (project_id, kind) DO UPDATE SET viewer = EXCLUDED.viewer,
                                                        updated_at = EXCLUDED.updated_at""",
        [project_id, key, viewer, _now()],
    )


def apply_publish(con: Any, project_id: str, name: str, manifest: dict[str, Any], default_for: Any) -> None:
    """A viewer version was published: it becomes the default of each kind it
    declares (``default_for``), and of each custom ``accepts`` pattern that
    no default covers yet. Runs inside ``create_version``'s transaction."""
    accepts = [p for p in (manifest.get("accepts") or []) if isinstance(p, str)]
    declared = normalize_default_for(default_for if isinstance(default_for, list) else [], accepts, name)
    for key in declared:
        set_default(con, project_id, key, name)
    from .custom_viewers import builtin_defaults

    rows = con.execute(
        "SELECT kind FROM viewer_defaults WHERE project_id = ?", [project_id],
    ).fetchall()
    # The built-in viewers' defaults count: a project's viewer never takes them over implicitly.
    keys = [r[0] for r in rows] + list(builtin_defaults())
    for pattern in accepts:
        if not pattern.startswith("custom:") or pattern in declared:
            continue
        # A kind someone already is the default of (this key, or one the
        # pattern falls under) keeps its viewer.
        if any(k == pattern or accepts_matches(k, pattern) for k in keys):
            continue
        set_default(con, project_id, pattern, name)
        keys.append(pattern)


def _specificity(key: str) -> float:
    literal = len(key.replace("*", "").replace("?", ""))
    return literal / 1000 if ("*" in key or "?" in key) else 1 + literal / 1000


def default_for_subject(defaults: dict[str, str], subject: str) -> str | None:
    """The viewer ``defaults`` (``{key: viewer}``) name for a series
    (``volume``, ``custom:guiding/vmf``), or None."""
    best: tuple[float, str] | None = None
    for key, viewer in defaults.items():
        if accepts_matches(key, subject):
            score = _specificity(key)
            if best is None or score > best[0]:
                best = (score, viewer)
    return best[1] if best else None
