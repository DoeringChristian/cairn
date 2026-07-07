"""marimo notebook — using cairn from a marimo notebook.

Shows the cairn read API (``cairn.Reader``) and the pure-numpy Plotly
helpers in ``cairn.plot`` (confusion_matrix, roc_curve, pr_curve, bar,
line_series — see ``cairn/plot.py``) rendering directly inside marimo
cells, plus the WS-PYAPI Python element/report API — ``run[tag]`` lazy
handles, ``cairn.plot.media_compare``/friends, and the notebook-only
``cairn.Report`` container (see
``docs/superpowers/specs/2026-07-07-notebook-python-and-embed.md``, the
WS-PYAPI section + §11).

Usage::

    # marimo and plotly are optional deps, not required by cairn core —
    # installed via the "examples" + "media" extras. `uv sync --extra
    # examples --extra media` once, or let `uv run --extra examples
    # --extra media ...` resolve them inline each time.
    uv run cairn init /tmp/cairn-marimo-demo
    CAIRN_REPO=/tmp/cairn-marimo-demo/.cairn \\
        uv run --extra media python examples/demo_plot_helpers.py  # populate runs
    # optional, to also demo the WS-PYAPI `media_compare` cell (section 4)
    # with real image data instead of its scalar/figure fallback:
    CAIRN_REPO=/tmp/cairn-marimo-demo/.cairn \\
        uv run --extra examples --extra media python examples/demo_image_comparison.py

    # optional, for a LIVE `/embed/card` iframe instead of the WS-PYAPI
    # cells' text fallback: start `cairn ui` on the SAME repo. As of the
    # server auto-discovery fix, no port wiring is needed — the element
    # finds whichever port `cairn ui` actually bound (it auto-increments
    # past 4301 when taken) via that repo's `.cairn/servers.json`:
    #   cairn ui --repo /tmp/cairn-marimo-demo --no-auth &
    # To pin an explicit server instead (bypassing auto-discovery), use the
    # `cairn://host:port` scheme — NOT `http://`, which `cairn.Reader`/
    # `cairn.configure` read as a *local filesystem path*, not a server URL:
    #   CAIRN_REPO=cairn://localhost:4301 uv run ...

    # interactive edit:
    uv run --extra examples --extra media marimo edit examples/marimo_cairn_demo.py

    # headless run/"test" — runs the notebook end-to-end as a script and
    # exits 0 if every cell ran without error (falls back to synthetic
    # data when CAIRN_REPO / no runs are found, so this works standalone):
    uv run --extra examples --extra media python examples/marimo_cairn_demo.py
"""

import marimo

app = marimo.App(width="medium")


@app.cell
def _(mo):
    mo.md(
        r"""
        # cairn + marimo

        This notebook shows **cairn** cards/plots rendered inline in a
        [marimo](https://marimo.io) notebook, using cairn's existing
        read API today, and previews the target Python "card" API that
        lands with the notebook/Python-API workstream.

        marimo and plotly are *optional* dependencies of cairn, installed
        via the `examples` + `media` extras. Neither is required to use
        cairn itself.

        Run this notebook with:

        ```
        uv run --extra examples --extra media marimo edit examples/marimo_cairn_demo.py
        ```

        Or run it headless (as a "test" — exits 0 if every cell runs
        without error):

        ```
        uv run --extra examples --extra media python examples/marimo_cairn_demo.py
        ```
        """
    )
    return


@app.cell
def _(mo):
    mo.md(
        r"""
        ## 1. Connect to a cairn repo

        `cairn.Reader` opens a local `.cairn/` directory directly (or
        talks to a running `cairn server` over HTTP, or reads an
        exported `.zip`). With no argument it auto-detects the repo the
        same way `cairn.Run()` does: an explicit path, then the
        `CAIRN_REPO` env var, then the nearest `.cairn/` walking up from
        the current directory (see `cairn/config.py`).

        Point this at your own project's `.cairn` by exporting
        `CAIRN_REPO=/path/to/project/.cairn` before launching marimo, or
        by editing `repo_path` below.

        **Server discovery for the WS-PYAPI cells (section 4):** those
        cells' `CardElement`s render a live `/embed/card` iframe when a
        `cairn ui` is reachable. With a *local* `.cairn` repo (the default
        above), the element auto-discovers a `cairn ui` running on that
        same repo — no matter which port it actually bound (it
        auto-increments past its 4301 default when taken) — by reading
        that repo's `.cairn/servers.json`, which `cairn ui` writes on
        startup. Just start it: `cairn ui --repo <path> --no-auth`, no
        port bookkeeping required.

        To point at a specific server explicitly instead (skipping
        auto-discovery), use the `cairn://host:port` scheme — e.g.
        `CAIRN_REPO=cairn://localhost:4301` or
        `cairn.configure(repo="cairn://localhost:4301")`. A plain
        `http://...` URL here is read as a *local filesystem path*, not a
        server address, and silently resolves to zero runs.
        """
    )
    return


