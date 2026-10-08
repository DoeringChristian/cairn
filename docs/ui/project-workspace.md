# Project workspace

The project workspace (`/p/<project>/workspace`, **Workspace** in the project navigation) shows many runs together: a **Runs** sidebar picks the runs, and the right side shows the project's current [workspace view](workspace.md#workspace-views) bound to them, with the same toolbar, sections, panels and card editor as the run page.

What the sidebar shows is part of the current view: every change saves into it like a layout edit (and is an undo step), and switching views switches the runs too. The run page ignores it.

## Runs sidebar

```
Status [All ▾]  Search [regex          ]
[Filter] [Group: group] [ ] Latest only
4 of 4 groups shown
👁  NAME
◉  ▾ group: exp-44  5
◉      ● train v2
◉      ● prepare v2
◉      ● eval v1
◉      ● train v1
◉      ● prepare v1
◉  ▸ group: exp-43  4
○  ▸ group: exp-42  4
◉  ▾ group: (none)  2
◉      ● baseline v2
◉      ● baseline v1
```

The sidebar is the [runs table](runs-table.md) with only the Name column, and an eye column in place of the checkboxes. Its toolbar is the runs table's without **Columns**: **Status**, **Search**, **Filter**, **Group** and **Latest only** work exactly as there, and the rows are sorted newest first. Not grouped, a grouped run reads `exp-44 · train v2`. **N of M groups shown** (not grouped: runs) counts the groups with a visible run, or the visible runs. On a phone the sidebar folds behind a **Runs** button.

- **▸ / ▾** folds a group (not saved). The first group and the `(none)` group start open.
- A **group's eye** shows or hides every run in it; ◐ means some of them are hidden.
- A **run's eye** shows or hides that run. A hidden run's dot is hollow.

By default the 10 newest groups (by their newest run; not grouped: the 10 newest runs) are visible and the rest hidden, so a new run shows up on its own. An eye you click overrides that.

## Cards

The cards get the visible runs.

- Grouped, a line chart draws **one line per top-level group**: the mean over the group's runs that log the metric, with a min–max band, in the group's colour and labelled with its name. Runs without a group value stay their own lines. Not grouped, every run is its own line, in the colour of its dot.
- Media and other cards show one item per run. When the runs span groups, grouped runs are labelled `<group> · <name> v<n>`, such as `exp-43 · eval v2`.

## From the runs table

Select runs in the [runs table](runs-table.md) and click **Show in workspace**: the workspace opens with only the selected runs' groups visible (runs without a group value, and every run when the sidebar is not grouped: only the selected ones), and its status, search, filter and **Latest only** cleared.
