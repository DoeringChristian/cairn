"""A run's config / summary as a nested JSON document plus its flat index.

The document is the source of truth (``runs.config`` / ``runs.summary``):
exactly what was logged, after merging every write. The ``params`` /
``summary`` tables are a derived index of its leaves under dotted keys,
rebuilt from the document on every write, so filters, run-table columns and
expressions keep addressing ``optim.lr``.

Rules (also the SDK's; ``cairn.Run.config`` validates with ``normalize``
before anything is sent):

* Values are JSON: ``dict`` with ``str`` keys, ``list`` (tuples become
  lists), ``str``, ``int``, ``float`` (NaN/inf allowed), ``bool``, ``None``.
  numpy scalars become Python scalars. Anything else is a ``TypeError``
  naming the key path.
* ``merge``: a dict merged into a dict recurses; anything else replaces
  (a scalar over a dict drops the subtree, lists are replaced whole).
  ``None`` is a value, not a deletion.
* Keys may contain dots; they are kept in the document. The flat key of a
  node is the dot-join of its path. Two different paths with the same flat
  key (``{"a.b": 1, "a": {"b": 2}}``) are a ``ValueError``, so a dotted path
  always names one node.
* An empty dict is kept in the document and has no flat row.
* A summary may hold MEDIA (``run.summary(fig=cairn.Figure(f))``): the SDK
  uploads the value and stores a marker leaf ``{"$media": {"hash",
  "object_type", "mime_type", "caption"?}}`` in its place (see
  ``media_leaves``). A marker is a leaf to every rule here: a write over it
  replaces it whole, and it has no row in the flat index (the run's
  ``sequences`` hold it instead, see ``ingest_ops.write_doc``).
"""

from __future__ import annotations

import copy
import json
import math
from typing import Any

#: The key of a media marker leaf (also a table's media cells, see
#: ``cairn.sdk.uploads.upload_table_media``).
MEDIA_KEY = "$media"


def is_media(value: Any) -> bool:
    """Whether ``value`` is a media marker leaf ``{"$media": {...}}``."""
    return isinstance(value, dict) and len(value) == 1 and isinstance(value.get(MEDIA_KEY), dict)


def _check_marker(value: dict[str, Any], path: str) -> None:
    """A dict holding ``$media`` must be a well-formed marker."""
    inner = value.get(MEDIA_KEY)
    if (
        len(value) != 1 or not isinstance(inner, dict)
        or not isinstance(inner.get("hash"), str) or not isinstance(inner.get("object_type"), str)
    ):
        raise ValueError(
            f"{_where(path)} has the reserved key {MEDIA_KEY!r} but is not a media value; "
            "pass media as a cairn wrapper (cairn.Image, cairn.Figure, ...)"
        )


def normalize(value: Any, path: str = "", what: str = "config") -> Any:
    """``value`` as plain JSON types (see the module doc); raises
    ``TypeError`` naming the offending key path. ``what`` names the document
    (``"config"`` or ``"summary"``) in the messages. A media marker is kept
    as is in a summary (a ``ValueError`` when malformed)."""
    if value is None or isinstance(value, (bool, str)):
        return value
    if isinstance(value, int):
        return int(value)
    if isinstance(value, float):
        return float(value)
    if isinstance(value, dict):
        if what == "summary" and MEDIA_KEY in value:
            _check_marker(value, path)
            return copy.deepcopy(value)
        out: dict[str, Any] = {}
        for k, v in value.items():
            if not isinstance(k, str):
                raise TypeError(
                    f"{what} keys must be str; {_where(path)} has the key {k!r} "
                    f"({type(k).__name__})"
                )
            out[k] = normalize(v, f"{path}.{k}" if path else k, what)
        return out
    if isinstance(value, (list, tuple)):
        return [normalize(v, f"{path}[{i}]", what) for i, v in enumerate(value)]
    # numpy (and other array-library) scalars: a 0-d value with .item().
    module = type(value).__module__.split(".")[0]
    if module in ("numpy", "torch", "jax", "jaxlib") and hasattr(value, "item"):
        try:
            if getattr(value, "ndim", 0) == 0:
                return normalize(value.item(), path, what)
        except (TypeError, ValueError):
            pass
    media = " or cairn media (cairn.Image, cairn.Figure, ...)" if what == "summary" else ""
    raise TypeError(
        f"{what} values must be JSON (dict, list, str, int, float, bool, None){media}; "
        f"{_where(path)} is a {type(value).__name__}"
    )


def _where(path: str) -> str:
    return repr(path) if path else "the top level"


def merge(base: dict[str, Any] | None, update: dict[str, Any]) -> dict[str, Any]:
    """A new document: ``update`` deep-merged into ``base``."""
    out = copy.deepcopy(base) if base else {}
    _merge_into(out, update)
    return out


