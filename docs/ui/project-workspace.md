# Project workspace

The project workspace (`/p/<project>/workspace`, **Workspace** in the project navigation) shows many runs together: a **Runs** sidebar picks the runs, and the right side shows the project's current [workspace view](workspace.md#workspace-views) bound to them, with the same toolbar, sections, panels and card editor as the run page.

What the sidebar shows is part of the current view: every change saves into it like a layout edit (and is an undo step), and switching views switches the runs too. The run page ignores it.

## Runs sidebar

```
Status [All ▾]  Search [regex          ]
[Filter] [Group: group › job_type]
Sort: [created ▾] [↓]
3 of 3 groups shown
◉▾ NAME  15 listed
◉  ○ ▾ Group: exp-44        3  5
     ◉ ● ▾ Job Type: train      2
         ◉ eager-sun v2
         ◉ eager-sun v1
     ◉ ● ▸ Job Type: eval       1
     ◉ ● ▸ Job Type: prepare    2
◉  ○ ▸ Group: seeds-lr3e-4  1  3
◉  ○ ▸ Group: (none)        2  2
```

The sidebar is the [runs table](runs-table.md) (the same view state: what you change in one shows in the other) with only the Name column, and an eye in place of each checkbox: in the Name cell, before the run's dot or the group's caret, indented with it. The header's eye, left of **Name**, shows or hides every listed run; `15 listed` counts the listed runs. Its toolbar is the runs table's without **Columns**: **Status**, **Search**, **Filter** (with **Latest versions only**) and **Group** work exactly as there. **Sort** picks one of the runs table's sortable keys (`created`, `name`, `status`, `duration`, and the metric and param columns) and **↓ / ↑** flips its direction; it starts on `created ↓` (newest first) and is saved with the rest. Not grouped, a grouped run reads `exp-44 · train v2`, unless every listed run is in the same group. **N of M groups shown** (not grouped: runs) counts the groups with a visible run, or the visible runs. On a phone the sidebar folds behind a **Runs** button.

- A new view starts **not grouped** (one line per run, as wandb's default workspace); **Group** groups it, and a view keeps the grouping it saved.
- Group rows read `Field: value` (`Group: exp-44`, `Job Type: train`, `Tag: prod`, `lr: 0.001`; no value: `Group: (none)`), as in wandb. An **outer** group (one with sub-groups) has a hollow circle and two counts, its sub-groups and its runs. An **innermost** group has a filled dot in the colour of its chart line, and its run count. With one grouping level every group is innermost. Runs inside groups have no dot: their line is their group's. **Runs without a value are never averaged**: a `(none)` group, at any level, has no line, so its dot is hollow like an outer group's, and each run under it keeps its own dot and its own line.
- **▸ / ▾** folds a group, saved in the view (the [runs table](runs-table.md) shows the same groups open). The first top-level group and the `(none)` group start open. A run group's name (`exp-44` in `Group: exp-44`) [filters the workspace to it](#filtering-to-a-group).
- The **header eye** shows every listed run, or hides them all when all are shown; ◐ means some are hidden. Its **▾** opens **Show all**, **Hide all** and **Show latest only**. **Show latest only** shows the latest version of every series and hides the older versions, which stay listed (dimmed) and are not drawn. Grouped, a group with older versions shows ◐. A run's eye still overrides it afterwards.
- A **group's eye** shows or hides every run in it; ◐ means some of them are hidden. The eyes of a group's runs are indented one step per level.
- A **run's eye** shows or hides that run. A hidden run's dot is hollow, and so is an innermost group's when all its runs are hidden.
- **Pinned runs** (pinned in the runs table) are listed first and stay listed whatever the status, search and filter (**Latest versions only** included). Grouped, a pinned run is first in its group. A pinned run or the baseline shows its pin or flag right after its version.
- **Hover** a row to show its copyable id at the end of the row (nothing else, so names stay readable in the narrow sidebar). Pin and baseline are set in the runs table.
- Hovering a run also highlights its line(s) are highlighted in every chart, the others dimmed; hover a line in a chart and its row is highlighted. Grouped, an innermost group header, or a run in it, highlights the group's line, and hovering that line highlights the group header. A run under a `(none)` group highlights its own line.

- **Click a run's name** to open its run page on the **Workspace** tab. Its header then has a **← Workspace** link, next to the run name, back here: the workspace comes back as you left it (filters, grouping, eyes, sort and folded groups are the view's; the sidebar's scroll position is kept for the session). The link stays while you switch the run page's tabs. A run opened any other way (runs table, lineage, reports, a URL) has no such link.

By default the 10 newest groups (by their newest run; not grouped: the 10 newest runs) are visible and the rest hidden, so a new run shows up on its own. An eye you click overrides that.

## Cards

The cards get the visible runs. The page assigns colours once, over the visible ungrouped runs and the innermost groups together ([run colours](runs-table.md#run-colours)): a sidebar dot, the chart line and legend, the Summary cards' dots, parallel coordinates, media badges and the run comparer all show the same colour, and no run shares a colour with a group while the palette lasts.

- Grouped, a line chart draws **one line per innermost group** (wandb's): the mean over the group's runs that log the metric, with a min–max band, in the colour of the group's dot, and labelled with its path as `key: value` pairs: `group: exp-44, jobType: train` (one level: `group: exp-44`). The Scalars and Config cards have a row or column per innermost group, labelled the same way, and parallel coordinates a line per innermost group. Runs without a value are never averaged: a run under a `(none)` group (`Group: (none)`, `Job Type: (none)`, a tag or param with no value, at any level) is its own line, row or column, in its own colour. Not grouped, every run is its own line, in the colour of its dot. A card whose **Group runs** setting is **Off** or **By key** ([cards](cards.md)) keeps its own grouping instead.
- Media and other cards show one item per run. When the runs span groups, grouped runs are labelled `<group> · <name> v<n>`, such as `exp-43 · eval v2`.

## From the runs table

The [runs table](runs-table.md) belongs to the same view: its toolbar, eyes and open groups are the sidebar's, so a filter or an eye set there is set here too. Select runs there and click **Show in workspace**: the workspace opens with exactly the selected runs visible and nothing else, grouped or not, and its status, search and filter (**Latest versions only** included) cleared. Grouped, a group with other runs shows ◐, and its line is the mean over the selected runs only.

## Filtering to a group

Click a run group's name (`exp-44` in `Group: exp-44`) in the sidebar to show only that group: the [filter](runs-table.md#filters) gains the condition `group = exp-44`, shown as a removable chip next to **Filter (1)**. Remove the chip (×) to bring the other groups back. Clicking another group's name replaces the condition; the filter editor can still build anything. The group's runs hidden by their eyes or by the 10-newest default are shown; other eyes stay as they were.

The group's name in the [runs table](runs-table.md)'s group headers, the run page header (`exp-44 ↗` next to the version) and the lineage panel's **Group** row open the workspace filtered the same way.
