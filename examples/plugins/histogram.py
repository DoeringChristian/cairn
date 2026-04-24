# cairn-requires: numpy, matplotlib
"""
Cairn Python plugin: Interactive distribution histogram.

Expects artifact data as a flat Float32Array with metadata:
  { "label": "optional title", "bins": 30 }

matplotlib's wasm_backend renders an interactive figure directly in the
browser (pan, zoom, resize) — no static export needed.
"""


def render(data, metadata, step, run_id, metric_name):
    import matplotlib.pyplot as plt
    import numpy as np

    values = np.frombuffer(bytes(data), dtype=np.float32)
    bins = metadata.get("bins", 30) if isinstance(metadata, dict) else 30
    label = metadata.get("label", metric_name) if isinstance(metadata, dict) else metric_name

    plt.close("all")
    fig, ax = plt.subplots(figsize=(5, 3))
    fig.patch.set_facecolor("#0d1117")
    ax.set_facecolor("#161b22")

    ax.hist(values, bins=bins, color="#0969da", edgecolor="#30363d", alpha=0.9)
    ax.set_title(f"{label}  \u2014  step {step}", color="#c9d1d9", fontsize=10)
    ax.tick_params(colors="#8b949e", labelsize=8)
    for spine in ax.spines.values():
        spine.set_color("#30363d")
    ax.set_xlabel("Value", color="#8b949e", fontsize=9)
    ax.set_ylabel("Count", color="#8b949e", fontsize=9)

    stats = f"n={len(values)}  mean={values.mean():.3f}  std={values.std():.3f}"
    ax.text(
        0.98, 0.95, stats,
        transform=ax.transAxes, ha="right", va="top",
        fontsize=7, color="#8b949e",
        bbox=dict(boxstyle="round,pad=0.3", facecolor="#0d1117", edgecolor="#30363d"),
    )

    fig.tight_layout()
    plt.show()
