# Project workspace

The project workspace (`/p/<project>/workspace`, **Workspace** in the project navigation) shows many runs together: a **Runs** sidebar picks the runs, and the right side shows the project's current [workspace view](workspace.md#workspace-views) bound to them, with the same toolbar, sections, panels and card editor as the run page.

What the sidebar picks is part of the current view: every change saves into it like a layout edit (and is an undo step), and switching views switches the runs too. The run page ignores it.

## Runs sidebar

```
[search runs…           ]
Group by: [group ▾]    showing 3 of 4
◉ ▾ ■ exp-44              [latest ▾]
◉       prepare  [v2 ▾]
◉       train    [v2 ▾]  ← prepare v2
        eval     not run yet
◉ ▸ ■ exp-43              [latest ▾]
○ ▸ ■ exp-42              [custom ▾]
◉ ▾   ungrouped
◉       baseline [v2 ▾]
```

The sidebar lists the project's runs that are not archived and match the search (a case-insensitive substring of the run's name, id or group). **showing N of M** counts the visible entries against the listed ones. On a phone the sidebar folds behind a **Runs** button.

### Group by group

One entry per [group](../guides/runs.md), newest first (by its newest run), then the **ungrouped** block.

- **Eye** (◉ / ○): shows or hides the group. ◐ means some of its names are hidden.
- **▸ / ▾** folds the group (not saved).
- **■** is the group's colour, the same everywhere it is drawn.
- **latest / custom**: the group's version picks. *latest* shows the newest runs that fit together by lineage; picking a version makes it *custom*; choosing *latest* again resets it.

Under the group, one row per name, upstream first (a name another name used comes before it):

- The eye leaves that name out of the group's lines.
- The version picker lists every [version](../guides/runs.md#versions), newest first. A version that does not fit the other picks is listed with a muted note, such as `v1 · on train v1`.
- `← prepare v2` names what the picked run used inside the group.
- **not run yet**: no version of this name fits the picks. The picker still offers every version.

Picking a version keeps the group consistent: the runs it used come along (when it used several versions of a name, the current pick stays if it is one of them), and every other name whose pick no longer fits moves to its newest version that fits, or to *not run yet*.

The ungrouped block has one row per name with an eye and a version picker (the newest version by default), without lineage rules.

### Group by none

A flat list of every listed run, newest first, each with an eye.

### Visibility

By default the 10 newest entries (groups and ungrouped names, or runs with Group by none) are visible and the rest hidden, so a new run shows up on its own. An eye you click overrides that.

## Cards

The cards get the picked, visible runs of the visible groups plus the visible ungrouped runs (or every visible run with Group by none).

- With Group by group, a line chart draws **one line per group**: the mean over the group's runs that log the metric, with a min–max band, in the group's colour and labelled with its name. Ungrouped runs stay their own lines. With Group by none every run is its own line.
- Media and other cards show one item per run. When the runs span groups, grouped runs are labelled `<group> · <name> v<n>`, such as `exp-43 · eval v2`.

## From the runs table

Select runs in the [runs table](runs-table.md) and click **Show in workspace**: the workspace opens with only the selected runs' groups (and the selected ungrouped runs) visible, and the search cleared.
