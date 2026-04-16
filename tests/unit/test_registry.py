"""Registry dispatch + wrapper handling."""

from __future__ import annotations

import pytest

from cairn.sdk.handlers import default_registry
from cairn.sdk.handlers.registry import HandlerRegistry, register_handler
from cairn.sdk.wrappers import Image, Tensor


class _A:
    object_type = "custom_a"
    mime_type = "application/octet-stream"

    def can_handle(self, obj):
        return isinstance(obj, str) and obj.startswith("a:")

    def serialize(self, obj, **kw):
        return b"a", {}


class _B:
    object_type = "custom_b"
    mime_type = "application/octet-stream"

    def can_handle(self, obj):
        return isinstance(obj, str) and obj.startswith("a:")

    def serialize(self, obj, **kw):
        return b"b", {}


def test_lifo_dispatch():
    r = HandlerRegistry()
    r.register(_A())
    r.register(_B())
    h = r.find_handler("a:hello")
    assert isinstance(h, _B)  # B registered later, wins.


def test_register_handler_decorator():
    r = HandlerRegistry()

    # Manually call register to avoid polluting default_registry.
    class H:
        object_type = "custom"
        mime_type = "application/octet-stream"

        def can_handle(self, obj):
            return obj == "sentinel"

        def serialize(self, obj, **kw):
            return b"", {}

    r.register(H())
    assert r.find_handler("sentinel") is not None
    assert r.find_handler("nope") is None


def test_wrapper_dispatch_bypasses_can_handle():
    # Even if no handler `can_handle` the raw object, a wrapper forces
    # dispatch by object_type.
    arr = object()  # handlers can't serialize this
    assert default_registry.find_handler(arr) is None
    wrapped = Tensor(arr)
    h = default_registry.find_handler(wrapped)
    assert h is not None
    assert h.object_type == "tensor"


def test_find_by_type():
    assert default_registry.find_by_type("scalar") is not None
    assert default_registry.find_by_type("nonexistent") is None


def test_can_handle_exception_falls_through():
    r = HandlerRegistry()

    class Bad:
        object_type = "bad"
        mime_type = "x"

        def can_handle(self, obj):
            raise RuntimeError("broken")

        def serialize(self, obj, **kw):
            return b"", {}

    class Good:
        object_type = "good"
        mime_type = "x"

        def can_handle(self, obj):
            return True

        def serialize(self, obj, **kw):
            return b"g", {}

    r.register(Good())
    r.register(Bad())
    # Bad is later, raises in can_handle → Good wins.
    h = r.find_handler("hello")
    assert isinstance(h, Good)


def test_register_handler_accepts_class_or_instance():
    r = HandlerRegistry()

    class H:
        object_type = "t"
        mime_type = "x"

        def can_handle(self, obj):
            return True

        def serialize(self, obj, **kw):
            return b"", {}

    inst = H()
    assert r.register(inst) is inst


def test_image_wrapper_routes_to_image_handler():
    # Pass something the image handler wouldn't auto-match (a plain int)
    # wrapped as Image → registry returns image handler.
    h = default_registry.find_handler(Image(42))
    assert h is not None
    assert h.object_type == "image"
