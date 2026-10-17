"""Serialize JSON entries and typed media without flattening their structure."""
from collections.abc import Mapping
from .wrappers import _TypeWrapper
from .uploads import upload_value


def serialize(run, value, depth=0):
    if depth > 32:
        raise ValueError("record nesting exceeds 32 levels")
    if value is None or type(value) in (str, bool, int, float):
        return value
    if isinstance(value, Mapping):
        if any(not isinstance(key, str) for key in value):
            raise ValueError("record keys must be strings")
        return {key: serialize(run, item, depth + 1) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [serialize(run, item, depth + 1) for item in value]
    if isinstance(value, _TypeWrapper):
        handler = run._registry.find_by_type(value.object_type)
        payload, options = value.obj, dict(value.kwargs)
    else:
        handler = run._registry.find_handler(value)
        payload, options = value, {}
    if handler is None:
        raise TypeError(f"Unsupported record value {type(value).__name__}; use a Cairn media wrapper")
    if handler.object_type == "scalar":
        return handler.to_scalar(payload)
    digest, mime, metadata, size = upload_value(run._writer, run._registry, handler, payload, options)
    return {"$media": {"hash": digest, "mime_type": mime, "object_type": handler.object_type,
                        "size": size, "metadata": metadata}}
