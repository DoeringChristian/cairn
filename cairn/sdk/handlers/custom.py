"""Custom data handler — ``cairn.Data(payload, kind=...)`` for your own viewers.

The payload is stored in one of three formats, picked by its shape:

* ``npz`` — a ``dict`` holding at least one array (numpy array or torch
  tensor). ``numpy.savez_compressed`` with one ``<name>.npy`` member per
  array, each C-contiguous and little-endian, of a dtype a browser can read
  (``float16/32/64``, ``int8..64``, ``uint8..64``, ``bool``). The dict's other
  entries (numbers, strings, lists...) are JSON and go to metadata ``values``;
  decoding merges both back into one dict.
* ``json`` — any other JSON-able value.
* ``bytes`` — ``bytes``/``bytearray``/``memoryview``, stored verbatim.

Metadata: ``{kind, format, meta, arrays: {name: {shape, dtype}}, values,
size_bytes}``. ``kind`` names the data's shape for viewers (``"guiding/vmf"``);
``meta`` is free JSON for them.
"""

from __future__ import annotations

import io
import json
from typing import Any

import numpy as np

from ...server.viewer_manifest import validate_kind
from ._optional import try_import

MAX_BYTES = 128 * 1024 * 1024

FORMAT_MIME = {
    "npz": "application/x-npz",
    "json": "application/json",
    "bytes": "application/octet-stream",
}

#: numpy dtype kinds + sizes a browser decoder reads (cairn-ui parse-npy).
_BROWSER_DTYPES = frozenset({
    "f2", "f4", "f8", "i1", "i2", "i4", "i8", "u1", "u2", "u4", "u8", "b1",
})


def _as_array(v: Any) -> np.ndarray | None:
    if isinstance(v, np.ndarray):
        return v
    torch = try_import("torch")
    if torch is not None and isinstance(v, torch.Tensor):
        return v.detach().cpu().numpy()
    return None


def _jsonable(v: Any, where: str) -> Any:
    """``v`` with numpy scalars turned into Python ones; TypeError if not JSON."""
    def default(o: Any) -> Any:
        if isinstance(o, np.generic):
            return o.item()
        raise TypeError(f"{type(o).__name__} is not JSON-serializable")
    try:
        return json.loads(json.dumps(v, default=default, allow_nan=False))
    except TypeError as exc:
        raise TypeError(f"cairn.Data {where}: {exc}") from None
    except ValueError as exc:  # NaN / infinity: JSON has no such numbers
        raise ValueError(f"cairn.Data {where}: {exc}") from None


def _browser_array(name: str, arr: np.ndarray) -> np.ndarray:
    a = np.ascontiguousarray(arr)
    if a.dtype.kind not in "fiub":
        raise TypeError(
            f"cairn.Data array {name!r} has dtype {a.dtype}; use a numeric or bool array"
        )
    if a.dtype.byteorder == ">":
        a = a.astype(a.dtype.newbyteorder("<"))
    if f"{a.dtype.kind}{a.dtype.itemsize}" not in _BROWSER_DTYPES:
        raise TypeError(f"cairn.Data array {name!r} has unsupported dtype {a.dtype}")
    return a


class CustomHandler:
    object_type = "custom"
    mime_type = "application/octet-stream"

    def can_handle(self, obj: Any) -> bool:
        # Only via cairn.Data(...): a kind is required.
        return False

    @staticmethod
    def _format(obj: Any) -> str:
        if isinstance(obj, (bytes, bytearray, memoryview)):
            return "bytes"
        if isinstance(obj, dict) and any(_as_array(v) is not None for v in obj.values()):
            return "npz"
        return "json"

    def mime_type_for(self, obj: Any, **kwargs: Any) -> str:
        return FORMAT_MIME[self._format(obj)]

    def serialize(
        self, obj: Any, kind: str | None = None, meta: dict[str, Any] | None = None, **kwargs: Any,
    ) -> tuple[bytes, dict[str, Any]]:
        if kind is None:
            raise TypeError("cairn.Data needs a kind, e.g. cairn.Data(x, kind='guiding/vmf')")
        validate_kind(kind)
        if kwargs:
            raise TypeError(f"cairn.Data got unexpected keyword(s): {', '.join(sorted(kwargs))}")
        if meta is not None and not isinstance(meta, dict):
            raise TypeError("cairn.Data meta must be a dict")
        user_meta = _jsonable(meta or {}, "meta")
        fmt = self._format(obj)
        arrays_meta: dict[str, Any] = {}
        values: dict[str, Any] = {}
        if fmt == "bytes":
            data = bytes(obj)
            raw_size = len(data)
        elif fmt == "json":
            data = json.dumps(_jsonable(obj, "payload"), separators=(",", ":"), allow_nan=False).encode()
            raw_size = len(data)
        else:
            arrays: dict[str, np.ndarray] = {}
            for name, v in obj.items():
                if not isinstance(name, str) or not name or "/" in name or "\0" in name:
                    raise TypeError(f"cairn.Data keys must be non-empty strings without '/', got {name!r}")
                arr = _as_array(v)
                if arr is None:
                    values[name] = _jsonable(v, f"value {name!r}")
                else:
                    arrays[name] = _browser_array(name, arr)
            raw_size = sum(int(a.nbytes) for a in arrays.values())
            if raw_size > MAX_BYTES:
                raise ValueError(f"cairn.Data arrays are too large ({raw_size} bytes); max is {MAX_BYTES}")
            buf = io.BytesIO()
            np.savez_compressed(buf, **arrays)
            data = buf.getvalue()
            arrays_meta = {
                n: {"shape": [int(s) for s in a.shape], "dtype": str(a.dtype)}
                for n, a in arrays.items()
            }
        if raw_size > MAX_BYTES:
            raise ValueError(f"cairn.Data payload is too large ({raw_size} bytes); max is {MAX_BYTES}")
        return data, {
            "kind": kind,
            "format": fmt,
            "meta": user_meta,
            "arrays": arrays_meta,
            "values": values,
            "size_bytes": len(data),
        }

    def deserialize(self, data: bytes, metadata: dict[str, Any] | None = None) -> Any:
        """npz → ``dict`` (values + arrays), json → the value, bytes → bytes."""
        fmt = (metadata or {}).get("format")
        if fmt == "json":
            return json.loads(data)
        if fmt == "npz":
            out: dict[str, Any] = dict((metadata or {}).get("values") or {})
            with np.load(io.BytesIO(data), allow_pickle=False) as z:
                for name in z.files:
                    out[name] = z[name]
            return out
        return data
