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

    # Monkey-patch: re-attach mouse event listeners that matplotlib-pyodide
    # disabled in browser_backend.py v0.2.3.
    _patch_matplotlib_events(fig)


def _patch_matplotlib_events(fig):
    """Re-attach mouse event listeners to the matplotlib canvas."""
    try:
        from js import document
        from pyodide.ffi import create_proxy

        canvas = fig.canvas

        # Find the rubberband canvas element (matplotlib creates two canvases:
        # one for rendering, one transparent overlay for events).
        canvas_el = None
        for el in document.querySelectorAll("canvas"):
            # The rubberband canvas is the one on top (higher z-index or later in DOM).
            canvas_el = el

        if canvas_el is None:
            return

        def add_event(el, event_name, handler):
            proxy = create_proxy(handler)
            el.addEventListener(event_name, proxy)

        if hasattr(canvas, "onmousemove"):
            add_event(canvas_el, "mousemove", canvas.onmousemove)
        if hasattr(canvas, "onmousedown"):
            add_event(canvas_el, "mousedown", canvas.onmousedown)
        if hasattr(canvas, "onmouseup"):
            add_event(canvas_el, "mouseup", canvas.onmouseup)
        if hasattr(canvas, "onscroll"):
            add_event(canvas_el, "wheel", canvas.onscroll)
        if hasattr(canvas, "onmouseenter"):
            add_event(canvas_el, "mouseenter", canvas.onmouseenter)
        if hasattr(canvas, "onmouseleave"):
            add_event(canvas_el, "mouseleave", canvas.onmouseleave)
    except Exception as e:
        print(f"[cairn] Could not patch matplotlib events: {e}")
