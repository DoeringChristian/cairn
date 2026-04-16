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
    """Decorator/function: register a handler with the default registry.

    Accepts either a class (instantiated with no args) or an instance.
    """
    instance = cls_or_instance() if isinstance(cls_or_instance, type) else cls_or_instance
    default_registry.register(instance)
    return cls_or_instance
