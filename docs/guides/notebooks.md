# Notebooks

In Jupyter and marimo, cairn shows its pages inline: a run's page, the
project workspace, reports and single cards render in the cell's output as the viewer's own
pages, live, without the app's navigation. They need the viewer
(`pip install 'cairn-track[ui]'`) and a running viewer over the same repo,
such as `cairn ui`.

## A run

A `cairn.Run`, or a run read back with `cairn.Reader`, shows its run page when
it is the last expression of a cell. The page opens on its **Workspace** tab
and follows the run while it trains:

```python
import cairn

run = cairn.Run("my-project", name="train", group="exp-44", job_type="train")
run  # the run page, inline
```

The embed shows the run page's header line (name, version, status, group, job
type and **↗ open in cairn**, which opens the full page in a new tab) and its
tabs. `run.display(tab=..., height=...)` picks another tab (`workspace`,
`overview`, `system`, `logs`, `files`, `artifacts`) or the height in pixels
(default 720):

```python
run.display(tab="overview", height=480)
```

Outside a notebook nothing changes: `print(run)` and `repr(run)` are the plain
representation.

## The workspace and reports

```python
import cairn.ui

cairn.ui.workspace("my-project")                                  # runs sidebar + cards
cairn.ui.workspace("my-project", filter='run.group == "exp-44"')  # only exp-44
cairn.ui.report("my-project", "4039442c8305627f")                 # a report, read-only
```

`filter` narrows the runs as the [runs table's filter](../ui/runs-table.md)
does: an [expression](../reference/expressions.md) over the run, or a filter
tree as the runs table stores it
(`{"kind": "group", "op": "and", "children": [...]}`). It applies to this embed
only; the project's workspace view is not changed. Each function takes
`height=` (pixels, default 720).

## Single cards

`cairn.ui` also builds one card from media you logged, for a side-by-side look without opening
the app. The sources are `run[tag]` values of [`Reader`](reading.md) runs:

```python
reader = cairn.Reader()
a, b = reader.run(run_a), reader.run(run_b)

cairn.ui.image_compare(a["render"], a["reference"])   # one run: a split view with a divider
cairn.ui.image_compare(a["render"], b["render"])      # two runs: side by side
cairn.ui.media_compare(a["mesh"], b["mesh"], card_type="mesh")
```

`media_compare(*sources, card_type=...)` takes any number of sources of one kind (`image`,
`mesh`, `pointcloud`, `volume`, `boxes3d`), with zoom or the 3D camera kept together across the
panes; `mesh_compare`, `pointcloud_compare`, `volume_compare` and `boxes_compare` are the
two-source shorthands. Each is the viewer's `/embed/card` page.

## Which viewer, and access

The embeds point at the viewer the data comes from: the server of a run or
Reader over HTTP (`cairn://host:port`), the `cairn ui` running over a local
repo (found through the repo), or `cairn.configure(repo="cairn://...")` /
`CAIRN_REPO`. When none is reachable, the output says so and how to start one
(`cairn ui --repo PATH`) instead of raising.

An embed is the viewer's page in an iframe (`/embed/run/<run id>?tab=...`,
`/embed/workspace/<project>?filter=...`, `/embed/report/<project>/<report id>`)
and reads with the same session as the app: with auth on, log in to the viewer
in the browser first (or start it with `cairn ui --no-auth` for local work).

## marimo

`examples/notebook_embeds.py` is a marimo notebook that logs a small
experiment and shows its run page, the workspace filtered to its group and a
report:

```bash
cairn ui --repo /tmp/cairn-notebook/.cairn --no-auth &
CAIRN_REPO=/tmp/cairn-notebook/.cairn marimo edit examples/notebook_embeds.py
```
