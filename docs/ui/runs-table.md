# Runs table

The runs table (`/p/<project>`) lists a project's runs, newest first. Use it to find runs, add metric, config and computed columns, and show a selection in the [project workspace](project-workspace.md).

Runs load 100 at a time as you scroll. While a filter or a group-by is active, the table loads every page, so matches outside the first page are not missed. The header shows `<shown> of <total> runs`.

The table updates live: new and deleted runs appear within a few seconds, and running runs' status and values refresh every 3 seconds.

## Toolbar

| Control | What it does |
|---|---|
| **Status** | Show only runs with one status (`running`, `completed`, `failed`, `killed`, `stopped`, `crashed`), or only the **archived** runs. Every other choice hides archived runs. |
| **Search** | A case-insensitive regex over each run's name, id, status and tags. An invalid regex turns the box red. |
| Filter chips, **Filter** | The [filter tree](#filters). |
| **Group** | [Nested group-by](#group-by). |
| **Latest only** | Keep only the newest run of each series: per group, the latest version of each name (`train` in two groups is two series). |
| **Columns** | The [column manager](#columns). The button shows `(+N ƒ)` when you have N computed columns. |
| Sort summary | With more than one sort key, lists them; × removes one. |
| Run view summary | With runs hidden or pinned, or a baseline set, shows e.g. `2 hidden · 1 pinned · baseline <name>`; **reset** clears all three. |
| **Archive old** / **Delete old** | For each run name with several runs, archive or delete all but the newest (archived runs are left out). Both ask first. |
| **Import** | Upload a `.zip` export ([Import and export](../guides/import-export.md)). |

When several runs share a name, the newest of them gets an accent bar on its left edge.

## Filters

A filter is a tree: **groups** combine their children with AND or OR, and the leaves are **conditions** or **expressions**. Groups nest. The top-level children appear as removable chips next to the **Filter** button; **Clear filters** removes them all.

To edit the tree, click **Filter**:

1. Pick **Match all (AND)** or **any (OR)** for the group.
2. Add children with **+ Condition**, **+ Expression** or **+ Group**. A new group starts with the opposite operator from its parent. Use **× group** to remove a nested group.

An empty group matches every run.

### Conditions

A condition is *field operator value*. Fields are:

| Field | Value |
|---|---|
| `display_name`, `status`, `group`, `job_type` | The run's field. |
| `tags` | The run's tag list (empty when untagged). |
| `values.<key>` | The value in the run's metric column (see [Columns](#columns)). |
| `params.<key>` | A config value. |

| Operator | Matches when the field… |
|---|---|
| `=` / `= (any case)` | equals the value / equals it ignoring case (text only). |
| `>` `≥` `<` `≤` | compares so (a missing value never matches). |
| `in (a,b,…)` | equals one of the comma-separated values. |
| `contains` / `contains (any case)` | text contains the value, or a list contains it / text contains it ignoring case. |
| `starts with` / `ends with` | text starts / ends with the value. |
| `is null` | is missing (or **is not null**: present). |

The value you type is converted like a URL query value: `true`/`false` become booleans, then integers, then floats, and anything else stays text. `in` splits on commas first. The comparisons follow Python semantics, the same as the server's query filters: `True == 1`, lists compare element by element, and a comparison Python would reject (text against a number) simply does not match.

### Expressions

An expression leaf is a scalar [expression](../reference/expressions.md); a run matches when it evaluates to a truthy value. For example:

```text
min(val.loss) < 0.3 and config.optimizer == 'adam'
"baseline" in run.tags
summary.best_acc > 0.9
```

In the table, expressions see:

| Name | Value |
|---|---|
| `min(m)`, `max(m)`, `mean(m)`, `first(m)`, `last(m)` | Statistics of metric `m`, computed on the server. |
| `config.<key>` | The run's config. |
| `summary.<key>` | The run's metric column value (last point, summary rule, or explicit summary). |
| `run.name`, `run.id`, `run.status`, `run.tags`, `run.group`, `run.job_type`, `run.created_at` | Run fields. |

The table has no full series, so an expression that needs one evaluates to null. An expression that returns a series instead of one value is rejected ("wrap it in a reducer such as last(…) or min(…)"). An invalid expression is marked red and ignored (it matches everything) until you fix it, so a half-typed expression never blanks the table.

## Sorting

- Click a column header to sort by it; click again to flip the direction. **Created** starts newest-first, every other column ascending.
- ++shift++-click a header to add it as the next sort key, or to flip it if it already is one. Headers show the direction arrow and, with several keys, the key's rank.
- The column menu (⋮ on the header, ▾ on a metric column) also has **Sort ascending** and **Sort descending**; other than a metric column's, it has **Add to sort** / **Remove from sort** too.

Runs without a value sort last in both directions. Numbers sort numerically, text in natural order (`run-2` before `run-10`), and numbers come before text in a mixed column. Ties are broken by run id, so the order is stable. [Pinned runs](#hide-pin-and-baseline) always come first, in sorted order.

## Group by

Click **Group** to add levels. Each level splits its parent group by one of:

- `group` or `job_type` (the run fields); **group, then job_type** gives wandb's nested grouping (`exp-44` → `prepare`, `train`, `eval`);
- `tag`: a run with several tags appears under each of them;
- `param: <key>`: a config value;
- **expression…**: a scalar [expression](../reference/expressions.md), e.g. `min(val.loss) < 0.3`.

Levels nest in order (`by …`, `then …`); reorder them with ↑/↓ and remove one with ×. Grouping and sorting compose: the runs inside each group follow the table's sort, and the groups themselves are ordered by their first run in that sort, at every level. Sorting by **Created** (newest first) puts the group with the most recent run on top; sorting by the grouped column orders the groups by their value. Runs with no value for a level go last as `(none)`. Group rows look as in the [workspace sidebar](project-workspace.md#runs-sidebar), as in wandb: they read `Field: value` (`Group: exp-44`, `Job Type: train`, `Tag: prod`, `lr: 0.001`, `Group: (none)`); an outer group (with sub-groups) has a hollow circle and two counts (sub-groups, runs), an innermost group a filled dot in its workspace chart colour and its run count, and the runs inside groups no dot. Click a group header to collapse or expand it. A run group's name (`exp-44` in `Group: exp-44`) opens the [project workspace filtered to that group](project-workspace.md#filtering-to-a-group). Changing the group-by expands every group again.

## Columns

| Kind | Column | Contents |
|---|---|---|
| Built-in | Name, Group, Job Type, Status, Created, Duration, Tags | Run fields. Group and Job Type are there (and shown by default) when a listed run has one. Duration runs up to now for an unfinished run. |
| Metric | the metric or summary key | The run's value: the metric's last point, replaced by its summary rule in the project if it has one, replaced by an explicit `run.summary()` key of the same name. See [Final values and metric rules](../guides/metric-rules.md). |
| Config | the config key | A config value. |
| Computed | the name or the expression | A scalar expression per run, see [below](#computed-columns). |

The **Status** cell of a run with [progress](../guides/runs.md#progress-and-eta) shows it too. A running run gets a thin bar in its status colour under the badge, with `58% · ~9 min left` (`58% · —` until there is an ETA). An ended run shows the percentage it reached right of the badge (`100%`, `62%`). A run without a total looks as before. The table's live poll keeps both current.

Metric and config columns are the union over the loaded runs: a run that never logged `val.acc` shows a blank cell, and the column stays.

- **Name is frozen** on the left, cannot be hidden or moved, and always comes first. A run with a [version](../guides/runs.md#versions) shows it as a muted `v2` right after its name. When the table is not grouped, a run in a [group](../guides/runs.md) reads `<group> · <name>`, such as `exp-44 · train v2`, unless every listed run is in the same group.
- **Pin** a column (header menu → **Pin (freeze left)**, or the pin icon in the column manager) to freeze it after Name, in pin order. The rest scroll horizontally.
- **Hide** a column from its header menu, or untick it in the column manager. The manager has a search box and **Hide all** / **Show all** for the matching columns.
- **Reorder** by dragging a header onto another, or with **Move left** / **Move right** in its menu. Pinned columns reorder among themselves, and scrolling columns among themselves.

New columns (a metric that appears later) are placed next to their natural neighbours.

### Metric column menu

A metric column's header has a ▾ menu (the Scalars card's metric columns have the same one):

```
EVAL/MSE ▾
┌──────────────────────────────────────────┐
│ Sort ascending / Sort descending         │
│ Summary   [ last ▾ ]                     │
│ Goal      [ lower is better ▾ ]          │
│ logged: summary=min · project overrides  │
│ [Reset to logged]                        │
│ Hide column                              │
└──────────────────────────────────────────┘
```

**Summary** (`min`, `max`, `mean`, `last`) picks the number the column shows, **Goal** (lower is better, higher is better, none) which way is better. Both set the metric's [project override](../guides/metric-rules.md#project-overrides): every run of the project, every table and card follows it, for everyone. The muted line shows the rule the runs logged (`summary=` of `run.track`, `none` without one) and `· project overrides` while an override is set; **Reset to logged** removes it. A read-only user sees the values, disabled.

### Computed columns

At the bottom of **Columns**, enter a scalar expression (e.g. `min(val.loss)`) and an optional name, and click **Add column**. The expression sees the same names as [filter expressions](#expressions). Edit or remove a computed column from its header menu (**Edit expression**, **Remove column**).

## Selecting runs

Tick a row's checkbox to select it; ++shift++-click another checkbox to select the range between them in on-screen order. The header checkbox selects or clears every run that passes the filters. Grouped, a group header's checkbox selects every listed run beneath it (nested groups included), or clears them when all are selected; it shows – when some are. A bar with the selection's actions appears:

| Action | What it does |
|---|---|
| **Clear** | Deselect all. |
| **Tag** | The bulk tag editor: add a tag to every selected run, or remove a tag from all runs that have it. |
| **Show in workspace** | Open the [project workspace](project-workspace.md) with exactly the selected runs visible. |
| **Export** | Download the selected runs as `cairn_export_<date>.zip`. |
| **Stop** | Ask the selected *running* runs to stop (asks first). See [Run lifecycle](../guides/runs.md). |
| **Archive** / **Unarchive** | Archive or restore the selected runs. Archiving hides a run without changing its status; an archived run shows an `archived` mark beside it. |
| **Delete** | Delete the selected runs permanently (asks first). |

Export, Archive / Unarchive and Delete have command-line counterparts:
`cairn export-runs`, `cairn archive` / `cairn unarchive` and `cairn rm` (see
[Client commands](../guides/server.md#client-commands)).

### Tags on a row

The Tags column lists each run's tags. Click **+** to add a tag, with suggestions from the tags already in the project (++enter++ adds, ++escape++ cancels). Click a tag's × to remove it.

## Hide, pin and baseline

Hover a run's name to show three toggles (on touch devices they are always visible):

| Toggle | Effect |
|---|---|
| Eye | **Hide from charts**: the run is left out of every card. In the table its row is dimmed, not removed. |
| Pin | **Pin**: listed first in the table and drawn first in charts. |
| Flag | **Set as baseline**: one run per project. Other runs show deltas against it. |

Toggles that are on stay visible after the name. These three settings are the project's *run view*, shared by the table and the run page. It is stored in your browser, per project, and synced between open tabs. Report cells each keep their own run view.

### Deltas against the baseline

With a baseline set, each numeric cell of another run shows `value − baseline` next to the value (Duration excepted). The tooltip also gives the relative change. The baseline counts even when a filter hides it. Deltas are coloured green (better) or red (worse) when the column has a *goal*:

- a metric column has its metric's goal in the project: a project override, else the direction of its `summary=` rule (`min` means lower is better, `max` higher). See [Project overrides](../guides/metric-rules.md#project-overrides).
- a computed column has the goal of the one metric its expression reads (`min(val.loss) * 100` is lower-is-better when `val.loss` is). An expression over several metrics has none.
- config columns have no goal.

Without a goal a delta is shown uncoloured.

## Run colours

The dot before each name is the run's colour. The colour is derived from the run id; nothing is stored. There are 10 hues in a light and a dark shade. Among the runs shown together, older runs keep their preferred hue and newer ones move to a free hue, so the first 10 runs always get 10 different hues. Colours repeat after 20 runs. A run keeps the same colour everywhere unless an older run in the same view takes its hue.

**Colour by value** is a workspace setting (`prefs.colorBy`), edited from the workspace toolbar. It colours runs on the run page and in the project workspace by an expression's value, bucketed into 2–8 colours of a palette. The runs table keeps the id-derived colours. See [Run page and workspace](workspace.md).

## Where the table's state is kept

The filter tree, group-by levels, sort keys, column order, hidden and pinned columns and computed columns are saved in your browser per project, and restored when you come back. The status filter, search and **Latest only** are not saved. None of this is part of the server-side workspace views. Table edits are not on the [undo](shortcuts.md) stack.
