# Comparisons

A comparison is a [workspace](workspace.md#workspaces) bound to a set of runs: its own layout of sections and panels, plus its runs. It renders exactly like the run page (the same toolbar, sections, panels, **+** per section and edit dialog); the only comparison-specific parts are the run set and the panels that compare runs.

It has three tabs:

- **Overview**: a summary card per run, plus diffs of metrics, config and environment.
- **Metrics & Media**: the run set and the workspace.
- **Source**: a code diff between two runs.

Comparisons are stored per project on the server. Open **Compare** in the project navigation (`/p/<project>/compare`). The sidebar lists the project's comparisons with their run count and age. The selected comparison is in the URL: `?c=<id>` for the comparison, `&tab=` for the tab.

## Creating a comparison

A new comparison starts with a **copy of the current [workspace view](workspace.md#workspace-views)'s layout** (the run page's sections, panels and their settings, hidden and removed panels, whether [unlisted metrics](workspace.md#include-unlisted-metrics) get automatic panels, hide patterns, defaults and prefs). After that the two are independent: editing the comparison never changes the view, and editing the view never changes the comparison. To bring a view's layout over later, open the comparison's **Views** switcher and click the view's tile: its layout replaces the comparison's (the runs stay), and ++cmd+z++ undoes it. **+ New view** there saves the comparison's layout as a new view.

| From | Runs |
| --- | --- |
| Run page → **New comparison** (workspace toolbar) | That run. |
| Runs table, select runs → **Compare** | The selected runs. |
| Runs table → **New comparison** | None yet. |
| Compare sidebar → **+** | None yet. |
| Compare sidebar → **✨** (Smart comparison) | Runs picked by their parameters (see below). |

In the sidebar:

- To rename a comparison, double-click it, use the pencil, or click its title in the header.
- To delete several comparisons, tick them (shift-click selects a range) and click **Delete N**.

### Smart comparison

The wizard picks runs by their parameters:

1. Choose parameter keys.
2. For each key, pick allowed values, or give a regex.
3. Choose a strategy: **latest** keeps the newest run for each combination of parameter values; **all** keeps every matching run.
4. Preview the matching runs, then create the comparison. It holds the matched runs as a static run set.

## Run sets

On the **Metrics & Media** tab, the *Runs in comparison* panel holds the run set. A run set is either:

Static
:   A fixed list. **+ Add runs** shows every project run not yet included; click one to add it. Click **×** on a chip to remove a run.

Auto (query)
:   A run selector that is resolved again against the project's runs:

    | Field | Meaning |
    | --- | --- |
    | Name pattern | Case-insensitive substring of the run name, or a glob when it contains `*` (`training-*`). |
    | Tags | Comma-separated. A run must carry every tag. |
    | Mode | **Latest N**: the N most recently created matching runs. **Newest per name**: the newest matching run per distinct run name, at most N. |
    | N | Cap on the number of runs (default 5). |

    The header badge shows the selector and how many runs it matches. Click refresh on the badge to resolve it again; the panels follow the new runs.

**Use auto (query)** and **Use static runs** switch between the two. Switching to static keeps the runs currently matched.

The same run-set editor and selector are used by report cards cells. There, the selector is stored in the ```` ```cairn ```` fence (see [Report blocks](../reference/report-blocks.md)).

## Run view: hidden, pinned, baseline

Each run chip has a colour swatch and three toggles. They show on hover, and always on touch screens.

| Toggle | Effect |
| --- | --- |
| Eye | Hides the run from the comparison's charts. The chip is struck through and the header counts hidden runs. |
| Pin | The run is listed and drawn first. |
| Flag (baseline) | Marks one run as the baseline. Line plots draw the baseline thicker, and dashed while you hover it. |

The run view is saved in the comparison's workspace, so it is shared with everyone who opens it. The runs table and report cells each have their own run view (see [Runs table](runs-table.md)). Run colours come from the run id, or from the project's colour-by setting.

## Tabs

### Overview

- A summary card per run. A run with [progress](../guides/runs.md#progress-and-eta) has a **Progress** row after Duration: a bar and `58% · ~9m` while it runs (re-read every 2 s), the percentage reached once it ended.
- **Metrics**: each run's final values side by side, as the runs table shows them. The best value is green and the worst red. A metric whose summary rule is `min` counts lower as better and is marked ↓. `system.*` metrics are left out. A filter box narrows the rows.
- **Parameters**: the runs' configs side by side. A long value is cut to one line of its column; **more** shows it in full. The run columns share the width; with many runs the table scrolls sideways and the keys stay in view.
- **Environment**: Python, platform, CUDA and GPUs side by side.

**Only show differences**, on by default, hides rows that are identical across all runs.

### Metrics & Media

The *Runs in comparison* panel, then the comparison's workspace. Everything in [Run page and workspace](workspace.md) applies:

- A panel shows its metrics for every run of the comparison that logs them, one line (or image, video, …) per run.
- Metrics no panel shows get automatic panels, grouped by name prefix.
- **+** in a section header adds a panel to that section. Besides per-metric panels, a comparison is where the multi-run panels come alive: run comparer, code diff, scatter plot, parallel coordinates, parameter importance, bar chart and scalar tiles.
- Removing, resizing, retyping, moving panels, section edits, card settings and defaults all edit this comparison's workspace only.
- Each edit is an undo step, including run set and run view changes.

### Source

Shows a code diff between two of the comparison's runs. Choose the left and right run, then a changed file. It needs at least two runs with a captured source snapshot.

## Actions

Delete
:   The comparison header's **Delete** removes the comparison after you confirm.

Send section to a new report
:   In each section header: copies the section's panels, for the comparison's runs and with their settings, into a new [report](reports.md).
