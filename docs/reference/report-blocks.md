# Report blocks

A report is Markdown. Each fenced code block whose info string starts with the word `cairn` becomes a **cards cell**: one or more run sets plus a grid of cards drawn from their runs. Everything else is prose. This page is the reference for the YAML inside such a fence. For writing and editing reports, see [Reports](../ui/reports.md).

````markdown
## Validation

```cairn
runSets:
  - name: Training runs
    filter:
      kind: group
      op: and
      children:
        - { kind: chip, field: job_type, op: exact, arg: train }
        - { kind: chip, field: tags, op: contains, arg: prod }
    groupBy: [{ source: group }]
    latestOnly: true
  - name: Baseline
    filter: { kind: group, op: and, children: [{ kind: chip, field: display_name, op: exact, arg: baseline }] }
    latestOnly: true
title: Validation metrics
cards:
  - metric: val.loss
    settings: { yScale: log, smoothing: 0.6 }
  - metric: samples
    type: image
  - type: scatter
    settings:
      x: { src: config.lr }
      y: { src: min(val.loss) }
```
````

The fence is parsed as YAML without running any code. A malformed fence does not break the report. Its cell shows the error message, and the rest of the report renders normally. See [Errors](#errors).

## Top-level keys

| Key | Type | Meaning |
|---|---|---|
| `runSets` | list | The cell's run sets. The cards draw the union of their runs. See [`runSets`](#runsets). |
| `view` | mapping | Optional run view: `hidden`, `pinned`, `baseline`. See [`view`](#view). |
| `title` | string | Optional cell title. |
| `cards` | list | The cards, in order. See [`cards`](#cards). |
| `id` | string | The cell's id. The editor writes it so that the cell keeps its identity across edits. Leave it out when you write a fence by hand; a fresh id is assigned. |

An empty fence is valid and produces an empty cell.

## `runSets`

A run set is the runs table of the [workspace](../ui/workspace.md), frozen: its filter, grouping, **Latest only**, sort and eyes are stored in the report, and its runs are resolved live. When the report is opened, each set picks its runs from the project's 1000 newest runs exactly as the workspace's runs sidebar would with the same settings, so new matching runs appear without editing the report. Every key is optional:

| Key | Type | Default | Meaning |
|---|---|---|---|
| `name` | string | `Run set N` | Shown in the cell's **Runs** dialog. |
| `filter` | filter tree | no filter | The runs table's filter tree, see below. |
| `groupBy` | list | `[]` | Group-by levels: `{source: group}`, `{source: job_type}`, `{source: tag}`, `{source: param, key: lr}` or `{source: expr, expr: "config.lr * 10"}`. |
| `latestOnly` | bool | `false` | Only the newest run of each series (group, job type, name). |
| `sort` | list | newest first | Sort keys: `{column, direction}`, with `column` one of `name`, `status`, `created_at`, `duration`, `value:<metric>`, `param:<key>` and `direction` `asc` or `desc`. |
| `eyes` | mapping | `{}` | Explicit eyes, as in the workspace: `"r:<run id>": true/false` for a run, `"g:<group-by>:<value>": true/false` for a top-level group (for example `"g:group:exp-44": false`). |

Archived runs are never in a run set (they still count for **Latest only**). Without explicit eyes, a set shows the runs of its 10 newest top-level groups, or its 10 newest runs when it is not grouped, like the workspace. A run in several sets is drawn once. With more than one set, each set's runs are drawn in their own colour family (shades of one hue).

### The filter tree

A filter tree is a group: `{kind: group, op: and | or, children: [...]}`. A child is another group, a chip or an expression:

| Node | Example | Matches |
|---|---|---|
| chip | `{kind: chip, field: values.acc, op: gt, arg: "0.9"}` | `field op arg`. `field` is `display_name`, `status`, `tags`, `group`, `job_type`, `values.<metric>` (the runs table's value) or `params.<key>`. `op` is one of `exact`, `iexact`, `gt`, `gte`, `lt`, `lte`, `in` (comma-separated), `contains`, `icontains`, `startswith`, `endswith`, `isnull`. `arg` is a string, read as a number or boolean where it is one. |
| expression | `{kind: expr, expr: "min(val.loss) < 0.2 and config.opt == 'adam'"}` | the [expression](expressions.md) is true. An invalid expression constrains nothing. |

An empty group constrains nothing. The editor writes a cell of fixed runs (a section sent to a report, a template applied to picked runs) as a set with the expression `run.id in ["…", "…"]` and each run's eye on.

## `view`

| Key | Type | Meaning |
|---|---|---|
| `hidden` | list of run ids | Runs hidden from the cell's charts. |
| `pinned` | list of run ids | Runs drawn first, in this order. |
| `baseline` | run id | The run the others are compared against. |

These form the cell's **run view**. It works the same way as the runs table's run view (see [Runs table](../ui/runs-table.md)).

```yaml
view:
  pinned: [81b2d4…]
  baseline: 3f9c0a…
```

### Reports from before run sets

A fence with the old `runs:` key (`runs: {ids: [...]}` or `runs: {selector: ...}`) is not read: its cell shows empty with a notice. The fence is kept as written until you edit the cell; give the cell a run set to show runs again. There is no migration.

## `cards`

Each entry is a mapping and takes one of three forms.

### One metric across the runs

```yaml
- metric: train.loss      # the logged name
  type: scalar            # optional
  settings: { x: "step * 32" }
```

The card shows the metric for every run of the cell's run sets. `type` is the card type. If you leave it out, the cell infers it from how the metric was logged on its runs. Inference fails when no run has the metric, or when the name was logged as more than one kind (for example as both a scalar and an image); set `type` in those cases.

### A multi-run card

```yaml
- type: parallel
```

Leave out `metric`, and set `type` to one of the cards that summarise a set of runs: `parallel`, `scatter`, `bar`, `tile`, `importance`, `run-compare`, `code-diff`, `scalars` or `config`.

### An explicit overlay

```yaml
- type: scalar
  series:
    - { runId: 3f9c0a…, name: loss }
    - { runId: 81b2d4…, name: val.loss }
```

`series` lists (run, metric) pairs, so one card can overlay different metrics from different runs. `type` is required in this form.

### Card keys

| Key | Type | Meaning |
|---|---|---|
| `metric` | string | A metric name, for the one-metric form. |
| `type` | string | A card type (see below). |
| `series` | list of `{runId, name}` | The pairs for the explicit overlay form. |
| `settings` | mapping | This card's settings (see below). |
| `id` | string | The card's id. The editor writes it so that the card's settings stay attached when you change its metric or type. Optional when you write a fence by hand. |

**Card types:** `scalar`, `image`, `figure`, `audio`, `video`, `histogram`, `tensor`, `text`, `pointcloud`, `mesh`, `boxes3d`, `volume`, `preset`, `parallel`, `scatter`, `bar`, `tile`, `importance`, `run-compare`, `code-diff`, `scalars`, `config`, `table`, `html`, `markdown`, `artifact`. See [Cards](../ui/cards.md) for what each one shows.

### `settings`

`settings` takes the keys that the card's settings panel stores. A key you leave out takes the card type's built-in default. Report cards ignore the project's workspace and section defaults, so a report looks the same to every reader. Some common keys:

| Card | Key | Example |
|---|---|---|
| `scalar` | `x`, an [expression](expressions.md) | `x: "step * 32"`, `x: relative_time`, `x: epoch` |
| `scalar` | `xScale`, `yScale` (`linear`, `log`) | `yScale: log` |
| `scalar` | `smoothing`, `smoothingKind` (`ema`, `twema`, `gaussian`, `window`) | `smoothing: 0.6` |
| `scalar` | `derived`: extra series computed by expressions | `derived: [{ src: "loss / step", label: "loss per step" }]` |
| `scalar` | `legend`, `tooltip`, with [templates](expressions.md#templates) | `legend: { show: true, position: bottom, template: "${run.name}" }` |
| `scatter` | `x`, `y`, `color`: scalar expressions | `x: { src: config.lr }` |
| `scatter` | `labelTemplate` | `labelTemplate: "${run.name} lr=${config.lr}"` |
| `bar`, `tile` | `metric`: a scalar expression | `metric: { src: "last(val.acc)" }` |
| `tile` | `reduce` (`best`, `mean`, `latest`), `bestDir` (`max`, `min`) | `reduce: mean` |

When you change a card's settings in the report editor, the editor writes them back into the fence on the next save.

## Errors

The cell shows the parser's message. Common ones:

| Problem | Message |
|---|---|
| The fence is not a YAML mapping | ``a ```cairn block must be a YAML mapping with `runSets`/`view`/`title`/`cards` keys`` |
| `runSets` is not a list | `` `runSets` must be a list of run sets `` |
| A run set is not a mapping | `runSets[0] must be a mapping` |
| `type` cannot be inferred | ``cards[0]: cannot infer `type` for metric "…" — no matching sequence found on this block's runs; specify `type` explicitly`` |
| One name logged as several kinds | ``cards[0]: metric "…" is ambiguous (found as scalar, image) — specify `type` explicitly`` |
| No metric, series or multi-run type | ``cards[0]: specify a `metric`, an explicit `series`, or a multi-run `type` (one of parallel/scatter/bar/tile/importance/run-compare/code-diff/scalars/config)`` |
| An overlay without a type | `` cards[0]: an explicit `series` overlay requires `type` `` |

Type inference needs each run's list of logged metrics. When the report opens before those lists have loaded, the cell waits and compiles the fence again once they arrive. The recompiled cell is displayed straight away, but it is only saved when you edit the cell.

## JSON Schema

cairn-ui ships a generated JSON Schema, `docs/schemas/cairn-card-spec.schema.json`, with a matching set of pydantic models in `cairn_ui.cards.spec`. The schema describes the card shape the editor stores, in which `id`, `type` and `series` are all required. It does not cover the short forms on this page: it has no `metric` key. Its `RunSetSpec` describes a run set. For hand-written fences, follow this page.
