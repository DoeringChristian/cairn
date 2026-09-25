# Runs table

The runs table (`/p/<project>`) lists a project's runs, newest first. Use it to find runs, add metric, config and computed columns, and send a selection to a [comparison](comparisons.md).

Runs load 100 at a time as you scroll. While a filter or a group-by is active, the table loads every page, so matches outside the first page are not missed. The header shows `<shown> of <total> runs`.

## Toolbar

| Control | What it does |
|---|---|
| **Status** | Show only runs with one status (`running`, `completed`, `failed`, `killed`, `stopped`, `archived`). With **All**, archived runs are hidden. |
| **Search** | A case-insensitive regex over each run's name, id, status and tags. An invalid regex turns the box red. |
| Filter chips, **Filter** | The [filter tree](#filters). |
| **Group** | [Nested group-by](#group-by). |
| **Latest only** | Keep only the newest run of each name. |
| **Columns** | The [column manager](#columns). The button shows `(+N ƒ)` when you have N computed columns. |
| Sort summary | With more than one sort key, lists them; × removes one. |
| Run view summary | With runs hidden or pinned, or a baseline set, shows e.g. `2 hidden · 1 pinned · baseline <name>`; **reset** clears all three. |
| **Archive old** / **Delete old** | For each run name with several runs, archive or delete all but the newest (archived runs are left out). Both ask first. |
| **New comparison** | Create an empty comparison and open it. |
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
- The column menu (⋮ on the header) also has **Sort ascending**, **Sort descending** and **Add to sort** / **Remove from sort**.

Runs without a value sort last in both directions. Numbers sort numerically, text in natural order (`run-2` before `run-10`), and numbers come before text in a mixed column. Ties are broken by run id, so the order is stable. [Pinned runs](#hide-pin-and-baseline) always come first, in sorted order.

## Group by

Click **Group** to add levels. Each level splits its parent group by one of:

- `group` or `job_type` (the run fields);
- `tag`: a run with several tags appears under each of them;
- `param: <key>`: a config value;
- **expression…**: a scalar [expression](../reference/expressions.md), e.g. `min(val.loss) < 0.3`.

Levels nest in order (`by …`, `then …`); reorder them with ↑/↓ and remove one with ×. Groups are ordered by value, and runs with no value go last as `(none)`. Each group header shows its run count; click it to collapse or expand it. Changing the group-by expands every group again.

## Columns

| Kind | Column | Contents |
|---|---|---|
| Built-in | Name, Status, Created, Duration, Tags | Run fields. Duration runs up to now for an unfinished run. |
| Metric | the metric or summary key | The run's value: the metric's last point, replaced by its `summary=` rule if it has one, replaced by an explicit `run.summary()` key of the same name. See [Final values and metric rules](../guides/metric-rules.md). |
| Config | the config key | A config value. |
| Computed | the name or the expression | A scalar expression per run, see [below](#computed-columns). |

Metric and config columns are the union over the loaded runs: a run that never logged `val.acc` shows a blank cell, and the column stays.

- **Name is frozen** on the left, cannot be hidden or moved, and always comes first.
- **Pin** a column (header menu → **Pin (freeze left)**, or the pin icon in the column manager) to freeze it after Name, in pin order. The rest scroll horizontally.
- **Hide** a column from its header menu, or untick it in the column manager. The manager has a search box and **Hide all** / **Show all** for the matching columns.
- **Reorder** by dragging a header onto another, or with **Move left** / **Move right** in its menu. Pinned columns reorder among themselves, and scrolling columns among themselves.

New columns (a metric that appears later) are placed next to their natural neighbours.

### Computed columns

At the bottom of **Columns**, enter a scalar expression (e.g. `min(val.loss)`), an optional name and an optional *better* direction, and click **Add column**. The expression sees the same names as [filter expressions](#expressions). Edit or remove a computed column from its header menu (**Edit expression**, **Remove column**).

## Selecting runs

Tick a row's checkbox to select it; ++shift++-click another checkbox to select the range between them in on-screen order. The header checkbox selects or clears every run that passes the filters. A bar with the selection's actions appears:

| Action | What it does |
|---|---|
| **Clear** | Deselect all. |
| **Tag** | The bulk tag editor: add a tag to every selected run, or remove a tag from all runs that have it. |
| **Compare** | Create a comparison of the selected runs with one card per sequence (metric or media) that any of them logged, leaving out `system.*` and internal names, and open it. |
| **Empty comparison** | Create a comparison of the selected runs with no cards. |
| **Export** | Download the selected runs as `cairn_export_<date>.zip`. |
| **Stop** | Ask the selected *running* runs to stop (asks first). See [Run lifecycle](../guides/runs.md). |
| **Archive** / **Unarchive** | Archive or restore the selected runs. |
| **Delete** | Delete the selected runs permanently (asks first). |
| **From template** | Shown when the project has comparison templates: apply one to the selected runs. If no template card matches the runs, nothing is created and a message says so. |

### Tags on a row

The Tags column lists each run's tags. Click **+** to add a tag, with suggestions from the tags already in the project (++enter++ adds, ++escape++ cancels). Click a tag's × to remove it.

## Hide, pin and baseline

Hover a run's name to show three toggles (on touch devices they are always visible):

| Toggle | Effect |
|---|---|
| Eye | **Hide from charts**: the run is left out of every card. In the table its row is dimmed, not removed. |
| Pin | **Pin**: listed first in the table and drawn first in charts. |
| Flag | **Set as baseline**: one run per project. Other runs show deltas against it. |

Toggles that are on stay visible after the name. These three settings are the project's *run view*, shared by the table and the run page. It is stored in your browser, per project, and synced between open tabs. [Comparisons](comparisons.md) and report cells each keep their own run view.

### Deltas against the baseline

With a baseline set, each numeric cell of another run shows `value − baseline` next to the value (Duration excepted). The tooltip also gives the relative change. The baseline counts even when a filter hides it. Deltas are coloured green (better) or red (worse) when the column has a *better* direction:

1. the column's own setting: the **Better** row in its header menu (**auto** / **lower** / **higher**), or the direction chosen for a computed column;
2. otherwise, for a metric column, its `summary=` rule: `min` means lower is better, `max` higher. Other rules have no direction.

Config columns show deltas only once you pick a direction for them. Without a direction a delta is shown uncoloured.

## Run colours

The dot before each name is the run's colour. The colour is derived from the run id; nothing is stored. There are 10 hues in a light and a dark shade. Among the runs shown together, older runs keep their preferred hue and newer ones move to a free hue, so the first 10 runs always get 10 different hues. Colours repeat after 20 runs. A run keeps the same colour everywhere unless an older run in the same view takes its hue.

**Colour by value** is a workspace setting (`prefs.colorBy`), edited from the workspace toolbar. It colours runs on the run page and in comparisons by an expression's value, bucketed into 2–8 colours of a palette. The runs table keeps the id-derived colours. See [Run page and workspace](workspace.md).

## Where the table's state is kept

The filter tree, group-by levels, sort keys, column order, hidden and pinned columns, *better* overrides and computed columns are saved in your browser per project, and restored when you come back. The status filter, search and **Latest only** are not saved. None of this is part of the server-side workspace or its saved views. Table edits are not on the [undo](shortcuts.md) stack.
