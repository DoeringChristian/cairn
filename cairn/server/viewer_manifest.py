"""Custom viewers: the ``cairn-viewer.json`` manifest, data kinds, file rules.

A custom viewer is a folder of browser code with a ``cairn-viewer.json`` at its
root, published as an artifact family of type ``cairn-viewer`` (see
``cairn.sdk.custom_viewers``) or served live by ``cairn viewer dev``. This
module is shared by the SDK (validation at publish) and the server (listing,
dev sources), so it stays stdlib-only. The JSON schema
``docs/schemas/cairn-viewer.schema.json`` describes the same rules; a unit test
holds the two together.
"""

from __future__ import annotations

import hashlib
import json
import mimetypes
import re
from pathlib import Path, PurePosixPath
from typing import Any, Iterable

#: The manifest's file name at a viewer folder's root.
MANIFEST_FILE = "cairn-viewer.json"
#: The artifact family type viewers are published as.
VIEWER_TYPE = "cairn-viewer"
#: Total size cap of a viewer folder (every file it publishes).
MAX_FOLDER_BYTES = 50 * 1024 * 1024

#: A data kind: lowercase segments separated by ``/`` (``"guiding/vmf"``).
KIND_RE = re.compile(r"^[a-z0-9_.-]+(/[a-z0-9_.-]+)*$")
#: A viewer name: the artifact family name and a card's ``viewer`` setting.
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,63}$")
_SETTING_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_RESERVED_SETTING_KEYS = frozenset({"viewer", "viewer_version"})
_SCHEME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")

SETTING_TYPES = ("slider", "number", "select", "switch", "colormap", "text")
INPUTS = ("single", "compare")
#: The card settings tabs a setting can sit in (the UI's settings palette).
SETTING_TABS = ("data", "grouping", "display", "expressions")
#: The settings sections a setting can sit in (the UI's settings palette).
SETTING_SECTIONS = (
    "Axes", "Smoothing", "Outliers", "Series", "Appearance", "Overlays", "Layout", "Playback", "Compare",
)
#: Icons a viewer may show beside its title in the card builder (Font Awesome solid names).
ICONS = (
    "cube", "cubes", "globe", "sun", "fire", "eye", "compass", "brain", "image", "images",
    "chart-line", "chart-area", "chart-column", "wave-square", "table", "table-cells", "shapes",
    "layer-group", "circle-nodes", "diagram-project", "route", "microscope", "atom", "wand-magic-sparkles",
)
#: Fields a setting of each type may have beside key/type/label/default.
_SETTING_FIELDS = {
    "slider": {"min", "max", "step"},
    "number": {"min", "max", "step"},
    "select": {"options"},
    "switch": set(),
    "colormap": {"options"},
    "text": {"placeholder"},
}

#: Folder entries never published: dotfiles/dot-dirs and tool caches.
_SKIP_DIRS = frozenset({"node_modules", "__pycache__"})

#: MIME types a viewer's files are served with, by extension. Anything not
#: listed is ``application/octet-stream`` (with ``nosniff``).
_MIME_BY_EXT = {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".map": "application/json",
    ".wasm": "application/wasm",
    ".html": "text/html",
    ".htm": "text/html",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".glsl": "text/plain",
    ".vert": "text/plain",
    ".frag": "text/plain",
    ".wgsl": "text/plain",
    ".ktx2": "application/octet-stream",
    ".bin": "application/octet-stream",
}


class ManifestError(ValueError):
    """A viewer manifest or folder breaks a rule (message says which)."""


def validate_kind(kind: Any) -> str:
    """``kind`` if it is a valid data kind, else ``ValueError``."""
    if not isinstance(kind, str) or not KIND_RE.match(kind):
        raise ValueError(
            f"invalid data kind {kind!r}: use lowercase segments of [a-z0-9_.-] "
            "separated by '/', e.g. 'guiding/vmf'"
        )
    return kind


def mime_for(path: str) -> str:
    """The MIME type a viewer file is served with (by extension)."""
    ext = PurePosixPath(path).suffix.lower()
    if ext in _MIME_BY_EXT:
        return _MIME_BY_EXT[ext]
    return mimetypes.guess_type(path)[0] or "application/octet-stream"


