"""cairn pages inline in a marimo notebook: a run page, the workspace, a report.

    cairn ui --repo /tmp/cairn-notebook/.cairn --no-auth --no-open-browser &
    CAIRN_REPO=/tmp/cairn-notebook/.cairn marimo edit examples/notebook_embeds.py

Needs `pip install 'cairn-track[ui]' marimo`. In Jupyter the same calls work:
a run as the last expression of a cell, `run.display(...)`,
`cairn.ui.workspace(...)` and `cairn.ui.report(...)`. See docs/guides/notebooks.md.
"""

import marimo

app = marimo.App(width="full")


@app.cell
def _():
    import math

    import marimo as mo

    import cairn
    import cairn.ui

    return cairn, math, mo


@app.cell
def _(cairn, math):
    # A small experiment: a prepare run logs a dataset, two training runs use it.
    prep = cairn.Run("notebook-demo", name="prepare", group="exp-1", job_type="prepare")
    data = prep.log_artifact({"rows": 1000}, "data-exp-1", type="dataset")
    prep.finish()

    runs = []
    for lr in (1e-3, 3e-4):
        run = cairn.Run("notebook-demo", name=f"train-lr{lr:g}", group="exp-1", job_type="train")
        run.config(lr=lr)
        run.use_artifact(data)
        for step in range(50):
            run.track(math.exp(-step * lr * 100) + 0.02 * (step % 3), name="train/loss", step=step)
        run.finish()
        runs.append(run)
    return (runs,)


@app.cell
def _(runs):
    # A run as the cell's last expression: its run page (Workspace tab), live.
    runs[0]
    return


@app.cell
def _(runs):
    # Another tab and height.
    runs[0].display(tab="overview", height=480)
    return


@app.cell
def _(cairn):
    # The project workspace, filtered to the group (for this embed only).
    cairn.ui.workspace("notebook-demo", filter='run.group == "exp-1"')
    return


@app.cell
def _(mo):
    report_id = mo.ui.text(label="Report id (from its URL, or `cairn report ls`)")
    report_id
    return (report_id,)


@app.cell
def _(cairn, report_id):
    cairn.ui.report("notebook-demo", report_id.value) if report_id.value else None
    return


if __name__ == "__main__":
    app.run()
