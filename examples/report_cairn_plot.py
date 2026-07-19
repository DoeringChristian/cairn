"""cairn.plot — the gallery, rebuilt AS a ``cp.Report`` (the dogfood example).

This is the flagship docs artifact for the LOCAL report system: it takes the
same data generators and every plot type from ``examples/demo_cairn_plot.py``
and assembles them into ONE ``cp.Report`` — narrative markdown sections, a
raw-HTML banner, and ``.add``/``.grid`` of the real ``cairn.plot`` components —
then writes ONE self-contained HTML file. No cairn server, no repo, no CDN: the
report bakes its data inline (LOCAL data mode), inlines the renderer bundle
ONCE, and merges every component's blobs into ONE content-addressed store, so
the emitted page opens fully offline (``open`` the file, or share it).

Where ``demo_cairn_plot.py`` concatenates each component's ``_repr_html_`` into
a hand-rolled page, THIS example proves the ``cp.Report`` builder end-to-end:
``.md`` (rendered markdown headings + prose), ``.html`` (raw markup verbatim),
and ``.add``/``.grid`` (mounted pure-renderer components) interleaved in
insertion order into one portable document.

Usage::

    # plotly + PIL come from the "media" extra; cairn core needs neither.
    uv run --extra media python examples/report_cairn_plot.py
    # → writes /tmp/cairn-plot-report.html and prints the path + section count.

    # or, from the repo root, with the venv python:
    PYTHONPATH=. .venv/bin/python examples/report_cairn_plot.py

    # open it (macOS):  open /tmp/cairn-plot-report.html
    #        (linux):   xdg-open /tmp/cairn-plot-report.html
    uv run --extra media python examples/report_cairn_plot.py --open

    # pick a different output path:
    uv run --extra media python examples/report_cairn_plot.py -o ./report.html
"""

from __future__ import annotations

import argparse
import pathlib
import sys

import numpy as np

import cairn.plot as cp

# Reuse the demo's data generators verbatim. `examples/` has no package
# `__init__`, so a plain module import works when the script is run from the
# repo root (the common case); fall back to loading the sibling file by path so
# the example still runs standalone from any cwd.
try:
    from demo_cairn_plot import (
        _boxes,
        _gradient_image,
        _hdr_image,
        _mesh,
        _sphere_pointcloud,
        _volume,
    )
except ImportError:  # pragma: no cover - path-based fallback for odd cwds
    import importlib.util

    _demo_path = pathlib.Path(__file__).resolve().parent / "demo_cairn_plot.py"
    _spec = importlib.util.spec_from_file_location("_demo_cairn_plot", _demo_path)
    assert _spec and _spec.loader
    _demo = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(_demo)
    _boxes = _demo._boxes
    _gradient_image = _demo._gradient_image
    _hdr_image = _demo._hdr_image
    _mesh = _demo._mesh
    _sphere_pointcloud = _demo._sphere_pointcloud
    _volume = _demo._volume


# A tiny self-contained inline banner (raw HTML) — proves `.html(...)`. No
# webfonts / external assets, so the report stays fully offline.
_BANNER_HTML = """
<div style="margin:0 0 1.5rem;padding:.9rem 1.1rem;border-radius:10px;
     background:linear-gradient(90deg,#4f46e5,#0ea5e9);color:#fff;
     font:600 14px/1.4 system-ui,-apple-system,sans-serif;
     box-shadow:0 1px 4px rgba(0,0,0,.15)">
  <span style="font-size:16px">cairn-plot</span>
  &nbsp;·&nbsp; one pure-renderer library, driven from Python, baked into ONE
  offline HTML file — every plot below is live, no server and no network.
</div>
""".strip()


