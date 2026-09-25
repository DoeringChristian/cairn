# Report blocks

A report is Markdown. Each fenced code block whose info string starts with the word `cairn` becomes a **cards cell**: a set of runs plus a grid of cards drawn from them. Everything else is prose. This page is the reference for the YAML inside such a fence. For writing and editing reports, see [Reports](../ui/reports.md).

````markdown
## Validation

```cairn
runs:
  selector: { mode: newest-per-name, namePattern: "train-*", tags: [prod], n: 5 }
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
| `runs` | mapping | Which runs the cell shows. See [`runs`](#runs). |
| `title` | string | Optional cell title. |
| `cards` | list | The cards, in order. See [`cards`](#cards). |
| `id` | string | The cell's id. The editor writes it so that the cell keeps its identity across edits. Leave it out when you write a fence by hand; a fresh id is assigned. |

An empty fence is valid and produces an empty cell.

## `runs`

Give **either** `ids` **or** `selector`, not both.

| Key | Type | Meaning |
|---|---|---|
| `ids` | list of run ids | A fixed set of runs. |
| `selector` | mapping | A live query over the project's runs. See [Run selectors](#run-selectors). |
| `hidden` | list of run ids | Runs hidden from the cell's charts. |
| `pinned` | list of run ids | Runs drawn first, in this order. |
| `baseline` | run id | The run the others are compared against. |

`hidden`, `pinned` and `baseline` form the cell's **run view**. It works the same way as the run view of a [comparison](../ui/comparisons.md).

```yaml
runs:
  ids: [3f9c0a…, 81b2d4…, c07e19…]
  pinned: [81b2d4…]
  baseline: 3f9c0a…
```

### Run selectors

A selector picks runs from the project's 500 newest runs by name and tags:

| Key | Type | Meaning |
|---|---|---|
| `mode` | `latest-n` or `newest-per-name` | Required. `latest-n` picks the N most recently created matching runs. `newest-per-name` picks the newest matching run for each distinct run name. |
| `namePattern` | string | Optional. Without `*`, a case-insensitive substring of the run name. With `*`, a case-insensitive pattern that must match the whole name, where `*` matches any text. |
| `tags` | list of strings | Optional. The run must carry every one of these tags. |
| `n` | number | Optional cap on the number of runs. `latest-n` defaults to 5. `newest-per-name` has no cap unless you set `n`. |

| Selector | Picks |
|---|---|
| `{ mode: latest-n }` | the 5 newest runs |
| `{ mode: latest-n, namePattern: TRAIN, n: 10 }` | the 10 newest runs whose name contains `train` (any case) |
| `{ mode: latest-n, namePattern: "train-*" }` | the 5 newest runs whose name starts with `train-` |
| `{ mode: newest-per-name, tags: [prod] }` | the newest `prod`-tagged run of each name |

!!! warning "Only `*` is a wildcard"
    In a pattern that contains `*`, every other character is literal except `?`, which keeps its regular-expression meaning (it makes the preceding character optional). Avoid `?` in patterns.

A selector's run set is live. The cell resolves it again when the report is opened and when the browser window regains focus, so new matching runs appear without editing the report. A [share link](../ui/sharing.md) resolves it the same way.

## `cards`

Each entry is a mapping and takes one of three forms.

### One metric across the runs

```yaml
- metric: train.loss      # the logged name
  type: scalar            # optional
  settings: { x: "step * 32" }
```

The card shows the metric for every run of the cell. `type` is the card type. If you leave it out, the cell infers it from how the metric was logged on its runs. Inference fails when no run has the metric, or when the name was logged as more than one kind (for example as both a scalar and an image); set `type` in those cases.

### A multi-run card

```yaml
- type: parallel
```

Leave out `metric`, and set `type` to one of the cards that summarise a set of runs: `parallel`, `scatter`, `bar`, `tile`, `importance`, `run-compare` or `code-diff`.

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

**Card types:** `scalar`, `image`, `figure`, `audio`, `video`, `histogram`, `tensor`, `text`, `pointcloud`, `mesh`, `boxes3d`, `volume`, `preset`, `parallel`, `scatter`, `bar`, `tile`, `importance`, `run-compare`, `code-diff`, `table`, `html`, `markdown`, `artifact`. See [Cards](../ui/cards.md) for what each one shows.

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
| The fence is not a YAML mapping | ``a ```cairn block must be a YAML mapping with `runs`/`title`/`cards` keys`` |
| Both `ids` and `selector` | ``runs: specify only one of `ids` or `selector`, not both`` |
| Bad selector mode | `runs.selector.mode must be "latest-n" or "newest-per-name"` |
| `type` cannot be inferred | ``cards[0]: cannot infer `type` for metric "…" — no matching sequence found on this block's runs; specify `type` explicitly`` |
| One name logged as several kinds | ``cards[0]: metric "…" is ambiguous (found as scalar, image) — specify `type` explicitly`` |
| No metric, series or multi-run type | ``cards[0]: specify a `metric`, an explicit `series`, or a multi-run `type` (one of parallel/scatter/bar/tile/importance/run-compare/code-diff)`` |
| An overlay without a type | `` cards[0]: an explicit `series` overlay requires `type` `` |

Type inference needs each run's list of logged metrics. When the report opens before those lists have loaded, the cell waits and compiles the fence again once they arrive. The recompiled cell is displayed straight away, but it is only saved when you edit the cell.

## JSON Schema

cairn-ui ships a generated JSON Schema, `docs/schemas/cairn-card-spec.schema.json`, with a matching set of pydantic models in `cairn_ui.cards.spec`. The schema describes the card shape the editor stores, in which `id`, `type` and `series` are all required. It does not cover the short forms on this page: it has no `metric` key, and its selector requires a `kind` key that the fence does not use. For hand-written fences, follow this page.
