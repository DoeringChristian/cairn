"""Plugin base classes for custom viewer plugins.

Four plugin types are supported:

- **JSPlugin** — JavaScript code runs in a sandboxed iframe in the browser.
  The user sets the ``js`` class attribute with inline source code.

- **PythonPlugin** — Python code runs in Pyodide in the browser. The user
  overrides ``render()`` which can return HTML or manipulate the DOM directly
  (including WebGL/WebGPU via ``from js import document``).

- **ServerPlugin** — Python code runs on the Cairn server. ``render()``
  returns PNG/JPEG bytes which are streamed to the client via WebSocket.
  ``on_mouse()`` / ``on_key()`` handle input from the client.

- **WindowPlugin** — Launches a GUI application on the server inside a
  virtual display (Xvfb). The window is captured and streamed to the
  client. Works on both X11 and Wayland hosts. Mouse/keyboard events
  are forwarded to the virtual display via xdotool.

All four inherit from ``_TypeWrapper`` so they work like ``cairn.Image``::

    class MyVis(JSPlugin):
        name = "my_vis"
        js = "window.cairn.render = function(msg) { ... };"

    run.track(MyVis(data, rows=8, cols=8), name="vis", step=0)
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .wrappers import _TypeWrapper


class _PluginBase(_TypeWrapper):
    """Abstract base for all Cairn plugins.

    Subclasses must set ``name`` as a class attribute. Instantiation wraps
    arbitrary data (bytes, arrays, JSON-serializable objects) just like
    ``cairn.Image(pil_img)`` wraps an image.
    """

    object_type = "plugin"
    name: str = ""

    def __init_subclass__(cls, **kwargs: Any) -> None:
        super().__init_subclass__(**kwargs)
        # Ensure concrete subclasses define a name.
        if cls.name == "" and cls.__name__ not in (
            "JSPlugin",
            "PythonPlugin",
            "ServerPlugin",
            "WindowPlugin",
        ):
            raise TypeError(
                f"Plugin class {cls.__name__} must set a 'name' class attribute."
            )


class JSPlugin(_PluginBase):
    """JavaScript plugin rendered in a sandboxed iframe.

    Set ``js`` with inline source code, or ``js_file`` with a path to
    a ``.js`` file. The JS code must assign ``window.cairn.render``:

    .. code-block:: javascript

        window.cairn.render = function(msg) {
            // msg.data: ArrayBuffer
            // msg.metadata: object
            // msg.step: number
        };
    """

    js: str = ""
    js_file: str | Path | None = None

    def get_source(self) -> str:
        """Return the JavaScript source code."""
        if self.js:
            return self.js
        if self.js_file is not None:
            return Path(self.js_file).read_text(encoding="utf-8")
        raise ValueError(
            f"JSPlugin '{self.name}' must set either 'js' or 'js_file'."
        )


class PythonPlugin(_PluginBase):
    """Python plugin running in Pyodide in the browser.

    Override ``render()`` to process data and return an HTML string, or
    manipulate the DOM directly via Pyodide's ``from js import`` bridge
    (which gives access to WebGL, WebGPU, Canvas, etc.).

    Set ``requires`` to list pip packages that should be installed via
    micropip before the plugin runs.
    """

    requires: list[str] = []

    def render(self, data: bytes, metadata: dict[str, Any], step: int) -> str | None:
        """Process data and return HTML, or manipulate the DOM directly.

        Args:
            data: Raw bytes of the tracked artifact.
            metadata: Dict of custom metadata passed via kwargs.
            step: The current step number.

        Returns:
            An HTML string to inject, or None if the plugin rendered
            directly to the DOM (e.g. via WebGL).
        """
        raise NotImplementedError(
            f"PythonPlugin '{self.name}' must implement render()."
        )


class ServerPlugin(_PluginBase):
    """Server-side plugin with frame streaming via WebSocket.

    Override ``render()`` to produce a rendered frame (PNG/JPEG bytes).
    The frame is streamed to the client over a WebSocket connection.
    Override ``on_mouse()`` / ``on_key()`` to handle client input.
    """

    def render(self, data: bytes, metadata: dict[str, Any], step: int) -> bytes:
        """Produce a rendered frame.

        Args:
            data: Raw bytes of the tracked artifact.
            metadata: Dict of custom metadata.
            step: The current step number.

        Returns:
            PNG or JPEG bytes for the frame.
        """
        raise NotImplementedError(
            f"ServerPlugin '{self.name}' must implement render()."
        )

    def request_rerender(self) -> None:
        """Call from ``on_mouse()`` / ``on_key()`` to trigger a re-render.

        After the event handler returns, the server will call ``render()``
        again with the last data/metadata/step and stream the new frame.
        """
        self._needs_rerender = True

    def on_mouse(self, event: dict[str, Any]) -> None:
        """Handle a mouse event from the client.

        ``event`` keys: ``x``, ``y``, ``button``, ``action`` (move/down/up).
        Call ``self.request_rerender()`` to trigger a new frame.
        """

    def on_key(self, event: dict[str, Any]) -> None:
        """Handle a keyboard event from the client.

        ``event`` keys: ``key``, ``action`` (down/up).
        Call ``self.request_rerender()`` to trigger a new frame.
        """


class WindowPlugin(_PluginBase):
    """Captures a GUI application running in a virtual display.

    Override ``launch()`` to start your application. It runs inside Xvfb
    (a virtual X server), so it works on both X11 and Wayland hosts —
    no physical display required.

    Set ``gpu = True`` to use VirtualGL (``vglrun``) for hardware-
    accelerated OpenGL rendering. Without it, OpenGL apps run with
    software rendering (Mesa llvmpipe) which is slow and CPU-heavy.

    The window is screenshotted and streamed to the client. Mouse and
    keyboard events from the browser are forwarded to the virtual display.

    Requires system packages: ``xvfb``, and optionally ``virtualgl``
    for GPU acceleration.

    Example::

        class PolyscopeViewer(WindowPlugin):
            name = "polyscope"
            width = 800
            height = 600
            gpu = True  # use VirtualGL for GPU-accelerated OpenGL

            def launch(self, data, metadata, step):
                import subprocess
                return subprocess.Popen(["python", "my_polyscope_script.py"])
    """

    width: int = 800
    height: int = 600
    depth: int = 24
    gpu: bool = False
    fps: int = 15

    def launch(
        self, data: bytes, metadata: dict[str, Any], step: int,
    ) -> Any:
        """Start the GUI application. Return a ``subprocess.Popen`` object.

        The ``DISPLAY`` environment variable is already set to the virtual
        Xvfb display. Just launch your process normally.

        Args:
            data: Raw bytes of the tracked artifact.
            metadata: Dict of custom metadata.
            step: The current step number.

        Returns:
            A ``subprocess.Popen`` instance (or any object with a ``kill()``
            method for cleanup).
        """
        raise NotImplementedError(
            f"WindowPlugin '{self.name}' must implement launch()."
        )
