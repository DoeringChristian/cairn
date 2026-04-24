# cairn-requires: numpy, matplotlib
"""
Cairn Python plugin: Distribution histogram using matplotlib.

Expects artifact data as a flat Float32Array with metadata:
  { "label": "optional title", "bins": 30 }

Renders a histogram as SVG via matplotlib.
"""


def render(data, metadata, step, run_id, metric_name):
    import io

    import matplotlib.pyplot as plt
    import numpy as np

    values = np.frombuffer(bytes(data), dtype=np.float32)
    bins = metadata.get("bins", 30) if isinstance(metadata, dict) else 30
    label = metadata.get("label", metric_name) if isinstance(metadata, dict) else metric_name

    fig, ax = plt.subplots(figsize=(5, 3))
    fig.patch.set_facecolor("none")
    ax.set_facecolor("#161b22")

    ax.hist(values, bins=bins, color="#0969da", edgecolor="#30363d", alpha=0.9)
    ax.set_title(f"{label}  —  step {step}", color="#c9d1d9", fontsize=10)
    ax.tick_params(colors="#8b949e", labelsize=8)
    for spine in ax.spines.values():
        spine.set_color("#30363d")
    ax.set_xlabel("Value", color="#8b949e", fontsize=9)
    ax.set_ylabel("Count", color="#8b949e", fontsize=9)

    # Stats annotation.
    stats = f"n={len(values)}  mean={values.mean():.3f}  std={values.std():.3f}"
    ax.text(
        0.98, 0.95, stats,
        transform=ax.transAxes, ha="right", va="top",
        fontsize=7, color="#8b949e",
        bbox=dict(boxstyle="round,pad=0.3", facecolor="#0d1117", edgecolor="#30363d"),
    )

    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="svg", transparent=True)
    plt.close(fig)
    return buf.getvalue().decode("utf-8")
