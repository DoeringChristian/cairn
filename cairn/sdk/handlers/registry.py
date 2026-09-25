"""Type handler registry — LIFO dispatch, user-extensible."""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from ..wrappers import _TypeWrapper


@runtime_checkable
class TypeHandler(Protocol):
    """Protocol every handler must satisfy."""

    object_type: str
    mime_type: str

    def can_handle(self, obj: Any) -> bool: ...

    def serialize(self, obj: Any, **kwargs: Any) -> tuple[bytes, dict[str, Any]]: ...


def resolve_mime_type(handler: TypeHandler, obj: Any, kwargs: dict[str, Any] | None = None) -> str:
    """Return a handler's MIME type, allowing content- and option-dependent formats."""
    resolver = getattr(handler, "mime_type_for", None)
    if callable(resolver):
        return str(resolver(obj, **(kwargs or {})))
    return handler.mime_type


class HandlerRegistry:
    """Ordered collection of handlers; newest wins via ``can_handle``."""

    def __init__(self) -> None:
        self._handlers: list[TypeHandler] = []

    def register(self, handler: TypeHandler) -> TypeHandler:
        self._handlers.append(handler)
        return handler

    def all(self) -> list[TypeHandler]:
        return list(self._handlers)

    def find_handler(self, obj: Any) -> TypeHandler | None:
        if isinstance(obj, _TypeWrapper):
            return self.find_by_type(obj.object_type)
        for handler in reversed(self._handlers):
            try:
                if handler.can_handle(obj):
                    return handler
            except Exception:  # noqa: BLE001
                continue
        return None

    def find_by_type(self, object_type: str) -> TypeHandler | None:
        for handler in reversed(self._handlers):
            if handler.object_type == object_type:
                return handler
        return None


default_registry = HandlerRegistry()


def register_handler(cls_or_instance: Any) -> Any:
    """Register a type handler with the default registry, teaching ``Run.track``
    a new kind of value.

    A handler has an ``object_type`` and ``mime_type`` string, a
    ``can_handle(obj) -> bool`` test and ``serialize(obj, **kwargs) ->
    (bytes, metadata)``; an optional ``deserialize(data, metadata)`` lets
    readers decode it back. The most recently registered handler whose
    ``can_handle`` accepts a value wins, so a handler can override a built-in.

    Example:
        ```python
        @cairn.register_handler
        class GraphHandler:
            object_type = "text"
            mime_type = "text/plain"

            def can_handle(self, obj):
                return isinstance(obj, nx.Graph)

            def serialize(self, obj, **kwargs):
                return "\n".join(nx.generate_edgelist(obj)).encode(), {}
        ```

    Args:
        cls_or_instance: A handler class (instantiated with no arguments) or
            a handler instance.

    Returns:
        ``cls_or_instance`` unchanged, so it works as a class decorator.
    """
    instance = cls_or_instance() if isinstance(cls_or_instance, type) else cls_or_instance
    default_registry.register(instance)
    return cls_or_instance
