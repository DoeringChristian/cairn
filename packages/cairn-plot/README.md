# cairn-plot

Standalone, Plotly-shaped plotting library. Compose plots from plain in-memory
data and render them **self-contained** — one offline HTML file, no server and
no CDN.

```python
import numpy as np
import cairn_plot as cp

report = (
    cp.report("My report")
    .md("# Results")
    .add(cp.Line({"loss": np.random.rand(50).cumsum()}))
    .add(cp.Image(np.random.rand(64, 64)))
)
report.save("report.html")
```

The `media` extra (`pip install cairn-plot[media]`) adds Plotly (for the
`cp.figure` passthrough and the `confusion_matrix` / `roc_curve` / `pr_curve`
recipes) and Pillow (for raw-image baking).

`cairn-plot` is the rendering core of [`cairn-track`](https://github.com/anthropics/cairn);
the full experiment tracker layers `run[tag]` integration on the same surface
via `import cairn.plot as cp`.
