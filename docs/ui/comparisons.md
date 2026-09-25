# Comparisons

A comparison is a saved side-by-side view of a set of runs. It has three tabs:

- **Overview**: a summary card per run, plus diffs of metrics, config and environment.
- **Metrics & Media**: a board of cards.
- **Source**: a code diff between two runs.

Comparisons are stored per project on the server. Each browser also keeps a local working copy, so the list shows up instantly and syncs in the background.

Open **Compare** in the project navigation (`/p/<project>/compare`). The sidebar lists the project's comparisons with their card count and age. The selected comparison is in the URL: `?c=<id>` for the comparison, `&tab=` for the tab.

## Creating a comparison

| From | What you get |
| --- | --- |
| Runs table, select runs → **Compare** | A comparison named *Comparison <date time>*, with one card per metric logged by any selected run. `system.*` metrics are left out. |
| Runs table → **Empty comparison** | The selected runs with no cards. |
| Runs table → **From template** | The selected runs, with the cards of a saved template that match them. Only shown when the project has templates. |
| Compare sidebar → **+** | An empty comparison named *New comparison*. |
| Compare sidebar → **✨** (Smart comparison) | A wizard that picks runs by their parameters (see below). |
| Compare sidebar → template → **New from template** | A new comparison from a template, using the current comparison's runs, or runs you pick if no comparison is selected. |
| **+** in a card header (Add to comparison) | Adds that card to an existing comparison, or to a new one. |

In the sidebar:

- To rename a comparison, double-click it, use the pencil, or click its title in the header.
- To delete several comparisons, tick them (shift-click selects a range) and click **Delete N**.

### Smart comparison

The wizard builds a comparison from run parameters:

1. Choose parameter keys.
2. For each key, pick allowed values, or give a regex.
3. Choose a strategy: **latest** keeps the newest run for each combination of parameter values; **all** keeps every matching run.
4. Preview the matching runs, then create the comparison.

The comparison remembers its filters. **Refresh** in its header runs them again, so new matching runs join the comparison and its cards are rebuilt.

## Run sets

On the **Metrics & Media** tab, the *Runs in comparison* panel holds the run set. A run set is either:

Static
:   A fixed list. **+ Add runs** shows every project run not yet included; click one to add it. Click **×** on a chip to remove a run, together with its series.

Auto (query)
:   A run selector that is resolved again against the project's runs:

    | Field | Meaning |
    | --- | --- |
    | Name pattern | Case-insensitive substring of the run name, or a glob when it contains `*` (`training-*`). |
    | Tags | Comma-separated. A run must carry every tag. |
    | Mode | **Latest N**: the N most recently created matching runs. **Newest per name**: the newest matching run per distinct run name, at most N. |
    | N | Cap on the number of runs (default 5). |

    The header badge shows the selector and how many runs it matches. Click refresh on the badge to resolve it again and rebuild the cards.

**Use auto (query)** and **Use static runs** switch between the two. Switching to static keeps the runs currently matched. A comparison built with the smart wizard asks for confirmation before switching to a selector, because the selector replaces its filters.

The same run-set editor and selector are used by report cards cells. There, the selector is stored in the ```` ```cairn ```` fence (see [Report blocks](../reference/report-blocks.md)).

## Run view: hidden, pinned, baseline

Each run chip has a colour swatch and three toggles. They show on hover, and always on touch screens.

| Toggle | Effect |
| --- | --- |
| Eye | Hides the run from the comparison's charts. The chip is struck through and the header counts hidden runs. |
| Pin | The run is listed and drawn first. |
| Flag (baseline) | Marks one run as the baseline. Line plots draw the baseline thicker, and dashed while you hover it. |

The run view is saved with the comparison, so it is shared with everyone who opens it. The runs table and report cells each have their own run view (see [Runs table](runs-table.md)). Run colours come from the run id, or from the project's colour-by setting.

## Tabs

### Overview

- A summary card per run.
- **Metrics**: each run's final values side by side, as the runs table shows them. The best value is green and the worst red. A metric whose summary rule is `min` counts lower as better and is marked ↓. `system.*` metrics are left out. A filter box narrows the rows.
- **Parameters**: the runs' configs side by side.
- **Environment**: Python, platform, CUDA and GPUs side by side.

**Only show differences**, on by default, hides rows that are identical across all runs.

### Metrics & Media

A board of cards, grouped into sections by metric name prefix, like the run page:

- **+ Add card** picks metrics, or a multi-run card type, from the comparison's runs.
- Drag cards to reorder them. You cannot reorder a section sorted A–Z.
- The workspace toolbar works here: search, hide matching, quick panel builder, sync zoom. So do the project's workspace defaults and section settings (see [Workspace](workspace.md)).

Card settings are saved per comparison. Each edit is an undo step.

### Source

Shows a code diff between two of the comparison's runs. Choose the left and right run, then a changed file. It needs at least two runs with a captured source snapshot.

## Actions

The comparison header has these actions:

Create report
:   Copies the comparison into a new report: a heading, an intro listing the runs, and one cards cell with copies of all cards and their settings. The comparison itself is not changed. See [Reports](reports.md).

Save template
:   Saves the card layout as a named template. Each card records its type, the metric names it shows and its settings. Multi-run cards match on type only. Apply the template to other runs from the runs table or the Compare sidebar. Only matching cards are restored, and a banner reports *restored N of M cards*.

Delete
:   Deletes the comparison after you confirm.

Each section header also has **Send section to a new report**, which does the same as *Create report* for that section's cards only.