def safe_rel_path(path: Any) -> str:
    """A posix path relative to the folder, without ``..``; else ManifestError."""
    if not isinstance(path, str) or not path:
        raise ManifestError("a path must be a non-empty string")
    p = path[2:] if path.startswith("./") else path
    if p.startswith("/") or "\\" in p or _SCHEME_RE.match(p):
        raise ManifestError(f"path {path!r} must be relative to the viewer folder")
    parts = PurePosixPath(p).parts
    if not parts or any(part in ("..", ".") for part in parts):
        raise ManifestError(f"path {path!r} must stay inside the viewer folder")
    return PurePosixPath(*parts).as_posix()


def accepts_matches(pattern: str, target: str) -> bool:
    """Whether an ``accepts`` glob matches ``target`` (``custom:<kind>`` or a
    built-in object type): ``*`` is any run of characters (``/`` included),
    ``?`` one character, the rest literal; the whole string must match."""
    rx = "".join(".*" if c == "*" else "." if c == "?" else re.escape(c) for c in pattern)
    return re.fullmatch(rx, target) is not None


# ---------------------------------------------------------------------------
# Manifest validation
# ---------------------------------------------------------------------------

def _num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v


def _setting(i: int, s: Any, seen: set[str]) -> dict[str, Any]:
    where = f"settings[{i}]"
    if not isinstance(s, dict):
        raise ManifestError(f"{where} must be an object")
    key = s.get("key")
    if not isinstance(key, str) or not _SETTING_KEY_RE.match(key):
        raise ManifestError(f"{where}.key must be an identifier, got {key!r}")
    if key in _RESERVED_SETTING_KEYS:
        raise ManifestError(f"{where}.key {key!r} is reserved")
    if key in seen:
        raise ManifestError(f"{where}.key {key!r} is used twice")
    seen.add(key)
    where = f"setting {key!r}"
    typ = s.get("type")
    if typ not in SETTING_TYPES:
        raise ManifestError(f"{where}: type must be one of {', '.join(SETTING_TYPES)}, got {typ!r}")
    extra = sorted(set(s) - {"key", "type", "label", "default", "help", "tab", "section"} - _SETTING_FIELDS[typ])
    if extra:
        raise ManifestError(f"{where}: {', '.join(extra)} do(es) not apply to a {typ}")
    label = s.get("label", key)
    if not isinstance(label, str):
        raise ManifestError(f"{where}: label must be a string")
    out: dict[str, Any] = {"key": key, "type": typ, "label": label}
    help_ = s.get("help")
    if help_ is not None and not isinstance(help_, str):
        raise ManifestError(f"{where}: help must be a string")
    out["help"] = help_
    tab = s.get("tab", "display")
    if tab not in SETTING_TABS:
        raise ManifestError(f"{where}: tab must be one of {', '.join(SETTING_TABS)}, got {tab!r}")
    out["tab"] = tab
    section = s.get("section", "Appearance")
    if section not in SETTING_SECTIONS:
        raise ManifestError(f"{where}: section must be one of {', '.join(SETTING_SECTIONS)}, got {section!r}")
    out["section"] = section
    for k in ("min", "max", "step"):
        if k in s and s[k] is not None:
            if not _num(s[k]):
                raise ManifestError(f"{where}: {k} must be a number")
            out[k] = s[k]
    default = s.get("default")
    if typ == "slider":
        if "min" not in out or "max" not in out:
            raise ManifestError(f"{where}: a slider needs min and max")
        if out["min"] >= out["max"]:
            raise ManifestError(f"{where}: min must be below max")
    if typ in ("slider", "number"):
        if "step" in out and out["step"] <= 0:
            raise ManifestError(f"{where}: step must be positive")
        if default is None:
            default = out.get("min", 0)
        if not _num(default):
            raise ManifestError(f"{where}: default must be a number")
        if ("min" in out and default < out["min"]) or ("max" in out and default > out["max"]):
            raise ManifestError(f"{where}: default {default} is outside [min, max]")
    elif typ == "select":
        options = s.get("options")
        if not isinstance(options, list) or not options:
            raise ManifestError(f"{where}: a select needs a non-empty options list")
        norm = []
        for o in options:
            if isinstance(o, str):
                norm.append({"value": o, "label": o})
            elif isinstance(o, dict) and isinstance(o.get("value"), str):
                lab = o.get("label", o["value"])
                if not isinstance(lab, str):
                    raise ManifestError(f"{where}: option labels must be strings")
                norm.append({"value": o["value"], "label": lab})
            else:
                raise ManifestError(f"{where}: options are strings or {{value, label}}")
        values = [o["value"] for o in norm]
        if len(set(values)) != len(values):
            raise ManifestError(f"{where}: option values must be unique")
        out["options"] = norm
        if default is None:
            default = values[0]
        if default not in values:
            raise ManifestError(f"{where}: default {default!r} is not an option")
    elif typ == "switch":
        default = False if default is None else default
        if not isinstance(default, bool):
            raise ManifestError(f"{where}: default must be true or false")
    elif typ == "colormap":
        options = s.get("options")
        if options is not None:
            if not isinstance(options, list) or not options or not all(isinstance(o, str) for o in options):
                raise ManifestError(f"{where}: colormap options must be a non-empty list of names")
            out["options"] = list(options)
        if default is None:
            default = out["options"][0] if "options" in out else "turbo"
        if not isinstance(default, str):
            raise ManifestError(f"{where}: default must be a colormap name")
        if "options" in out and default not in out["options"]:
            raise ManifestError(f"{where}: default {default!r} is not an option")
    elif typ == "text":
        default = "" if default is None else default
        if not isinstance(default, str):
            raise ManifestError(f"{where}: default must be a string")
        if "placeholder" in s:
            if not isinstance(s["placeholder"], str):
                raise ManifestError(f"{where}: placeholder must be a string")
            out["placeholder"] = s["placeholder"]
    out["default"] = default
    return out


