"""Shared named per-element property normalization for 3D handlers.

``values`` may be a single array-like (canonicalized to ``{"value": arr}``)
or a ``dict[str, array-like]`` of equal-length 1D arrays — one scalar per
mesh vertex, point-cloud point, or box (spec-3dx-superseded.md §B). Used by
the mesh (per-vertex), pointcloud (per-point), and boxes3d (per-box)
handlers so this canonicalization, the npz ``values_<name>`` array layout,
and the ``properties: [{name, min, max, mean}]`` metadata list are
implemented exactly once (spec-visual-compare.md quality bar #3: one shared
module, not a per-handler re-implementation).

``value_range`` (the pre-existing single-property metadata field) is kept
for backward compatibility: it always mirrors the *first* property, so old
UI code (or any external consumer) that only knows about a single named
range keeps working unchanged.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from ._optional import try_import


def _to_1d_f32(v: Any, n: int, label: str, name: str | None) -> np.ndarray:
    torch = try_import("torch")
    if torch is not None and isinstance(v, torch.Tensor):
        v = v.detach().cpu().numpy()
    arr = np.asarray(v).reshape(-1).astype(np.float32)
    if arr.shape[0] != n:
        which = f" property {name!r}" if name else ""
        raise ValueError(
            f"{label} values{which} must have length {n}; got {arr.shape[0]}"
        )
    return arr


def normalize_properties(
    values: Any, n: int, label: str
) -> "dict[str, np.ndarray] | None":
    """Canonicalize ``values`` into an ordered ``{name: (n,) float32}`` dict.

    - ``None`` -> ``None`` (no properties).
    - A bare array-like/torch tensor -> ``{"value": arr}`` (today's single-
      array behavior, unchanged from the caller's point of view).
    - A ``dict[str, array-like]`` -> validated per-entry (every property
      must have length ``n``), keys stringified, values cast to float32.
      Insertion order is preserved (drives ``properties_metadata`` order and
      therefore which property ``value_range`` mirrors).
    - An empty dict -> ``None`` (nothing to record).
    """
    if values is None:
        return None
    if isinstance(values, dict):
        if not values:
            return None
        return {str(k): _to_1d_f32(v, n, label, str(k)) for k, v in values.items()}
    return {"value": _to_1d_f32(values, n, label, None)}


def properties_arrays(
    properties: "dict[str, np.ndarray] | None",
) -> "dict[str, np.ndarray]":
    """``{"values_<name>": arr}`` npz entries — ``{}`` if ``properties`` is falsy."""
    if not properties:
        return {}
    return {f"values_{name}": arr for name, arr in properties.items()}


def properties_metadata(
    properties: "dict[str, np.ndarray] | None",
) -> "list[dict[str, Any]] | None":
    """``[{name, min, max, mean}, ...]`` in insertion order, or ``None``."""
    if not properties:
        return None
    out: list[dict[str, Any]] = []
    for name, arr in properties.items():
        if arr.size == 0:
            continue
        out.append(
            {
                "name": name,
                "min": float(arr.min()),
                "max": float(arr.max()),
                "mean": float(arr.mean()),
            }
        )
    return out or None


def value_range_from(
    properties_meta: "list[dict[str, Any]] | None",
) -> "dict[str, float] | None":
    """First property's ``{min, max, mean}`` — backward-compat ``value_range``."""
    if not properties_meta:
        return None
    first = properties_meta[0]
    return {"min": first["min"], "max": first["max"], "mean": first["mean"]}
