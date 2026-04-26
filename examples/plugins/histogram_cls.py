"""Class-based Python plugin: interactive histogram via Plotly."""

from cairn import PythonPlugin


class Histogram(PythonPlugin):
    """Interactive distribution histogram using Plotly."""

    name = "histogram"
    requires = ["numpy", "plotly"]

    def render(self, data, metadata, step):
        import numpy as np
        import plotly.graph_objects as go

        values = np.frombuffer(bytes(data), dtype=np.float32)
        bins = metadata.get("bins", 30)
        label = metadata.get("label", "distribution")

        fig = go.Figure(data=[go.Histogram(x=values, nbinsx=bins, marker_color="#0969da")])
        fig.update_layout(
            title=dict(text=f"{label} — step {step}", font=dict(size=12, color="#c9d1d9")),
            paper_bgcolor="#0d1117",
            plot_bgcolor="#161b22",
            font=dict(color="#8b949e", size=10),
            xaxis=dict(title="Value", gridcolor="#30363d"),
            yaxis=dict(title="Count", gridcolor="#30363d"),
            margin=dict(l=50, r=20, t=40, b=40),
            annotations=[dict(
                text=f"n={len(values)}  mean={values.mean():.3f}  std={values.std():.3f}",
                xref="paper", yref="paper", x=0.98, y=0.95,
                showarrow=False, font=dict(size=9, color="#8b949e"),
                bgcolor="#0d1117", bordercolor="#30363d", borderpad=3,
            )],
        )
        return fig.to_html(include_plotlyjs=False, full_html=False)