@app.cell
def _():
    import os

    import cairn

    # Default: auto-detect (CAIRN_REPO env var, or nearest .cairn/ walking
    # up from the cwd marimo was launched in). Override explicitly here if
    # you want this notebook to always point at a specific repo, e.g.:
    #   repo_path = "/tmp/cairn-marimo-demo/.cairn"
    repo_path = os.environ.get("CAIRN_REPO")
    reader = cairn.Reader(repo=repo_path)
    return cairn, reader


@app.cell
def _(mo):
    mo.md(
        r"""
        ## 2. Query runs

        `reader.runs(project=...)` starts a lazy query; `.filter(...)`
        adds Django-style `field__operator=value` filters, and
        `.last()`/`.first()`/`.list()` execute it (see the `RunQuery`
        docstring in `cairn/sdk/reader.py`). This looks for the
        `plot-helpers-demo` project produced by
        `examples/demo_plot_helpers.py` — run that script first (see the
        module docstring above) to have something to query.
        """
    )
    return


@app.cell
def _(mo, reader):
    project = "plot-helpers-demo"

    latest_run = (
        reader.runs(project=project)
        .filter(tags__contains="demo")
        .last()
    )

    if latest_run is not None:
        run_summary = mo.md(
            f"""
            **Latest run:** `{latest_run.name}` (`{latest_run.id}`)

            - status: `{latest_run.status}`
            - tags: `{latest_run.tags}`
            - sequences: `{[s.name for s in latest_run.sequences()]}`
            """
        )
    else:
        run_summary = mo.md(
            f"""
            No runs found in project `{project!r}`. Generate some demo
            data first:

            ```
            uv run cairn init /tmp/cairn-marimo-demo
            CAIRN_REPO=/tmp/cairn-marimo-demo/.cairn \\
                uv run python examples/demo_plot_helpers.py
            ```

            The cells below fall back to synthetic data so the notebook
            still runs end to end without a populated repo.
            """
        )

    run_summary
    return latest_run, project


@app.cell
def _(mo):
    mo.md(
        r"""
        ## 3. Plot with `cairn.plot`

        `cairn.plot.confusion_matrix`/`roc_curve`/`pr_curve`/`bar`/
        `line_series` are pure-numpy helpers that return a plain
        `plotly.graph_objects.Figure` (see `cairn/plot.py`) — the same
        figures `run.track(fig, name=..., step=...)` logs to the
        `figure` card handler. marimo renders a returned `Figure`
        natively, so the exact object you'd otherwise `run.track(...)`
        also just displays in a cell.

        If the queried run above has a logged `eval.confusion_matrix`
        artifact we fetch and display it directly; otherwise we build
        one from synthetic predictions with `cairn.plot.confusion_matrix`
        so this cell always renders something.
        """
    )
    return


@app.cell
def _(cairn, latest_run):
    import numpy as np

    if latest_run is not None and "eval.roc_curve" in [
        s.name for s in latest_run.sequences()
    ]:
        # Real data: pull the logged Plotly figure straight out of the run.
        fig = latest_run.artifact("eval.roc_curve")
    else:
        # No run available (or the demo project hasn't been logged yet) —
        # fall back to synthetic 3-class predictions, same shape the demo
        # script uses, so cairn.plot.roc_curve still has real arrays to
        # sweep a threshold over.
        rng = np.random.default_rng(0)
        n_classes = 3
        y_true = rng.integers(0, n_classes, size=90)
        logits = rng.normal(size=(90, n_classes))
        logits[np.arange(90), y_true] += 1.5
        probas = np.exp(logits) / np.exp(logits).sum(axis=1, keepdims=True)

        fig = cairn.plot.roc_curve(y_true, probas, labels=["cat", "dog", "bird"])

    fig
    return