def build_report() -> cp.Report:
    """Assemble the whole gallery as ONE ``cp.Report`` and return it."""
    rng = np.random.default_rng(0)
    steps = np.arange(40)

    rep = cp.Report(title="cairn-plot — feature report")

    # ── intro: what cairn-plot is (one paragraph) + the raw-HTML banner ──────
    rep.md(
        "cairn-plot (`import cairn.plot as cp`) is ONE pure-renderer plotting "
        "library — the same renderers the cairn web app ships — driven entirely "
        "from Python. Every component below bakes its data **inline** (the LOCAL "
        "data mode) and mounts from a single inlined renderer bundle, so this "
        "whole page is **self-contained**: no cairn server, no repo, no CDN, no "
        "webfonts. This report is itself built with `cp.Report` — the same "
        "`.md` / `.html` / `.add` / `.grid` builders documented in the "
        "[report API spec](docs/superpowers/specs/2026-07-17-cairn-plot-report-api.md) "
        "— which is the point: the gallery is the dogfood."
    )
    rep.html(_BANNER_HTML)

    # ── 2D charts (raw-data primary) ─────────────────────────────────────────
    rep.md(
        "## 2D charts\n\n"
        "The raw-data-primary chart primitives: `cp.Line` / `cp.Scatter` / "
        "`cp.Bar` / `cp.Histogram` / `cp.Heatmap` / `cp.ParallelCoordinates`. "
        "Each takes plain arrays or dicts and renders natively."
    )
    rep.md("### Line — multi-series (loss / val_loss)")
    rep.add(
        cp.Line(
            {
                "loss": np.exp(-steps / 15) + 0.05 * rng.random(40),
                "val_loss": np.exp(-steps / 20) + 0.08 * rng.random(40),
            }
        )
    )
    rep.md(
        "### Scatter — colored by a third value\n\n"
        "Scatter carries a full Plotly-style **toolbar** (box-zoom, pan, "
        "double-click reset) and supports **select / lasso** — drag a rubber-band "
        "or lasso to pick points; the selection is emitted for downstream use."
    )
    rep.add(
        cp.Scatter(
            rng.random(60),
            rng.random(60),
            color=rng.random(60),
            x_label="x",
            y_label="y",
            color_label="score",
        )
    )
    rep.md("### Bar")
    rep.add(
        cp.Bar(
            [3.2, 7.1, 5.5, 2.8],
            labels=["alpha", "beta", "gamma", "delta"],
            value_label="throughput",
        )
    )
    rep.md("### Histogram — binned from raw samples")
    rep.add(cp.Histogram(rng.normal(size=2000), bins=40))
    rep.md("### Heatmap — 2D field with a colormap")
    rep.add(
        cp.Heatmap(
            np.add.outer(np.sin(np.linspace(0, 3, 24)), np.cos(np.linspace(0, 3, 32))),
            colormap="viridis",
        )
    )
    rep.md("### ParallelCoordinates — numeric + categorical axes")
    rep.add(
        cp.ParallelCoordinates(
            [
                {"label": "lr", "values": [1e-3, 3e-3, 1e-2, 3e-2]},
                {"label": "optimizer", "values": ["adam", "sgd", "adam", "adamw"]},
                {"label": "acc", "values": [0.81, 0.74, 0.88, 0.90]},
            ]
        )
    )

    # ── table + figure passthrough ───────────────────────────────────────────
    rep.md(
        "## Tables & Plotly passthrough\n\n"
        "`cp.Table` renders a list-of-dicts as a sortable table; `cp.Figure` is "
        "a **passthrough** for any existing Plotly `Figure` (rendered via the "
        "figure addon), so a codebase already producing Plotly can drop straight "
        "into a cairn-plot report."
    )
    rep.md("### Table — run summary")
    rep.add(
        cp.Table(
            [
                {"run": "a", "acc": 0.88, "loss": 0.31, "note": "baseline"},
                {"run": "b", "acc": 0.91, "loss": 0.27, "note": "tuned"},
                {"run": "c", "acc": 0.86, "loss": 0.35, "note": "ablation"},
            ]
        )
    )
    try:
        import plotly.graph_objects as go

        fig = go.Figure()
        fig.add_trace(
            go.Scatter(x=steps, y=np.cos(steps / 6), mode="lines", name="cos")
        )
        fig.add_trace(
            go.Bar(x=steps[::4], y=rng.random(10), name="samples", opacity=0.4)
        )
        fig.update_layout(title="A Plotly figure, rendered via cp.Figure")
        rep.md("### Figure — Plotly passthrough")
        rep.add(cp.Figure(fig))
    except ImportError:
        rep.md(
            "### Figure — Plotly passthrough\n\n"
            "_(skipped — plotly is not installed; install the `media` extra.)_"
        )

    # ── SDR image + colormap ─────────────────────────────────────────────────
    rep.md(
        "## Images (SDR)\n\n"
        "`cp.Image` bakes an 8-bit array inline and renders it GPU-side. It also "
        "carries display-space controls — **exposure** (brightness ×2^EV), "
        "**gamma** (tone curve), and a **colormap** for single-channel or "
        "false-color views."
    )
    rep.md("### Image — baked inline")
    rep.add(cp.Image(_gradient_image(96, 64)))
    base = _gradient_image(120, 80)
    rep.md(
        "### Image processing — exposure · colormap · gamma sweep\n\n"
        "A `cp.Grid` of the same source under different display adjustments."
    )
    rep.grid(
        [
            [cp.Image(base, exposure=-2.0), cp.Image(base), cp.Image(base, exposure=2.0)],
            [
                cp.Image(base, gamma=0.5),
                cp.Image(base, colormap="viridis"),
                cp.Image(base, gamma=2.2),
            ],
        ]
    )

    # ── HDR image (true float, real tone-mapping) ────────────────────────────
    hdr = _hdr_image()
    rep.md(
        "## HDR images (true float, real tone-mapping)\n\n"
        "Unlike the 8-bit sweep above, these bake the **genuine float array** "
        "(peak ~8.0) and tone-map it CLIENT-SIDE — real HDR. The tonemap grid "
        "shows the four operators side by side (highlight roll-off differs); the "
        "exposure sweep shows how lowering exposure recovers blown-out "
        "highlights."
    )
    rep.md("### Tonemap operators — linear · srgb · reinhard · aces")
    rep.grid(
        [
            [
                cp.Image(hdr, tonemap="linear"),
                cp.Image(hdr, tonemap="srgb"),
                cp.Image(hdr, tonemap="reinhard"),
                cp.Image(hdr, tonemap="aces"),
            ]
        ]
    )
    rep.md("### Exposure sweep — recovering highlights (srgb / aces)")
    rep.grid(
        [
            [
                cp.Image(hdr, tonemap="srgb", exposure=-2.0),
                cp.Image(hdr, tonemap="srgb", exposure=0.0),
                cp.Image(hdr, tonemap="srgb", exposure=2.0),
                cp.Image(hdr, tonemap="aces", exposure=2.0),
            ]
        ]
    )

    # ── compare (split / blend / diff) ───────────────────────────────────────
    img_a = _gradient_image(120, 80)
    img_b = _gradient_image(120, 80, shift=0.18)  # a shifted variant to compare
    rep.md(
        "## Compare — split · blend · diff\n\n"
        "`cp.Compare` puts two images under one exclusive comparison surface. "
        "The four modes: **side** (two panes), **split** (a draggable divider), "
        "**blend** (alpha crossfade), and **diff** (per-pixel error field with a "
        "diverging colormap). Small images additionally show **TEV-style "
        "per-pixel RGB values** when you zoom in far enough (Alt/Ctrl + wheel)."
    )
    small_a = _gradient_image(16, 16)
    small_b = _gradient_image(16, 16, shift=0.25)
    rep.md("### Zoomable split w/ TEV-style pixel values (small image)")
    rep.add(
        cp.Compare(
            cp.Image(small_a), cp.Image(small_b), mode="split", split_position=0.5
        )
    )
    rep.md("### All modes — side · split · blend · diff")
    rep.grid(
        [
            [
                cp.Compare(cp.Image(img_a), cp.Image(img_b), mode="side"),
                cp.Compare(
                    cp.Image(img_a), cp.Image(img_b), mode="split", split_position=0.5
                ),
            ],
            [
                cp.Compare(
                    cp.Image(img_a), cp.Image(img_b), mode="blend", blend_alpha=0.5
                ),
                cp.Compare(
                    cp.Image(img_a),
                    cp.Image(img_b),
                    mode="diff",
                    diff_submode="signed",
                    colormap="red-blue",
                ),
            ],
        ]
    )
    rep.md(
        "### All 6 diff submodes\n\n"
        "Row-major: **signed · absolute · squared** (top), "
        "**relative_signed · relative_absolute · relative_squared** (bottom). "
        "Diverging errors use the red-blue map; magnitude errors use "
        "viridis / red-green."
    )
    rep.grid(
        [
            [
                cp.Compare(
                    cp.Image(img_a), cp.Image(img_b), mode="diff",
                    diff_submode="signed", colormap="red-blue",
                ),
                cp.Compare(
                    cp.Image(img_a), cp.Image(img_b), mode="diff",
                    diff_submode="absolute", colormap="viridis",
                ),
                cp.Compare(
                    cp.Image(img_a), cp.Image(img_b), mode="diff",
                    diff_submode="squared", colormap="viridis",
                ),
            ],
            [
                cp.Compare(
                    cp.Image(img_a), cp.Image(img_b), mode="diff",
                    diff_submode="relative_signed", colormap="red-blue",
                ),
                cp.Compare(
                    cp.Image(img_a), cp.Image(img_b), mode="diff",
                    diff_submode="relative_absolute", colormap="viridis",
                ),
                cp.Compare(
                    cp.Image(img_a), cp.Image(img_b), mode="diff",
                    diff_submode="relative_squared", colormap="red-green",
                ),
            ],
        ]
    )

    # ── synced images + synced charts ────────────────────────────────────────
    rep.md(
        "## Synced viewports\n\n"
        "`cp.Grid(shared=cp.Shared(sync={\"viewport\": True}))` links every leaf "
        "of one KIND into a single live zoom/pan group. For **images**, "
        "Alt/Ctrl + wheel/drag on either pane moves both together. For **2D "
        "charts**, box-zoom / drag / Alt+wheel / double-click on either chart "
        "adopts the same DATA-SPACE window in the other (Plotly matched-axes "
        "style)."
    )
    sync_a = _gradient_image(160, 120)
    sync_b = _gradient_image(160, 120, shift=0.3)
    rep.md("### Synced image controls — zoom/pan linked")
    rep.grid(
        [[cp.Image(sync_a), cp.Image(sync_b)]],
        shared=cp.Shared(sync={"viewport": True}),
    )
    sx = np.linspace(0, 20, 120)
    chart_a = cp.Scatter(
        sx, np.sin(sx) + 0.05 * rng.standard_normal(120),
        x_label="x", y_label="sin(x)",
    )
    chart_b = cp.Scatter(
        sx, np.cos(sx) + 0.05 * rng.standard_normal(120),
        x_label="x", y_label="cos(x)",
    )
    rep.md("### Synced chart viewports — zoom/pan linked")
    rep.grid(
        [[chart_a, chart_b]],
        shared=cp.Shared(sync={"viewport": True}),
    )

    # ── 3D (WebGL): pointcloud / mesh / volume / boxes ───────────────────────
    rep.md(
        "## 3D (WebGL)\n\n"
        "The 3D leaves render in an orbit-controlled WebGL viewport (three.js "
        "addon): `cp.PointCloud`, `cp.Mesh` (per-vertex or per-face colors), "
        "`cp.Volume` (raymarched scalar grid), and `cp.Boxes` (axis-aligned). "
        "Drag to orbit; grids in one report can be camera-synced."
    )
    rep.md("### PointCloud — colored unit sphere (orbit to rotate)")
    rep.add(cp.PointCloud(_sphere_pointcloud(3000), point_size=0.03))
    verts, faces, vals = _mesh()
    rep.md("### Mesh — icosahedron, colored per-vertex by height")
    rep.add(
        cp.Mesh(verts, faces, values=vals, color_mode="values", show_axes=True)
    )
    tetra_v = np.array(
        [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]], dtype=np.float32
    )
    tetra_f = np.array([[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]], dtype=np.int64)
    tetra_face_colors = np.array(
        [[0.90, 0.20, 0.20], [0.20, 0.80, 0.30], [0.25, 0.45, 0.95], [0.95, 0.80, 0.20]],
        dtype=np.float32,
    )
    rep.md("### Mesh — tetrahedron, distinct per-face colors")
    rep.add(cp.Mesh(tetra_v, tetra_f, face_colors=tetra_face_colors, show_axes=True))
    rep.md("### Volume — scalar grid, Gaussian blob (raymarch)")
    rep.add(cp.Volume(_volume(), colormap="viridis", show_axes=True))
    b_mins, b_maxs, b_vals = _boxes()
    rep.md("### Boxes — axis-aligned, colored by value")
    rep.add(cp.Boxes(b_mins, b_maxs, values=b_vals, color_mode="value", show_axes=True))

    # ── composition: nested Grid ─────────────────────────────────────────────
    rep.md(
        "## Composition\n\n"
        "`cp.Grid` composes any leaves into a row/grid layout (here with "
        "per-column widths), and grids nest arbitrarily."
    )
    rep.md("### Grid — 2×2 with per-column widths")
    rep.grid(
        [
            [cp.Line(np.exp(-steps / 12)), cp.Bar([2, 5, 3], labels=["x", "y", "z"])],
            [cp.Image(_gradient_image(80, 60)), cp.Histogram(rng.normal(size=500), bins=20)],
        ],
        col_widths=[0.6, 0.4],
    )

    return rep