def _merge_into(target: dict[str, Any], update: dict[str, Any]) -> None:
    for k, v in update.items():
        old = target.get(k)
        if isinstance(v, dict) and isinstance(old, dict) and not is_media(v) and not is_media(old):
            _merge_into(target[k], v)
        else:
            target[k] = copy.deepcopy(v)


def nodes(doc: dict[str, Any]) -> dict[str, Any]:
    """Every node of ``doc`` (dicts and leaves) by its flat key.

    Raises:
        ValueError: Two different paths share a flat key.
    """
    out: dict[str, Any] = {}
    paths: dict[str, tuple[str, ...]] = {}

    def walk(d: dict[str, Any], prefix: tuple[str, ...]) -> None:
        for k, v in d.items():
            path = (*prefix, k)
            flat = ".".join(path)
            if flat in paths and paths[flat] != path:
                raise ValueError(
                    f"config paths {_fmt(paths[flat])} and {_fmt(path)} both flatten to "
                    f"{flat!r}; rename one of them"
                )
            paths[flat] = path
            out[flat] = v
            if isinstance(v, dict) and not is_media(v):
                walk(v, path)

    walk(doc, ())
    return out


def _fmt(path: tuple[str, ...]) -> str:
    return "".join(f"[{p!r}]" for p in path)


def flatten(doc: dict[str, Any]) -> dict[str, Any]:
    """The JSON leaves of ``doc`` by flat key (empty dicts and media markers
    have none).

    Raises:
        ValueError: Two different paths share a flat key.
    """
    return {k: v for k, v in nodes(doc).items() if not isinstance(v, dict)}


def media_leaves(doc: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """The media markers of ``doc`` by flat key, each as its inner dict
    (``{"hash", "object_type", "mime_type", "caption"?}``).

    Raises:
        ValueError: Two different paths share a flat key.
    """
    return {k: v[MEDIA_KEY] for k, v in nodes(doc).items() if is_media(v)}


def without_media(doc: Any) -> Any:
    """``doc`` without its media markers (the Overview's summary: media is
    shown by cards). A dict left empty only by that is dropped too."""
    if not isinstance(doc, dict):
        return doc
    out: dict[str, Any] = {}
    for k, v in doc.items():
        if is_media(v):
            continue
        if isinstance(v, dict) and v:
            sub = without_media(v)
            if not sub:
                continue
            out[k] = sub
        else:
            out[k] = v
    return out


def get(doc: dict[str, Any] | None, key: str) -> Any:
    """The node at flat key ``key`` (a leaf or a sub-document), or None."""
    if not doc:
        return None
    try:
        return nodes(doc).get(key)
    except ValueError:
        return None


def delete(doc: dict[str, Any] | None, key: str) -> dict[str, Any]:
    """A new document without the node at flat key ``key`` (and its subtree);
    unchanged when there is no such node."""
    out = copy.deepcopy(doc) if doc else {}

    def walk(d: dict[str, Any], prefix: str) -> bool:
        for k in list(d):
            flat = f"{prefix}.{k}" if prefix else k
            if flat == key:
                del d[k]
                return True
            if (
                isinstance(d[k], dict) and not is_media(d[k])
                and key.startswith(flat + ".") and walk(d[k], flat)
            ):
                return True
        return False

    walk(out, "")
    return out


def unflatten(values: dict[str, Any]) -> dict[str, Any]:
    """Dotted keys to nested dicts (``{"optim.lr": 1}`` -> ``{"optim": {"lr": 1}}``),
    for sources that only know dotted names (sweep parameters)."""
    out: dict[str, Any] = {}
    for key, v in values.items():
        parts = key.split(".")
        d = out
        for p in parts[:-1]:
            nxt = d.get(p)
            if not isinstance(nxt, dict):
                nxt = d[p] = {}
            d = nxt
        d[parts[-1]] = v
    return out


def dumps(doc: dict[str, Any]) -> str:
    """The stored form (NaN/inf as JSON extensions)."""
    return json.dumps(doc, separators=(",", ":"))


def loads(text: str | None) -> dict[str, Any]:
    if not text:
        return {}
    out = json.loads(text)
    return out if isinstance(out, dict) else {}


def json_safe(doc: Any) -> Any:
    """``doc`` for a strict-JSON response (the browser's ``JSON.parse``):
    NaN / inf become the strings ``"NaN"`` / ``"Infinity"`` / ``"-Infinity"``.
    Exact readers use the raw document instead (``/api/runs/{id}/documents``)."""
    if isinstance(doc, float) and not math.isfinite(doc):
        return "NaN" if math.isnan(doc) else ("Infinity" if doc > 0 else "-Infinity")
    if isinstance(doc, dict):
        return {k: json_safe(v) for k, v in doc.items()}
    if isinstance(doc, list):
        return [json_safe(v) for v in doc]
    return doc
