# cairn-requires: numpy, plotly
"""
Cairn Python plugin: Interactive 3D surface plot using Plotly.

Expects artifact data as a flat Float32Array with metadata:
  { "rows": N, "cols": M, "x_label": "x", "y_label": "y", "z_label": "loss" }

Returns interactive 3D HTML (drag to orbit, scroll to zoom, hover for values).
"""


def render(data, metadata, step, run_id, metric_name):
    import numpy as np
    import plotly.graph_objects as go

    rows = metadata.get("rows", 1) if isinstance(metadata, dict) else 1
    cols = metadata.get("cols", 1) if isinstance(metadata, dict) else 1
    values = np.frombuffer(bytes(data), dtype=np.float32).reshape(rows, cols)

    x_label = metadata.get("x_label", "X") if isinstance(metadata, dict) else "X"
    y_label = metadata.get("y_label", "Y") if isinstance(metadata, dict) else "Y"
    z_label = metadata.get("z_label", "Z") if isinstance(metadata, dict) else "Z"

    fig = go.Figure(data=[go.Surface(
        z=values,
        colorscale="Viridis",
        opacity=0.9,
    )])
    fig.update_layout(
        title=dict(text=f"{metric_name} — step {step}", font=dict(size=12, color="#c9d1d9")),
        paper_bgcolor="#0d1117",
        scene=dict(
            xaxis=dict(title=x_label, backgroundcolor="#161b22", gridcolor="#30363d", color="#8b949e"),
            yaxis=dict(title=y_label, backgroundcolor="#161b22", gridcolor="#30363d", color="#8b949e"),
            zaxis=dict(title=z_label, backgroundcolor="#161b22", gridcolor="#30363d", color="#8b949e"),
        ),
        font=dict(color="#8b949e", size=10),
        margin=dict(l=0, r=0, t=40, b=0),
    )
    return fig.to_html(include_plotlyjs="cdn", full_html=False)
