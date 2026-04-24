# cairn-requires: numpy, plotly
"""
Cairn Python plugin: Interactive confusion matrix using Plotly.

Expects artifact data as a flat Float32Array with metadata:
  { "rows": N, "cols": N, "labels": ["class0", "class1", ...] }

Returns interactive heatmap HTML (hover for values, zoom, pan).
"""


def render(data, metadata, step, run_id, metric_name):
    import numpy as np
    import plotly.graph_objects as go

    rows = metadata.get("rows", 1) if isinstance(metadata, dict) else 1
    cols = metadata.get("cols", 1) if isinstance(metadata, dict) else 1
    labels = metadata.get("labels", []) if isinstance(metadata, dict) else []
    values = np.frombuffer(bytes(data), dtype=np.float32).reshape(rows, cols)

    if not labels:
        labels = [str(i) for i in range(max(rows, cols))]

    # Annotate cells with values.
    annotations = []
    for i in range(rows):
        for j in range(cols):
            v = values[i, j]
            annotations.append(dict(
                x=labels[j] if j < len(labels) else str(j),
                y=labels[i] if i < len(labels) else str(i),
                text=f"{v:.0f}",
                font=dict(color="white" if v < values.max() * 0.5 else "black", size=11),
                showarrow=False,
            ))

    fig = go.Figure(data=go.Heatmap(
        z=values,
        x=labels[:cols],
        y=labels[:rows],
        colorscale="Blues",
        showscale=True,
    ))
    fig.update_layout(
        title=dict(text=f"Confusion Matrix — step {step}", font=dict(size=12, color="#c9d1d9")),
        paper_bgcolor="#0d1117",
        plot_bgcolor="#161b22",
        font=dict(color="#8b949e", size=10),
        xaxis=dict(title="Predicted", side="bottom"),
        yaxis=dict(title="Actual", autorange="reversed"),
        annotations=annotations,
        margin=dict(l=60, r=20, t=40, b=50),
    )
    return fig.to_html(include_plotlyjs=False, full_html=False)
