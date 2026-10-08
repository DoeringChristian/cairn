# Project workspace

The project workspace (`/p/<project>/workspace`, **Workspace** in the project navigation) shows many runs together: a **Runs** sidebar picks the runs, and the right side shows the project's current [workspace view](workspace.md#workspace-views) bound to them, with the same toolbar, sections, panels and card editor as the run page.

What the sidebar shows is part of the current view: every change saves into it like a layout edit (and is an undo step), and switching views switches the runs too. The run page ignores it. A [group page](#group-page) has the same workspace over one group's runs.

## Runs sidebar

```
Status [All ▾]  Search [regex          ]
[Filter] [Group: group] [ ] Latest only
Sort: [created ▾] [↓]
4 of 4 groups shown
◉  NAME
◉  ▾ group: exp-44  5
  ◉    ● train v2
  ◉    ● prepare v2
  ◉    ● eval v1
  ◉    ● train v1
  ◉    ● prepare v1
◉  ▸ group: exp-43  4
○  ▸ group: exp-42  4
◉  ▾ group: (none)  2
  ◉    ● baseline v2
  ◉    ● baseline v1
```

The sidebar is the [runs table](runs-table.md) with only the Name column, and an eye in place of each checkbox: in the Name cell, before the run's dot or the group's caret, indented with it. The header's eye, left of **Name**, shows or hides every listed run. Its toolbar is the runs table's without **Columns**: **Status**, **Search**, **Filter**, **Group** and **Latest only** work exactly as there. **Sort** picks one of the runs table's sortable keys (`created`, `name`, `status`, `duration`, and the metric and param columns) and **↓ / ↑** flips its direction; it starts on `created ↓` (newest first) and is saved with the rest. Not grouped, a grouped run reads `exp-44 · train v2`, unless every listed run is in the same group. **N of M groups shown** (not grouped: runs) counts the groups with a visible run, or the visible runs. On a phone the sidebar folds behind a **Runs** button.

- **▸ / ▾** folds a group (not saved). The first group and the `(none)` group start open. A run group's name (`group: exp-44`) links to its [group page](#group-page).
- The **header eye** shows every listed run, or hides them all when all are shown; ◐ means some are hidden.
- A **group's eye** shows or hides every run in it; ◐ means some of them are hidden. The eyes of a group's runs are indented one step per level.
- A **run's eye** shows or hides that run. A hidden run's dot is hollow.
- **Pinned runs** (the pin on row hover; the same pins as the runs table's) are listed first and stay listed whatever the status, search, filter and **Latest only**. Grouped, a pinned run is first in its group.
- **Hover** a run and its line(s) are highlighted in every chart, the others dimmed; hover a line in a chart and its row is highlighted. Grouped, a group header, or a run in it, highlights the group's line, and hovering that line highlights the group header.

By default the 10 newest groups (by their newest run; not grouped: the 10 newest runs) are visible and the rest hidden, so a new run shows up on its own. An eye you click overrides that.

## Cards

The cards get the visible runs.

- Grouped, a line chart draws **one line per top-level group**: the mean over the group's runs that log the metric, with a min–max band, in the group's colour and labelled with its name. Runs without a group value stay their own lines. Not grouped, every run is its own line, in the colour of its dot. A card whose **Group runs** setting is **Off** or **By key** ([cards](cards.md)) keeps its own grouping instead.
- Media and other cards show one item per run. When the runs span groups, grouped runs are labelled `<group> · <name> v<n>`, such as `exp-43 · eval v2`.

## From the runs table

Select runs in the [runs table](runs-table.md) and click **Show in workspace**: the workspace opens with exactly the selected runs visible and nothing else, grouped or not, and its status, search, filter and **Latest only** cleared. Grouped, a group with other runs shows ◐, and its line is the mean over the selected runs only. On a group page's **Runs** tab it opens the group page's workspace.

## Group page

A run group has its own page, `/p/<project>/g/<group>`:

```
Projects › selections › exp-44                 group · 5 runs · last run 2h ago
[Workspace] [Runs]
```

- **Workspace** is the project workspace over the group's runs: the same sidebar and cards in the project's current view (with the same view switcher). Its run state is the group's own, saved in the current view next to the project workspace's; it starts not grouped (one line per run), and names drop the `exp-44 ·` prefix. As everywhere, the 10 newest runs are visible by default.
- **Runs** is the [runs table](runs-table.md) over the group's runs, with its bulk actions.
- The header shows the group's run count (archived runs not counted) and when its newest run started.

The group's name links here from the workspace sidebar's and the runs table's group headers, the run page header (`exp-44 ↗` next to the version) and the lineage panel's **Group** row.
