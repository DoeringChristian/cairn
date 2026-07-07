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

    pip install marimo          # optional dep, not required by cairn core
    uv run cairn init /tmp/cairn-marimo-demo
    CAIRN_REPO=/tmp/cairn-marimo-demo/.cairn \\
        uv run python examples/demo_plot_helpers.py   # populate some runs
    # optional, for the WS-PYAPI section's live iframe:
    #   cairn ui --repo /tmp/cairn-marimo-demo --no-auth &
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
        /tmp/cairn-marimo-demo --no-auth`), and falls back to an inline
        notice — no exception — when one isn't.

        `cairn.Report` is a **notebook-only container** (no server
        `publish()` — the notebook itself is the report): `.md(...)`
        appends prose, `.add(el)` appends an element, and the report's own
        `_repr_html_` renders every block inline, in order.

        This needs at least two runs in the project to compare; it falls
        back to a no-op notice otherwise.
        """
    )
    return


@app.cell
def _(cairn, mo, project, reader):
    _runs = reader.runs(project=project).filter(tags__contains="demo").list()

    if len(_runs) >= 2:
        run_a, run_b = _runs[0], _runs[1]

        # `run[tag]` is a LAZY handle — no fetch happens on this line.
        # `media_compare` builds + schema-validates one card spec from the
        # two handles ("diff" = the pixel-diff image-space compositor); a
        # single-series element would be e.g.
        # `cairn.plot.scalar(run_a["eval.accuracy"])`.
        el = cairn.plot.media_compare(
            run_a["eval.predictions"], run_b["eval.predictions"], mode="diff"
        )

        report = cairn.Report(name="Ablation study", project=project)
        report.md(f"## Results\nComparing `{run_a.name}` vs. `{run_b.name}`.")
        report.add(el)
        pyapi_demo = report  # renders inline via _repr_html_/_repr_mimebundle_
    else:
        pyapi_demo = mo.md(
            "Need at least 2 runs in this project to demo `media_compare` — "
            "generate more with `examples/demo_plot_helpers.py`."
        )

    pyapi_demo
    return


@app.cell
def _():
    import marimo as mo

    return (mo,)


if __name__ == "__main__":
    app.run()