def _imports(raw: Any) -> dict[str, str]:
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ManifestError("imports must map bare specifiers to ./relative paths")
    out: dict[str, str] = {}
    for spec, target in raw.items():
        if not isinstance(spec, str) or not spec or spec.startswith((".", "/")) or _SCHEME_RE.match(spec):
            raise ManifestError(
                f"imports key {spec!r} must be a bare specifier (like 'd3' or 'three/addons/')"
            )
        if not isinstance(target, str) or not target.startswith("./"):
            raise ManifestError(f"imports[{spec!r}] must be a ./relative path, got {target!r}")
        rel = safe_rel_path(target.rstrip("/") if target.endswith("/") else target)
        if spec.endswith("/") != target.endswith("/"):
            raise ManifestError(
                f"imports[{spec!r}]: a key ending in '/' maps a folder (its path ends in '/' too)"
            )
        out[spec] = "./" + rel + ("/" if target.endswith("/") else "")
    return out


def validate_manifest(raw: Any, files: Iterable[str] | None = None) -> dict[str, Any]:
    """The normalized manifest (every default filled in), or ManifestError.

    ``files`` (the folder's relative file paths) checks that the entry and
    every ``imports`` target exist.
    """
    if not isinstance(raw, dict):
        raise ManifestError(f"{MANIFEST_FILE} must hold a JSON object")
    name = raw.get("name")
    if not isinstance(name, str) or not NAME_RE.match(name):
        raise ManifestError(
            f"name must match {NAME_RE.pattern} (lowercase, digits, '_', '.', '-'), got {name!r}"
        )
    title = raw.get("title", name)
    if not isinstance(title, str) or not title.strip():
        raise ManifestError("title must be a non-empty string")
    description = raw.get("description")
    if description is not None and not isinstance(description, str):
        raise ManifestError("description must be a string")
    icon = raw.get("icon")
    if icon is not None and icon not in ICONS:
        raise ManifestError(f"icon must be one of {', '.join(ICONS)}, got {icon!r}")
    entry = safe_rel_path(raw.get("entry", "index.js"))
    accepts = raw.get("accepts")
    if not isinstance(accepts, list) or not accepts or not all(isinstance(a, str) and a for a in accepts):
        raise ManifestError(
            "accepts must be a non-empty list like ['custom:guiding/vmf'] or ['volume']"
        )
    for a in accepts:
        if a.startswith("custom:"):
            glob = a[len("custom:"):]
            if not glob or not re.fullmatch(r"[a-z0-9_.\-/*?]+", glob):
                raise ManifestError(f"accepts entry {a!r}: custom:<kind glob> of [a-z0-9_.-/*?]")
        elif not re.fullmatch(r"[a-z0-9_*?-]+", a):
            raise ManifestError(f"accepts entry {a!r} is neither custom:<kind> nor an object type")
    inputs = raw.get("inputs", "single")
    if inputs not in INPUTS:
        raise ManifestError(f"inputs must be 'single' or 'compare', got {inputs!r}")
    flags = {}
    for k in ("webgl", "view"):
        v = raw.get(k, False)
        if not isinstance(v, bool):
            raise ManifestError(f"{k} must be true or false")
        flags[k] = v
    settings_raw = raw.get("settings", [])
    if not isinstance(settings_raw, list):
        raise ManifestError("settings must be a list")
    seen: set[str] = set()
    settings = [_setting(i, s, seen) for i, s in enumerate(settings_raw)]
    imports = _imports(raw.get("imports"))
    known = {
        "name", "title", "description", "icon", "entry", "accepts", "inputs", "webgl",
        "view", "settings", "imports", "$schema",
    }
    unknown = sorted(set(raw) - known)
    if unknown:
        raise ManifestError(f"unknown manifest field(s): {', '.join(unknown)}")
    if files is not None:
        fileset = set(files)
        if entry not in fileset:
            raise ManifestError(f"entry {entry!r} does not exist in the viewer folder")
        for spec, target in imports.items():
            rel = target[2:]
            if target.endswith("/"):
                if not any(f.startswith(rel) for f in fileset):
                    raise ManifestError(f"imports[{spec!r}]: folder {target!r} has no files")
            elif rel not in fileset:
                raise ManifestError(f"imports[{spec!r}]: {target!r} does not exist")
    return {
        "name": name,
        "title": title,
        "description": description,
        "icon": icon,
        "entry": entry,
        "accepts": list(accepts),
        "inputs": inputs,
        "webgl": flags["webgl"],
        "view": flags["view"],
        "settings": settings,
        "imports": imports,
    }


