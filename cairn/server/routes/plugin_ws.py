"""WebSocket endpoint for server-side plugins.

Server plugins run their Python ``render()`` method on the Cairn server.
Rendered frames (PNG/JPEG bytes) are streamed to the client. Mouse and
keyboard events are forwarded from the client to the plugin's
``on_mouse()`` / ``on_key()`` methods.

Protocol (JSON messages unless noted):

    Server → Client:
        {"type": "frame", "mime": "image/png"}  followed by binary frame
        {"type": "error", "message": "..."}

    Client → Server:
        {"type": "render", "artifact_hash": "...", "metadata": {...}, "step": N}
        {"type": "mouse", "x": N, "y": N, "button": N, "action": "move|down|up"}
        {"type": "key", "key": "...", "action": "down|up"}
"""

from __future__ import annotations

import importlib
import json
import logging
import textwrap
import types
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ._common import get_blobs, get_db

log = logging.getLogger(__name__)
router = APIRouter(tags=["plugins"])


def _reconstruct_plugin_class(source: str) -> Any:
    """Reconstruct a ServerPlugin class from its source code.

    Creates a temporary module, injects stub base classes, and exec's the
    plugin source to recover the user's class.
    """
    # Stub module so `from cairn import ServerPlugin` works.
    stub_code = textwrap.dedent("""\
        class _TypeWrapper:
            object_type = ""
            def __init__(self, obj=None, **kwargs):
                self.obj = obj
                self.kwargs = kwargs

        class _PluginBase(_TypeWrapper):
            object_type = "plugin"
            name = ""

        class JSPlugin(_PluginBase): pass
        class PythonPlugin(_PluginBase):
            requires = []
            def render(self, data, metadata, step): raise NotImplementedError
        class ServerPlugin(_PluginBase):
            def render(self, data, metadata, step): raise NotImplementedError
            def on_mouse(self, event): pass
            def on_key(self, event): pass
    """)
    stub_mod = types.ModuleType("cairn")
    exec(stub_code, stub_mod.__dict__)  # noqa: S102

    import sys
    old_cairn = sys.modules.get("cairn")
    sys.modules["cairn"] = stub_mod
    try:
        mod = types.ModuleType("_plugin_mod")
        exec(source, mod.__dict__)  # noqa: S102
        # Find the ServerPlugin subclass.
        for name in dir(mod):
            obj = getattr(mod, name)
            if (
                isinstance(obj, type)
                and issubclass(obj, stub_mod.ServerPlugin)  # type: ignore[attr-defined]
                and obj is not stub_mod.ServerPlugin  # type: ignore[attr-defined]
            ):
                return obj
    finally:
        if old_cairn is not None:
            sys.modules["cairn"] = old_cairn
        else:
            sys.modules.pop("cairn", None)
    return None


@router.websocket("/ws/plugin/{run_id}/{metric_name}")
async def plugin_ws(
    websocket: WebSocket,
    run_id: str,
    metric_name: str,
) -> None:
    await websocket.accept()
    db = get_db(websocket)
    blobs = get_blobs(websocket)

    plugin_instance: Any = None

    try:
        while True:
            msg = await websocket.receive_json()
            msg_type = msg.get("type")

            if msg_type == "render":
                artifact_hash = msg.get("artifact_hash")
                metadata = msg.get("metadata", {})
                step = msg.get("step", 0)
                plugin_hash = metadata.get("plugin_hash")

                if not artifact_hash or not plugin_hash:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Missing artifact_hash or plugin_hash in metadata",
                    })
                    continue

                try:
                    # Load plugin source.
                    plugin_data, plugin_meta = blobs.get(plugin_hash)
                    plugin_source = plugin_data.decode("utf-8")

                    # Load data artifact.
                    data_bytes, _data_meta = blobs.get(artifact_hash)

                    # Reconstruct and instantiate plugin class.
                    plugin_cls = _reconstruct_plugin_class(plugin_source)
                    if plugin_cls is None:
                        await websocket.send_json({
                            "type": "error",
                            "message": "No ServerPlugin subclass found in plugin source",
                        })
                        continue

                    plugin_instance = plugin_cls()
                    # Store for re-rendering on mouse/key events.
                    plugin_instance._last_data = data_bytes
                    plugin_instance._last_metadata = metadata
                    plugin_instance._last_step = step
                    plugin_instance._needs_rerender = False

                    # Call render.
                    frame_bytes = plugin_instance.render(data_bytes, metadata, step)
                    if isinstance(frame_bytes, (bytes, bytearray)):
                        await websocket.send_json({"type": "frame", "mime": "image/png"})
                        await websocket.send_bytes(frame_bytes)
                    else:
                        await websocket.send_json({
                            "type": "error",
                            "message": f"render() must return bytes, got {type(frame_bytes).__name__}",
                        })
                except Exception as exc:
                    log.exception("Server plugin render error for %s/%s", run_id, metric_name)
                    await websocket.send_json({
                        "type": "error",
                        "message": str(exc),
                    })

            elif msg_type == "mouse" and plugin_instance is not None:
                try:
                    plugin_instance.on_mouse(msg)
                    # Re-render after mouse interaction if the plugin
                    # updated its state (e.g. camera rotation).
                    if hasattr(plugin_instance, "_needs_rerender") and plugin_instance._needs_rerender:
                        plugin_instance._needs_rerender = False
                        frame_bytes = plugin_instance.render(
                            plugin_instance._last_data,
                            plugin_instance._last_metadata,
                            plugin_instance._last_step,
                        )
                        if isinstance(frame_bytes, (bytes, bytearray)):
                            await websocket.send_json({"type": "frame", "mime": "image/png"})
                            await websocket.send_bytes(frame_bytes)
                except Exception as exc:
                    log.debug("on_mouse error: %s", exc)

            elif msg_type == "key" and plugin_instance is not None:
                try:
                    plugin_instance.on_key(msg)
                    if hasattr(plugin_instance, "_needs_rerender") and plugin_instance._needs_rerender:
                        plugin_instance._needs_rerender = False
                        frame_bytes = plugin_instance.render(
                            plugin_instance._last_data,
                            plugin_instance._last_metadata,
                            plugin_instance._last_step,
                        )
                        if isinstance(frame_bytes, (bytes, bytearray)):
                            await websocket.send_json({"type": "frame", "mime": "image/png"})
                            await websocket.send_bytes(frame_bytes)
                except Exception as exc:
                    log.debug("on_key error: %s", exc)

    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("Plugin WebSocket error for %s/%s", run_id, metric_name)
