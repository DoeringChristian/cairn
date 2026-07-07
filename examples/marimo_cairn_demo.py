"""marimo notebook — using cairn from a marimo notebook.

Shows the cairn read API (``cairn.Reader``) and the pure-numpy Plotly
helpers in ``cairn.plot`` (confusion_matrix, roc_curve, pr_curve, bar,
line_series — see ``cairn/plot.py``) rendering directly inside marimo
cells, plus a preview of the not-yet-built Python "card"/report API
(``docs/superpowers/specs/2026-07-05-notebook-reports.md``, section
"E. Python card API + Jupyter/marimo").

Usage::

    pip install marimo          # optional dep, not required by cairn core
    uv run cairn init /tmp/cairn-marimo-demo
    CAIRN_REPO=/tmp/cairn-marimo-demo/.cairn \\
        uv run python examples/demo_plot_helpers.py   # populate some runs
    marimo edit examples/marimo_cairn_demo.py
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

        marimo is an *optional* dependency of cairn — install it with
        `pip install marimo` (or the `examples` extra: `pip install
        cairn-track[examples]`). It is not required to use cairn itself.

        Run this notebook with:

        ```
        marimo edit examples/marimo_cairn_demo.py
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
        ## 4. 🚧 Coming soon (WS-PYAPI)

        The cells above use cairn's *read* API. A Python **card/report**
        API — build cards in code, `_repr_html_`/`_repr_mimebundle_` so
        they render inline in Jupyter/marimo, and `publish()` to push a
        report to the server — is designed but not yet built; see
        `docs/superpowers/specs/2026-07-05-notebook-reports.md`, section
        "E. Python card API + Jupyter/marimo", for the target shape.
        Sketch of the intended API (not runnable yet):
        """
    )
    return


@app.cell
def _():
    # --- target API (WS-PYAPI, not yet implemented) --------------------
    #
    # import cairn
    #
    # r = cairn.Reader()
    # run_a = r.runs(project="plot-helpers-demo").filter(name__contains="-a").last()
    # run_b = r.runs(project="plot-helpers-demo").filter(name__contains="-b").last()
    #
    # # Compare two runs' logged media side by side / as a diff overlay.
    # # `el` implements `_repr_html_`/`_repr_mimebundle_` so it renders
    # # inline right here in the marimo cell, no `report.add` needed to see it.
    # el = cairn.plot.media_compare(
    #     run_a.artifact("eval.predictions"),
    #     run_b.artifact("eval.predictions"),
    #     mode="diff",
    # )
    # el  # <- renders inline in Jupyter/marimo via _repr_html_
    #
    # # Assembling a report from notebook cells and publishing it to the
    # # cairn server as a shareable page:
    # report = cairn.Report(name="Ablation study", project="plot-helpers-demo")
    # report.md("## Results\nBaseline vs. ablation.")
    # report.add(el)
    # report.publish()
    return


@app.cell
def _():
    import marimo as mo

    return (mo,)


if __name__ == "__main__":
    app.run()
