# cairn-requires: numpy, matplotlib
"""
Cairn Python plugin: Interactive 3D surface using matplotlib + webagg.

Pyodide v0.28+ ships a patched webagg backend that renders interactive
matplotlib figures directly in the browser (orbit, zoom, pan).
No matplotlib_pyodide needed — just use the default backend.
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
    matplotlib.use("webagg")
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
