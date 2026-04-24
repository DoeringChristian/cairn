# cairn-requires: numpy, matplotlib
"""
Cairn Python plugin: 3D surface plot using matplotlib.

Expects artifact data as a flat Float32Array with metadata:
  { "rows": N, "cols": M, "x_label": "x", "y_label": "y", "z_label": "loss" }

Renders a 3D surface as SVG via matplotlib's mplot3d.
"""


def render(data, metadata, step, run_id, metric_name):
    import io

    import matplotlib.pyplot as plt
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

    fig = plt.figure(figsize=(6, 4))
    fig.patch.set_facecolor("none")
    ax = fig.add_subplot(111, projection="3d")
    ax.set_facecolor("#161b22")

    surf = ax.plot_surface(
        X, Y, values,
        cmap="viridis", edgecolor="#30363d", linewidth=0.3, alpha=0.9,
    )

    ax.set_xlabel(x_label, color="#8b949e", fontsize=8, labelpad=5)
    ax.set_ylabel(y_label, color="#8b949e", fontsize=8, labelpad=5)
    ax.set_zlabel(z_label, color="#8b949e", fontsize=8, labelpad=5)
    ax.set_title(f"{metric_name}  —  step {step}", color="#c9d1d9", fontsize=10, pad=10)
    ax.tick_params(colors="#8b949e", labelsize=7)

    # Dark pane colors.
    ax.xaxis.pane.set_facecolor("#0d1117")
    ax.yaxis.pane.set_facecolor("#0d1117")
    ax.zaxis.pane.set_facecolor("#0d1117")
    ax.xaxis.pane.set_edgecolor("#30363d")
    ax.yaxis.pane.set_edgecolor("#30363d")
    ax.zaxis.pane.set_edgecolor("#30363d")

    fig.colorbar(surf, shrink=0.5, aspect=10, pad=0.1)
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="svg", transparent=True)
    plt.close(fig)
    return buf.getvalue().decode("utf-8")