@app.cell
def _(mo):
    mo.md(
        r"""
        ## 4. `cairn.plot` elements + `cairn.Report` (WS-PYAPI)

        A Python **element**/report API lets you build individual
        cairn-plot elements — and assemble a lightweight report from them —
        entirely in code; see
        `docs/superpowers/specs/2026-07-07-notebook-python-and-embed.md`
        (the WS-PYAPI section, especially §11) for the design.

        `run[tag]` (added to `cairn.sdk.reader.Run`) is a **lazy** handle
        over a tracked sequence/artifact — it resolves only when an element
        actually renders, never at `run[tag]` construction time.
        `cairn.plot.media_compare(a, b, mode=...)` (alongside the
        single-view `scalar`/`image`/`mesh`/`pointcloud`/`volume`/`boxes`/
        `table`/`figure` builders in the same module) takes such handles and
        builds one schema-validated card spec. The returned `Element`
        implements `_repr_html_`/`_repr_mimebundle_`, so it renders as a
        live `/embed/card` iframe right here in the cell **when a cairn
        server is reachable** (start one with `cairn ui --repo
        /tmp/cairn-marimo-demo --no-auth` — with the local repo above it's
        auto-discovered, no port needed), and falls back to an inline
        notice — no exception — when one isn't.

        `cairn.Report` is a **notebook-only container** (no server
        `publish()` — the notebook itself is the report): `.md(...)`
        appends prose, `.add(el)` appends an element, and the report's own
        `_repr_html_` renders every block inline, in order.

        `media_compare` needs *image* data, which `demo_plot_helpers.py`
        (section 2/3's project) doesn't log — seed it separately with:

        ```
        CAIRN_REPO=/tmp/cairn-marimo-demo/.cairn \\
            uv run --extra examples --extra media python \\
            examples/demo_image_comparison.py
        ```

        Without that, this cell falls back to a `cairn.plot.figure` element
        built from section 2/3's run instead — still a real, working
        server-backed element, just not a comparison.
        """
    )
    return


@app.cell
def _(cairn, latest_run, mo, reader):
    _image_runs = reader.runs(project="image-comparison-demo").list()

    if len(_image_runs) >= 2:
        run_a, run_b = _image_runs[0], _image_runs[1]

        # `run[tag]` is a LAZY handle — no fetch happens on this line.
        # `media_compare` builds + schema-validates one card spec from the
        # two handles ("diff" = the pixel-diff image-space compositor); a
        # single-series element would be e.g.
        # `cairn.plot.scalar(run_a["quality.mae"])`.
        el = cairn.plot.media_compare(run_a["output"], run_b["output"], mode="diff")

        report = cairn.Report(name="Image comparison", project="image-comparison-demo")
        report.md(f"## Results\nComparing `{run_a.name}` vs. `{run_b.name}`.")
        report.add(el)
        pyapi_demo = report  # renders inline via _repr_html_/_repr_mimebundle_
    elif latest_run is not None and "eval.roc_curve" in [
        s.name for s in latest_run.sequences()
    ]:
        # No `image-comparison-demo` data — still demo a WORKING
        # server-backed element (never a dead cell) from whatever real data
        # section 2/3's query above already found.
        el = cairn.plot.figure(latest_run["eval.roc_curve"])
        report = cairn.Report(name="ROC curve", project="plot-helpers-demo")
        report.md(
            "No `image-comparison-demo` runs found (2+ needed to demo "
            "`media_compare`) — generate them with `uv run --extra examples "
            "--extra media python examples/demo_image_comparison.py`. "
            "Showing a working server-backed `cairn.plot.figure` element "
            f"instead, from `{latest_run.name}` (queried in section 2)."
        )
        report.add(el)
        pyapi_demo = report
    else:
        pyapi_demo = mo.md(
            "Need at least 2 runs in `image-comparison-demo` to demo "
            "`media_compare` (or a `plot-helpers-demo` run to fall back "
            "to) — generate one with `uv run --extra examples --extra "
            "media python examples/demo_image_comparison.py` or "
            "`examples/demo_plot_helpers.py`."
        )

    pyapi_demo
    return


@app.cell
def _():
    import marimo as mo

    return (mo,)


if __name__ == "__main__":
    app.run()
