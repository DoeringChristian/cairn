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

import asyncio
import importlib
import io
import json
import logging
import os
import shutil
import signal
import subprocess
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
            _needs_rerender = False
            def render(self, data, metadata, step): raise NotImplementedError
            def request_rerender(self): self._needs_rerender = True
            def on_mouse(self, event): pass
            def on_key(self, event): pass
        class WindowPlugin(_PluginBase):
            width = 800
            height = 600
            depth = 24
            fps = 15
            def launch(self, data, metadata, step): raise NotImplementedError
    """)
    stub_mod = types.ModuleType("cairn")
    exec(stub_code, stub_mod.__dict__)  # noqa: S102

    import sys
    old_cairn = sys.modules.get("cairn")
    old_sdk_plugins = sys.modules.get("cairn.sdk.plugins")
    sys.modules["cairn"] = stub_mod
    sys.modules["cairn.sdk.plugins"] = stub_mod
    try:
        mod = types.ModuleType("_plugin_mod")
        # Inject stub names directly so `from cairn import X` works
        # even if the import system has caching issues.
        mod.__dict__.update({
            k: v for k, v in stub_mod.__dict__.items()
            if not k.startswith("_") or k in ("_PluginBase", "_TypeWrapper")
        })
        exec(source, mod.__dict__)  # noqa: S102
        # Find a ServerPlugin or WindowPlugin subclass.
        base_classes = (stub_mod.ServerPlugin, stub_mod.WindowPlugin)  # type: ignore[attr-defined]
        for name in dir(mod):
            obj = getattr(mod, name)
            if (
                isinstance(obj, type)
                and any(issubclass(obj, b) for b in base_classes)
                and obj not in base_classes
            ):
                return obj
    finally:
        if old_cairn is not None:
            sys.modules["cairn"] = old_cairn
        else:
            sys.modules.pop("cairn", None)
        if old_sdk_plugins is not None:
            sys.modules["cairn.sdk.plugins"] = old_sdk_plugins
        else:
            sys.modules.pop("cairn.sdk.plugins", None)
    return None


def _find_free_display() -> int:
    """Find an unused X display number."""
    for n in range(99, 200):
        lock = f"/tmp/.X{n}-lock"
        sock = f"/tmp/.X11-unix/X{n}"
        if not os.path.exists(lock) and not os.path.exists(sock):
            return n
    raise RuntimeError("No free X display found (tried :99-:199)")


class _XvfbSession:
    """Manages an Xvfb virtual display + child application."""

    def __init__(self, width: int, height: int, depth: int = 24):
        self.display_num = _find_free_display()
        self.display = f":{self.display_num}"
        self.width = width
        self.height = height
        self.xvfb_proc: subprocess.Popen | None = None
        self.app_proc: Any = None

        # Start Xvfb.
        self.xvfb_proc = subprocess.Popen(
            [
                "Xvfb", self.display,
                "-screen", "0", f"{width}x{height}x{depth}",
                "-ac",  # disable access control
                "+extension", "GLX",  # enable GLX for OpenGL apps
                "-nolisten", "tcp",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        # Wait for Xvfb to be ready.
        import time
        for _ in range(20):
            if os.path.exists(f"/tmp/.X11-unix/X{self.display_num}"):
                break
            time.sleep(0.1)

    def env(self) -> dict[str, str]:
        """Return env dict forcing X11 on the virtual display."""
        e = os.environ.copy()
        e["DISPLAY"] = self.display
        # Force X11 — remove Wayland vars so apps don't try to
        # connect to a Wayland compositor instead of our Xvfb.
        e.pop("WAYLAND_DISPLAY", None)
        e.pop("XDG_SESSION_TYPE", None)
        e["GDK_BACKEND"] = "x11"
        e["QT_QPA_PLATFORM"] = "xcb"
        return e

    def screenshot_raw(self) -> tuple[bytes, int, int]:
        """Fast screen capture as raw RGB bytes via mss (SHM). ~1-5ms."""
        if not hasattr(self, "_sct") or self._sct is None:
            try:
                import mss
                self._sct = mss.mss(display=self.display)
            except Exception:
                self._sct = None
        if self._sct is not None:
            try:
                mon = self._sct.monitors[0]
                raw = self._sct.grab(mon)
                return bytes(raw.rgb), raw.width, raw.height
            except Exception:
                pass
        return b"", 0, 0

    def screenshot(self) -> bytes:
        """Capture the virtual display as JPEG bytes. Uses mss (fast) with
        subprocess fallback (slow)."""
        # Fast path: mss + JPEG in-process.
        rgb, w, h = self.screenshot_raw()
        if rgb and w > 0 and h > 0:
            try:
                from PIL import Image
                img = Image.frombytes("RGB", (w, h), rgb)
                buf = io.BytesIO()
                img.save(buf, format="JPEG", quality=80)
                return buf.getvalue()
            except Exception:
                pass

        # Slow fallback: subprocess pipeline.
        try:
            xwd = subprocess.run(
                ["xwd", "-root", "-display", self.display, "-silent"],
                capture_output=True, timeout=5,
            )
            if xwd.returncode == 0 and xwd.stdout:
                convert = subprocess.run(
                    ["convert", "xwd:-", "jpeg:-"],
                    input=xwd.stdout, capture_output=True, timeout=5,
                )
                if convert.returncode == 0 and convert.stdout:
                    return convert.stdout
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass

        raise RuntimeError("Cannot capture screenshot — install python-mss or xwd+imagemagick")

    def _get_xdisplay(self):
        """Get or create a python-xlib Display connection."""
        if not hasattr(self, "_xdisplay") or self._xdisplay is None:
            try:
                from Xlib import display as xdisplay
                self._xdisplay = xdisplay.Display(self.display)
            except ImportError:
                self._xdisplay = None
                print("[plugin_ws] python-xlib not installed, trying xdotool fallback", flush=True)
            except Exception as e:
                self._xdisplay = None
                print(f"[plugin_ws] Xlib Display({self.display}) failed: {e}", flush=True)
        return self._xdisplay

    def send_mouse(self, x: int, y: int, action: str, button: int = 1) -> None:
        """Forward a mouse event to the virtual display."""
        d = self._get_xdisplay()
        if d is not None:
            try:
                from Xlib import X
                from Xlib.ext import xtest
                # Use XTest fake_input for MotionNotify — this generates
                # real X events that applications (like xeyes) respond to,
                # unlike warp_pointer which may not on Xvfb.
                if action in ("move", "down"):
                    xtest.fake_input(d, X.MotionNotify, x=x, y=y)
                    d.sync()
                if action == "down":
                    xtest.fake_input(d, X.ButtonPress, button + 1)
                    d.sync()
                elif action == "up":
                    xtest.fake_input(d, X.ButtonRelease, button + 1)
                    d.sync()
                return
            except Exception as e:
                print(f"[plugin_ws] Xlib mouse failed: {e}", flush=True)

        # Fallback: xdotool
        env = self.env()
        try:
            if action == "move":
                subprocess.run(["xdotool", "mousemove", str(x), str(y)],
                               env=env, timeout=2, capture_output=True)
            elif action == "down":
                subprocess.run(["xdotool", "mousemove", str(x), str(y)],
                               env=env, timeout=2, capture_output=True)
                subprocess.run(["xdotool", "mousedown", str(button + 1)],
                               env=env, timeout=2, capture_output=True)
            elif action == "up":
                subprocess.run(["xdotool", "mouseup", str(button + 1)],
                               env=env, timeout=2, capture_output=True)
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass

    def send_key(self, key: str, action: str) -> None:
        """Forward a key event via xdotool."""
        env = self.env()
        try:
            if action == "down":
                subprocess.run(["xdotool", "keydown", key],
                               env=env, timeout=2, capture_output=True)
            elif action == "up":
                subprocess.run(["xdotool", "keyup", key],
                               env=env, timeout=2, capture_output=True)
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass

    def kill(self) -> None:
        """Shut down the app and Xvfb."""
        if self.app_proc is not None:
            try:
                self.app_proc.kill()
                self.app_proc.wait(timeout=5)
            except Exception:
                pass
        if self.xvfb_proc is not None:
            try:
                self.xvfb_proc.kill()
                self.xvfb_proc.wait(timeout=5)
            except Exception:
                pass


async def _send_frame(websocket: WebSocket, frame_bytes: bytes, mime: str = "image/jpeg") -> None:
    """Send a frame to the client."""
    await websocket.send_json({"type": "frame", "mime": mime})
    await websocket.send_bytes(frame_bytes)


async def _handle_server_plugin(
    websocket: WebSocket, plugin_instance: Any, msg: dict,
) -> None:
    """Handle a message for a ServerPlugin (render-on-demand)."""
    msg_type = msg.get("type")

    if msg_type == "mouse":
        plugin_instance.on_mouse(msg)
        if getattr(plugin_instance, "_needs_rerender", False):
            plugin_instance._needs_rerender = False
            frame = plugin_instance.render(
                plugin_instance._last_data,
                plugin_instance._last_metadata,
                plugin_instance._last_step,
            )
            if isinstance(frame, (bytes, bytearray)):
                await _send_frame(websocket, frame)

    elif msg_type == "key":
        plugin_instance.on_key(msg)
        if getattr(plugin_instance, "_needs_rerender", False):
            plugin_instance._needs_rerender = False
            frame = plugin_instance.render(
                plugin_instance._last_data,
                plugin_instance._last_metadata,
                plugin_instance._last_step,
            )
            if isinstance(frame, (bytes, bytearray)):
                await _send_frame(websocket, frame)


async def _handle_window_plugin(
    websocket: WebSocket, xvfb: _XvfbSession, msg: dict,
) -> None:
    """Handle a message for a WindowPlugin (Xvfb capture)."""
    msg_type = msg.get("type")

    if msg_type == "mouse":
        x, y, action = msg.get("x", 0), msg.get("y", 0), msg.get("action", "move")
        xvfb.send_mouse(x, y, action, msg.get("button", 0))
        # No per-event screenshot — the periodic frame stream handles updates.

    elif msg_type == "key":
        xvfb.send_key(msg.get("key", ""), msg.get("action", "down"))
        # No per-event screenshot — periodic stream handles updates.


@router.websocket("/ws/plugin/{run_id}/{metric_name}")
async def plugin_ws(
    websocket: WebSocket,
    run_id: str,
    metric_name: str,
) -> None:
    await websocket.accept()
    print(f"[plugin_ws] Connected: {run_id}/{metric_name}", flush=True)
    blobs = get_blobs(websocket)

    plugin_instance: Any = None
    xvfb_session: _XvfbSession | None = None
    plugin_lang: str = "server"
    frame_task: asyncio.Task | None = None
    rtc_pc: Any = None  # RTCPeerConnection for WebRTC streaming
    use_webrtc: bool = False

    try:
        while True:
            try:
                msg = await websocket.receive_json()
            except Exception as recv_err:
                print(f"[plugin_ws] receive error: {recv_err}", flush=True)
                break
            msg_type = msg.get("type")
            print(f"[plugin_ws] {run_id}/{metric_name} Received: type={msg_type}", flush=True)

            if msg_type == "render":
                artifact_hash = msg.get("artifact_hash")
                metadata = msg.get("metadata", {})
                step = msg.get("step", 0)
                plugin_hash = metadata.get("plugin_hash")
                plugin_lang = metadata.get("plugin_lang", "server")
                print(f"[plugin_ws] Render: lang={plugin_lang}, hash={artifact_hash[:12] if artifact_hash else 'None'}...", flush=True)

                if not artifact_hash or not plugin_hash:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Missing artifact_hash or plugin_hash",
                    })
                    continue

                try:
                    plugin_data, _ = blobs.get(plugin_hash)
                    plugin_source = plugin_data.decode("utf-8")
                    data_bytes, _ = blobs.get(artifact_hash)
                    # Strip the "cairn-plugin:...\n" dedup header.
                    if data_bytes.startswith(b"cairn-plugin:"):
                        nl = data_bytes.find(b"\n")
                        if nl > 0:
                            data_bytes = data_bytes[nl + 1:]

                    plugin_cls = _reconstruct_plugin_class(plugin_source)
                    if plugin_cls is None:
                        await websocket.send_json({
                            "type": "error",
                            "message": "No plugin subclass found in source",
                        })
                        continue

                    if plugin_lang == "window":
                        # --- WindowPlugin: launch Xvfb + app ---
                        print(f"[plugin_ws] Starting WindowPlugin: {plugin_cls.__name__}", flush=True)
                        if xvfb_session:
                            xvfb_session.kill()

                        width = getattr(plugin_cls, "width", 800)
                        height = getattr(plugin_cls, "height", 600)
                        depth = getattr(plugin_cls, "depth", 24)
                        fps = getattr(plugin_cls, "fps", 15)

                        xvfb_session = _XvfbSession(width, height, depth)
                        plugin_instance = plugin_cls()

                        # Build env with DISPLAY pointing to Xvfb.
                        launch_env = xvfb_session.env()
                        use_gpu = getattr(plugin_cls, "gpu", False)
                        if use_gpu and shutil.which("vglrun"):
                            launch_env["VGL_DISPLAY"] = ":0"
                            print(f"[plugin_ws] VirtualGL enabled (vglrun)", flush=True)
                        # Store env on the instance so launch() can use it.
                        plugin_instance._cairn_env = launch_env
                        print(f"[plugin_ws] Launching with DISPLAY={launch_env.get('DISPLAY')}, has _cairn_env={hasattr(plugin_instance, '_cairn_env')}", flush=True)
                        print(f"[plugin_ws] WAYLAND_DISPLAY in env: {'WAYLAND_DISPLAY' in launch_env}", flush=True)
                        xvfb_session.app_proc = plugin_instance.launch(
                            data_bytes, metadata, step,
                        )
                        print(f"[plugin_ws] App PID: {xvfb_session.app_proc.pid if xvfb_session.app_proc else 'None'}", flush=True)

                        # Wait for app to start, then send first frame.
                        print(f"[plugin_ws] Xvfb on display {xvfb_session.display}, waiting for app...", flush=True)
                        await asyncio.sleep(1.0)
                        try:
                            frame = xvfb_session.screenshot()
                            print(f"[plugin_ws] First frame: {len(frame)} bytes", flush=True)
                            await _send_frame(websocket, frame)
                        except Exception as exc:
                            await websocket.send_json({
                                "type": "error",
                                "message": f"Screenshot failed: {exc}",
                            })

                        # Start periodic frame streaming.
                        async def _stream_frames():
                            while True:
                                await asyncio.sleep(1.0 / fps)
                                try:
                                    frame = xvfb_session.screenshot()
                                    await _send_frame(websocket, frame)
                                except Exception:
                                    break

                        if frame_task:
                            frame_task.cancel()
                        frame_task = asyncio.create_task(_stream_frames())

                    else:
                        # --- ServerPlugin: render on demand ---
                        plugin_instance = plugin_cls()
                        plugin_instance._last_data = data_bytes
                        plugin_instance._last_metadata = metadata
                        plugin_instance._last_step = step
                        plugin_instance._needs_rerender = False

                        frame = plugin_instance.render(data_bytes, metadata, step)
                        if isinstance(frame, (bytes, bytearray)):
                            await _send_frame(websocket, frame)
                        else:
                            await websocket.send_json({
                                "type": "error",
                                "message": f"render() must return bytes, got {type(frame).__name__}",
                            })

                except Exception as exc:
                    log.exception("Plugin render error for %s/%s", run_id, metric_name)
                    await websocket.send_json({"type": "error", "message": str(exc)})

            elif msg_type in ("mouse", "key"):
                try:
                    if plugin_lang == "window" and xvfb_session:
                        await _handle_window_plugin(websocket, xvfb_session, msg)
                    elif plugin_instance is not None:
                        await _handle_server_plugin(websocket, plugin_instance, msg)
                except Exception as exc:
                    log.debug("Event handler error: %s", exc)

            elif msg_type == "webrtc_offer" and xvfb_session:
                # WebRTC signaling: client sends offer, we reply with answer.
                try:
                    from .plugin_webrtc import setup_webrtc, handle_webrtc_offer, cleanup_webrtc
                    if rtc_pc is not None:
                        await cleanup_webrtc(rtc_pc)
                    # Keep the JPEG frame stream running as fallback.
                    fps = getattr(plugin_instance, "fps", 30) if plugin_instance else 30
                    rtc_pc, _track = await setup_webrtc(xvfb_session, fps=fps)
                    answer_sdp = await handle_webrtc_offer(rtc_pc, msg["sdp"])
                    await websocket.send_json({"type": "webrtc_answer", "sdp": answer_sdp})
                    use_webrtc = True
                    print(f"[plugin_ws] WebRTC established for {metric_name}", flush=True)
                except Exception as exc:
                    log.exception("WebRTC setup failed")
                    await websocket.send_json({
                        "type": "webrtc_failed",
                        "message": str(exc),
                    })

            elif msg_type == "ice_candidate" and rtc_pc is not None:
                # ICE candidate from client (usually not needed with aiortc).
                pass

    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("Plugin WebSocket error for %s/%s", run_id, metric_name)
    finally:
        if frame_task:
            frame_task.cancel()
        if rtc_pc is not None:
            try:
                from .plugin_webrtc import cleanup_webrtc
                asyncio.get_event_loop().run_until_complete(cleanup_webrtc(rtc_pc))
            except Exception:
                pass
        if xvfb_session:
            xvfb_session.kill()
