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
"""

from __future__ import annotations

import copy
import json
import math
from typing import Any


def normalize(value: Any, path: str = "") -> Any:
    """``value`` as plain JSON types (see the module doc); raises
    ``TypeError`` naming the offending key path."""
    if value is None or isinstance(value, (bool, str)):
        return value
    if isinstance(value, int):
        return int(value)
    if isinstance(value, float):
        return float(value)
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for k, v in value.items():
            if not isinstance(k, str):
                raise TypeError(
                    f"config keys must be str; {_where(path)} has the key {k!r} "
                    f"({type(k).__name__})"
                )
            out[k] = normalize(v, f"{path}.{k}" if path else k)
        return out
    if isinstance(value, (list, tuple)):
        return [normalize(v, f"{path}[{i}]") for i, v in enumerate(value)]
    # numpy (and other array-library) scalars: a 0-d value with .item().
    module = type(value).__module__.split(".")[0]
    if module in ("numpy", "torch", "jax", "jaxlib") and hasattr(value, "item"):
        try:
            if getattr(value, "ndim", 0) == 0:
                return normalize(value.item(), path)
        except (TypeError, ValueError):
            pass
    raise TypeError(
        f"config values must be JSON (dict, list, str, int, float, bool, None); "
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
        if isinstance(v, dict) and isinstance(target.get(k), dict):
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
            if isinstance(v, dict):
                walk(v, path)

    walk(doc, ())
    return out


def _fmt(path: tuple[str, ...]) -> str:
    return "".join(f"[{p!r}]" for p in path)


def flatten(doc: dict[str, Any]) -> dict[str, Any]:
    """The leaves of ``doc`` by flat key (empty dicts have none).

    Raises:
        ValueError: Two different paths share a flat key.
    """
    return {k: v for k, v in nodes(doc).items() if not isinstance(v, dict)}


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
            if isinstance(d[k], dict) and key.startswith(flat + ".") and walk(d[k], flat):
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


def is_nan(v: Any) -> bool:
    return isinstance(v, float) and math.isnan(v)