# ---------------------------------------------------------------------------
# Folders
# ---------------------------------------------------------------------------

def folder_files(root: Path) -> list[tuple[str, Path]]:
    """``(relative posix path, absolute path)`` of every file a viewer folder
    publishes, sorted: dotfiles/dot-dirs, ``node_modules`` and
    ``__pycache__`` are skipped."""
    out: list[tuple[str, Path]] = []
    for p in sorted(root.rglob("*")):
        rel = p.relative_to(root)
        if any(part.startswith(".") or part in _SKIP_DIRS for part in rel.parts):
            continue
        if p.is_file():
            out.append((rel.as_posix(), p))
    return out


def content_digest(entries: Iterable[tuple[str, str]]) -> str:
    """One digest over ``(path, sha256)`` pairs: equal iff the folders are."""
    h = hashlib.sha256()
    for path, sha in sorted(entries):
        h.update(path.encode())
        h.update(b"\0")
        h.update(sha.encode())
        h.update(b"\n")
    return h.hexdigest()


def load_folder(root: str | Path) -> tuple[dict[str, Any], list[tuple[str, Path, str, int]]]:
    """Validate a viewer folder: ``(normalized manifest, [(path, file, sha256, size)])``.

    Raises:
        ManifestError: No/invalid manifest, missing entry or import target,
            or the folder exceeds ``MAX_FOLDER_BYTES``.
    """
    root = Path(root)
    if not root.is_dir():
        raise ManifestError(f"{root} is not a directory")
    mpath = root / MANIFEST_FILE
    if not mpath.is_file():
        raise ManifestError(f"{root} has no {MANIFEST_FILE}")
    try:
        raw = json.loads(mpath.read_text(encoding="utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise ManifestError(f"{MANIFEST_FILE} is not valid JSON: {exc}") from None
    files: list[tuple[str, Path, str, int]] = []
    total = 0
    for rel, p in folder_files(root):
        data = p.read_bytes()
        total += len(data)
        if total > MAX_FOLDER_BYTES:
            raise ManifestError(
                f"viewer folder {root} is larger than {MAX_FOLDER_BYTES // (1024 * 1024)} MB"
            )
        files.append((rel, p, hashlib.sha256(data).hexdigest(), len(data)))
    manifest = validate_manifest(raw, [f[0] for f in files])
    return manifest, files


def manifest_from_bytes(data: bytes, files: Iterable[str]) -> dict[str, Any]:
    """Validate a manifest given as bytes (dev sources)."""
    try:
        raw = json.loads(data.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise ManifestError(f"{MANIFEST_FILE} is not valid JSON: {exc}") from None
    return validate_manifest(raw, files)
