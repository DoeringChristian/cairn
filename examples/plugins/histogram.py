# cairn-requires: numpy, plotly
"""
Cairn Python plugin: Interactive distribution histogram using Plotly.

Expects artifact data as a flat Float32Array with metadata:
  { "label": "optional title", "bins": 30 }

Returns self-contained interactive HTML (hover, zoom, pan).
"""


def render(data, metadata, step, run_id, metric_name):
    import numpy as np
    import plotly.graph_objects as go

    values = np.frombuffer(bytes(data), dtype=np.float32)
    bins = metadata.get("bins", 30) if isinstance(metadata, dict) else 30
    label = metadata.get("label", metric_name) if isinstance(metadata, dict) else metric_name

    fig = go.Figure(data=[go.Histogram(x=values, nbinsx=bins, marker_color="#0969da")])
    fig.update_layout(
        title=dict(text=f"{label} — step {step}", font=dict(size=12, color="#c9d1d9")),
        paper_bgcolor="#0d1117",
        plot_bgcolor="#161b22",
        font=dict(color="#8b949e", size=10),
        xaxis=dict(title="Value", gridcolor="#30363d"),
        yaxis=dict(title="Count", gridcolor="#30363d"),
        margin=dict(l=50, r=20, t=40, b=40),
        # Stats annotation
        annotations=[dict(
            text=f"n={len(values)}  mean={values.mean():.3f}  std={values.std():.3f}",
            xref="paper", yref="paper", x=0.98, y=0.95,
            showarrow=False, font=dict(size=9, color="#8b949e"),
            bgcolor="#0d1117", bordercolor="#30363d", borderpad=3,
        )],
    )
    return fig.to_html(include_plotlyjs="cdn", full_html=False)
