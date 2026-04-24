# cairn-requires: numpy, matplotlib
"""
Cairn Python plugin: Interactive 3D surface plot using matplotlib.

Expects artifact data as a flat Float32Array with metadata:
  { "rows": N, "cols": M, "x_label": "x", "y_label": "y", "z_label": "loss" }

Uses matplotlib's wasm_backend with monkey-patched event listeners to
restore interactivity (drag to orbit 3D, scroll to zoom).
"""


def render(data, metadata, step, run_id, metric_name):
    import numpy as np

    rows = metadata.get("rows", 1) if isinstance(metadata, dict) else 1
    cols = metadata.get("cols", 1) if isinstance(metadata, dict) else 1
    values = np.frombuffer(bytes(data), dtype=np.float32).reshape(rows, cols)

    x_label = metadata.get("x_label", "X") if isinstance(metadata, dict) else "X"
    y_label = metadata.get("y_label", "Y") if isinstance(metadata, dict) else "Y"
    z_label = metadata.get("z_label", "Z") if isinstance(metadata, dict) else "Z"

    X = np.arange(cols)
    Y = np.arange(rows)
    X, Y = np.meshgrid(X, Y)

    import matplotlib
    matplotlib.use("module://matplotlib_pyodide.wasm_backend")
    import matplotlib.pyplot as plt

    plt.close("all")
    fig = plt.figure(figsize=(6, 4))
    fig.patch.set_facecolor("#0d1117")
    ax = fig.add_subplot(111, projection="3d")
    ax.set_facecolor("#161b22")

    ax.plot_surface(
        X, Y, values,
        cmap="viridis", edgecolor="#30363d", linewidth=0.3, alpha=0.9,
    )

    ax.set_xlabel(x_label, color="#8b949e", fontsize=8, labelpad=5)
    ax.set_ylabel(y_label, color="#8b949e", fontsize=8, labelpad=5)
    ax.set_zlabel(z_label, color="#8b949e", fontsize=8, labelpad=5)
    ax.set_title(f"{metric_name}  \u2014  step {step}", color="#c9d1d9", fontsize=10, pad=10)
    ax.tick_params(colors="#8b949e", labelsize=7)

    ax.xaxis.pane.set_facecolor("#0d1117")
    ax.yaxis.pane.set_facecolor("#0d1117")
    ax.zaxis.pane.set_facecolor("#0d1117")
    ax.xaxis.pane.set_edgecolor("#30363d")
    ax.yaxis.pane.set_edgecolor("#30363d")
    ax.zaxis.pane.set_edgecolor("#30363d")

    fig.tight_layout()
    plt.show()

    # Monkey-patch: re-attach mouse event listeners using the correct
    # matplotlib 3.8+ event API (callbacks.process instead of removed methods).
    _patch_matplotlib_events(fig)


def _patch_matplotlib_events(fig):
    """Re-attach mouse event listeners to the matplotlib canvas using the 3.8+ API."""
    try:
        from js import document
        from matplotlib.backend_bases import MouseEvent
        from pyodide.ffi import create_proxy

        canvas = fig.canvas

        # Find the last canvas element (matplotlib's rubberband overlay).
        canvas_el = None
        for el in document.querySelectorAll("canvas"):
            canvas_el = el
        if canvas_el is None:
            return

        def _convert(event):
            """Convert a JS mouse event to matplotlib coordinates."""
            rect = canvas_el.getBoundingClientRect()
            x = event.clientX - rect.left
            # Flip y — matplotlib uses bottom-left origin.
            y = (rect.bottom - rect.top) - (event.clientY - rect.top)
            # Map to figure coordinates.
            x = x * canvas.figure.dpi / 96
            y = y * canvas.figure.dpi / 96
            return x, y

        def _button(event):
            b = event.button
            if b == 0: return 1  # left
            if b == 1: return 2  # middle
            if b == 2: return 3  # right
            return 1

        def on_move(event):
            x, y = _convert(event)
            me = MouseEvent("motion_notify_event", canvas, x, y, guiEvent=None)
            canvas.callbacks.process("motion_notify_event", me)
            canvas.draw_idle()

        def on_down(event):
            x, y = _convert(event)
            me = MouseEvent("button_press_event", canvas, x, y, button=_button(event), guiEvent=None)
            canvas.callbacks.process("button_press_event", me)
            canvas.draw_idle()

        def on_up(event):
            x, y = _convert(event)
            me = MouseEvent("button_release_event", canvas, x, y, button=_button(event), guiEvent=None)
            canvas.callbacks.process("button_release_event", me)
            canvas.draw_idle()

        def on_scroll(event):
            x, y = _convert(event)
            # Matplotlib expects step: positive = scroll up, negative = scroll down.
            step = -1 if event.deltaY > 0 else 1
            me = MouseEvent("scroll_event", canvas, x, y, step=step, guiEvent=None)
            canvas.callbacks.process("scroll_event", me)
            canvas.draw_idle()
            event.preventDefault()

        canvas_el.addEventListener("mousemove", create_proxy(on_move))
        canvas_el.addEventListener("mousedown", create_proxy(on_down))
        canvas_el.addEventListener("mouseup", create_proxy(on_up))
        canvas_el.addEventListener("wheel", create_proxy(on_scroll))

    except Exception as e:
        print(f"[cairn] Could not patch matplotlib events: {e}")
