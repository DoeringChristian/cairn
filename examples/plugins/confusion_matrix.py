# cairn-requires: numpy, matplotlib
"""
Cairn Python plugin: Confusion matrix visualization using matplotlib.

Expects artifact data as a flat Float32Array with metadata:
  { "rows": N, "cols": N, "labels": ["class0", "class1", ...] }

Renders an annotated confusion matrix heatmap as SVG.
"""


def render(data, metadata, step, run_id, metric_name):
    import io

    import matplotlib.pyplot as plt
    import numpy as np

    rows = metadata.get("rows", 1) if isinstance(metadata, dict) else 1
    cols = metadata.get("cols", 1) if isinstance(metadata, dict) else 1
    labels = metadata.get("labels", []) if isinstance(metadata, dict) else []
    values = np.frombuffer(bytes(data), dtype=np.float32).reshape(rows, cols)

    fig, ax = plt.subplots(figsize=(max(3, cols * 0.8), max(3, rows * 0.8)))
    fig.patch.set_facecolor("none")
    ax.set_facecolor("#161b22")

    im = ax.imshow(values, cmap="Blues", aspect="auto")

    # Annotate cells.
    for i in range(rows):
        for j in range(cols):
            v = values[i, j]
            color = "white" if v < values.max() * 0.5 else "black"
            ax.text(j, i, f"{v:.0f}", ha="center", va="center",
                    fontsize=9, color=color)

    # Axis labels.
    if labels:
        ax.set_xticks(range(cols))
        ax.set_xticklabels(labels[:cols], rotation=45, ha="right", fontsize=8, color="#c9d1d9")
        ax.set_yticks(range(rows))
        ax.set_yticklabels(labels[:rows], fontsize=8, color="#c9d1d9")
    else:
        ax.tick_params(colors="#8b949e", labelsize=8)

    ax.set_xlabel("Predicted", color="#8b949e", fontsize=9)
    ax.set_ylabel("Actual", color="#8b949e", fontsize=9)
    ax.set_title(f"Confusion Matrix  —  step {step}", color="#c9d1d9", fontsize=10)

    for spine in ax.spines.values():
        spine.set_color("#30363d")

    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="svg", transparent=True)
    plt.close(fig)
    return buf.getvalue().decode("utf-8")