def _self_check(rep: cp.Report, html: str) -> None:
    """Fail loudly if the emitted report is not what we claim — the example
    doubles as a smoke test of the LOCAL report system end-to-end."""
    # Every markdown section heading we wrote must be rendered to real HTML.
    for heading in ("<h1>cairn-plot — feature report</h1>", "<h2>2D charts</h2>",
                    "<h2>Images (SDR)</h2>", "<h2>3D (WebGL)</h2>",
                    "<h2>Compare — split · blend · diff</h2>",
                    "<h3>Line — multi-series (loss / val_loss)</h3>"):
        if heading not in html:
            raise SystemExit(f"self-check FAILED: missing rendered heading {heading!r}")
    # The raw-HTML banner must appear verbatim.
    if "one pure-renderer library" not in html:
        raise SystemExit("self-check FAILED: raw-HTML banner missing")
    # One mount div per added component/grid — count must match the block count.
    n_elements = sum(1 for kind, _ in rep.blocks if kind == "element")
    n_mounts = html.count('class="cairn-plot-mount"')
    if n_mounts != n_elements:
        raise SystemExit(
            f"self-check FAILED: {n_mounts} mounts != {n_elements} components"
        )
    # Never a bare render-error <pre>. (We don't assert "no http string" here:
    # the inlined Plotly figure addon legitimately embeds URL string literals in
    # its own minified code — those are code, not resources this report loads.)
    if "could not render this report" in html:
        raise SystemExit("self-check FAILED: report emitted an error placeholder")
    # The renderer bundle must be inlined exactly once (guarded include-once),
    # which is what actually makes the saved file open offline.
    if html.count("if(!window.__cairnPlotBundleLoaded){(function()") != 1:
        raise SystemExit("self-check FAILED: renderer bundle not inlined exactly once")


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Emit the cairn.plot gallery AS a self-contained cp.Report."
    )
    ap.add_argument(
        "-o", "--output", default="/tmp/cairn-plot-report.html",
        help="output HTML path (default: /tmp/cairn-plot-report.html)",
    )
    ap.add_argument("--open", action="store_true", help="open the file when done")
    args = ap.parse_args()

    rep = build_report()
    html = rep._repr_html_()
    _self_check(rep, html)

    out = pathlib.Path(args.output).expanduser().resolve()
    rep.save(out)
    size_kb = out.stat().st_size / 1024
    n_md = sum(1 for kind, _ in rep.blocks if kind == "md")
    n_html = sum(1 for kind, _ in rep.blocks if kind == "html")
    n_elements = sum(1 for kind, _ in rep.blocks if kind == "element")
    print(
        f"Rendered cp.Report → {out}  ({size_kb:.0f} KB)\n"
        f"  sections: {len(rep.blocks)} blocks "
        f"({n_md} markdown · {n_html} raw-html · {n_elements} components)"
    )

    if args.open:
        import webbrowser

        webbrowser.open(out.as_uri())
    else:
        opener = "open" if sys.platform == "darwin" else "xdg-open"
        print(f"Open it:  {opener} {out}")


if __name__ == "__main__":
    main()
