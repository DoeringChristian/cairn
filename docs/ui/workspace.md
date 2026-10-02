# Run page and workspace

Click a run in the [runs table](runs-table.md) to open its run page at `/p/<project>/r/<run>`. The header shows the run's name and id, its status, how long it has run, and a **forked from** link when the run is a fork. While the run is `running`, a **Stop** button asks it to stop. The run sees the request on its next heartbeat (see [Run lifecycle](../guides/runs.md)).

## Tabs

| Tab | What it shows |
|---|---|
| **Overview** | Details (status, exit code, host, user), Git (remote, branch, commit, dirty flag, a link to the captured diff), tags and notes, params, CLI args, the environment snapshot, the final value of every metric (system metrics hidden behind a toggle), and artifacts. |
| **Metrics & Media** | The project [workspace](#workspaces), bound to this run: sections of panels, one per logged series and named artifact unless you arrange them otherwise. |
| **Logs** | Captured stdout/stderr. You can search and filter by stream. While the run is running, the view follows new lines. |
| **Source** | The source snapshot, when the run captured one. |
| **Environment** | The environment snapshot and `pip freeze`. |

## Workspaces

The **Metrics & Media** tab shows the project's **workspace**: a layout of named sections holding panels, bound to the run you are viewing. The layout is written in metric names, never in runs, so it is the same on every run of the project. Switching runs changes only the data.

Every [comparison](comparisons.md) is a workspace too, with its own layout bound to its own runs. The run page and comparisons render the same page: the same toolbar, sections, panels and dialogs, including the [card builder](#card-builder).

A panel has a card type (see [Cards](cards.md)), a metric selector and its settings (title, size, smoothing, axes and so on). The selector is either:

- one or more metric names (`val.loss`, or `train.loss` and `val.loss` on one line plot), or
- a regular expression matched against the whole metric name (`val\..*`). The panel shows whatever the bound runs log that matches, so a new matching metric joins it.

### Automatic panels

You don't have to build a layout. Every metric that no panel shows gets an **automatic panel** of its type, grouped into sections:

- A metric whose name contains a dot goes into the section named by its prefix. For example, `train.loss` goes into **train**.
- A metric without a dot goes into **Charts**.
- Media go into **Media**: images, audio, video, figures, histograms, tensors, tables, 3D objects, volumes, HTML, Markdown and presets.
- Automatic sections appear in this order after the layout's own sections: **Charts**, your prefix sections A–Z, **Media**, and **system** last. When a layout section has the same name, the automatic panels join it after its own panels.

A panel whose selector names exactly one metric stands in for that metric's automatic panel. Panels over several metrics or a regex are extra views: the metrics they show keep their own panels. So are the multi-run cards (value, bar chart, scatter, …) the card builder makes from a series: they read it through an expression in their settings, and the series keeps its own panel. Any number of panels may show the same series.

When you change an automatic panel in any way (a setting, its size, its type, its position, a duplicate), it becomes part of the layout. The panels before it in its section are written with it, so nothing on the page moves. From then on it is an ordinary panel.

### Include unlisted metrics

**Unlisted metrics: on / off** in the toolbar decides whether metrics no panel shows get automatic panels. It is a setting of each workspace: the run page and every comparison have their own (a new comparison copies the run page's along with the rest of the layout), and a saved [view](#views) stores it.

- **On** (the default): every metric gets a panel, as described above.
- **Off**: only the layout's own panels show. Turning it off first writes every automatic panel on screen into the layout, so nothing disappears; what changes is that metrics logged afterwards don't get a panel. **N series without a card · manage** above the sections counts them, and [Manage cards](#manage-cards) lists them, each with a **Show** button that adds its panel. Panels a hide pattern hides at that moment are not written, so they behave like a metric logged later.
- Turning it back on brings automatic panels back for every metric no panel shows.

### Editing the layout

Every edit changes the workspace, so it applies to every run the workspace shows:

| Edit | How |
|---|---|
| Remove a panel | × in its header. An automatic panel stays removed; [Manage cards](#manage-cards) lists removed panels so you can show them again. |
| Change settings | The gear opens the card full screen with its settings (see below). The title, collapse chevron and resize handle edit the panel too. |
| Resize | Drag the bottom-right handle. Height changes freely; width snaps to a 6-column grid. |
| Change data, type, settings or section | **Edit card** (pencil on a box) in the header opens the [card builder](#card-builder) on the card. |
| Duplicate | **Duplicate card** (two squares) in the header copies the card — its data, type and settings — right after itself. Change the copy's type or settings afterwards to see the same data two ways. |
| Reorder | Hover the header and drag the grip onto another panel, in the same section or another one. On touch screens, use **Move up** / **Move down** in the ⋯ menu. |
| Add cards | **+** in a section header, or **Add cards** in the toolbar: the [card builder](#card-builder). |
| Hide, show, move, delete | [Manage cards](#manage-cards). |
| Add a section | **+ Section** in the toolbar. |

A panel whose metrics the bound runs don't log shows an empty state ("This run does not log this metric") instead of disappearing, so the layout holds still while you switch runs. Multi-run panels (run comparer, code diff, scatter plot, parallel coordinates, parameter importance) need at least two runs: on the run page they say so, and they come alive in a comparison. Bar charts and scalar tiles work with one run.

Section header controls:

| Control | Effect |
|---|---|
| ▼ (click the header) | Collapse or expand the section. |
| Double-click the name | Rename the section. |
| **+** | Add cards to this section (the [card builder](#card-builder)). |
| Gear | Edit [section defaults](#defaults-cascade). The gear is highlighted when the section has defaults. |
| A–Z | Show the section's panels sorted by title. This overrides the manual order and disables dragging. |
| ↑ / ↓ | Move the section up or down. |
| Send to report | Copy the section's panels, for the runs on screen, into a new [report](reports.md) and open it. |
| Trash | Delete the section. Only shown while it has no panels. |

A scalar series with a single point shows as a plain value card, not a one-dot chart. It becomes a line plot once a second point arrives.

### Card builder

The card builder adds cards to a workspace, edits one, and manages them all. Open it with **+** on a section, **Add cards** or **Manage cards** in the toolbar, or **Edit card** on a card. The goal is to look at one piece of data through several cards: the same `loss` as a line chart, a value and a bar chart side by side, or two image cards of `samples` with different settings.

Adding takes four steps. The step bar at the top goes back to any step you have reached.

1. **Data.** Every series the bound runs log, grouped like the automatic sections (Charts, prefixes, Media, system), each with its kind (`scalar`, `image`, …), how many runs log it, and how many cards already show it (hover for their names). Pick:
    - **Series**: tick one or several; they show as chips above the list. The search box filters by name (a case-insensitive regex).
    - **Regex**: a regular expression over the whole name, with the live list of what it matches. The card follows the pattern, so a matching series logged later joins it.
    - **Whole runs**: no series, for cards that compare runs (run comparer, code diff) or that you set up in their settings.
2. **Card type.** Only the types that can show the data are listed:
    - a series of a kind gets that kind's card (image → image card, histogram → histogram card, …);
    - scalars also offer **Value** (one number: the last value, reduced across runs), **Bar chart**, **Scatter** (one or two series), **Parallel coordinates** and **Parameter importance**, which read the last value of each run (`last(loss)`); edit the expression in their settings for `min(loss)` and the like;
    - cards that need more runs than the workspace binds stay listed with **needs 2+ runs**: on the run page that is scatter, parallel coordinates, importance, run comparer and code diff. Add them in a [comparison](comparisons.md).

    Tick one or more types. The type under the pointer shows a live preview on the bound runs.
3. **Configure.** One tab per new card: its live preview beside its own settings panel (the same panel its gear opens) and its title. The two-squares button on a tab adds another card of that type with its own settings; × drops one.
4. **Place.** The section, an existing one or a new one, and every card's title. **Add N cards** writes them.

Editing a card opens the builder on **Configure** with the card's data, type and settings. Change its data or its type in the earlier steps (a type change keeps the title and size), then **Save card**. Nothing is written until you add or save.

### Manage cards

**Manage cards** (in the toolbar, or the second tab of the card builder) lists every card of the workspace by section, with what it is:

| Status | Meaning | Actions |
|---|---|---|
| shown | A panel of the layout. | Hide, edit, duplicate, move, delete. |
| automatic | An automatic panel. | Hide (it becomes removed), edit, duplicate, move (these write it into the layout). |
| hidden | A panel of the layout you hid: it keeps its place, settings and claim on its metric, but doesn't render. | Show, edit, duplicate, move, delete. |
| removed | An automatic panel you removed. | Show. |
| not shown | With unlisted metrics off, a series no panel shows. | Show (adds its panel). |

A **pattern** mark means a toolbar hide pattern hides the card. Filter the list by name or status; the **Include unlisted metrics** box is the toolbar toggle. Editing a card from the list returns to the list when you save.

!!! note "What is stored where"
    **In the workspace** (on the server, shared by everyone who uses the project): sections and their order, collapsed and sorted state; panels with their type, metrics, settings, size and hidden flag; removed automatic panels; whether unlisted metrics get automatic panels; hide patterns; workspace and section defaults; prefs (sync zoom, colour by). A comparison's workspace also holds its runs and their hide / pin / baseline toggles.

    **In this browser only:** the run page's and runs table's hidden, pinned and baseline runs.

    Two tabs or users can edit a workspace at the same time. If one write loses the race, it is replayed on top of the other one's changes, so neither edit is lost.

    A user with a read-only token sees the same page but cannot change the layout: there is no card builder, **Manage cards**, **Edit card**, **Duplicate card** or unlisted-metrics toggle. Card settings they change (zoom, collapse, smoothing) last until they reload.

## Workspace toolbar

The toolbar appears above the sections on the run page and on [comparisons](comparisons.md).

### Search

Press ++cmd+k++ (macOS) or ++ctrl+k++ to focus **Search panels**. The query is a case-insensitive regular expression that can match anywhere in a panel's title (for an untitled panel, its metric names), so `val\.` finds `val.loss`. If the query is not a valid regex, it is matched as plain text and the box turns red. Press ++escape++ to clear it.

### Hide matching

While a search is active, **Hide N matching** saves the query as a hide pattern in the workspace. Matching panels then disappear for every run the workspace shows. Each pattern shows as a `/pattern/` chip; click its × to show the panels again.

### Add cards and Manage cards

**Add cards** opens the [card builder](#card-builder); its new cards go to a **Custom panels** section unless you pick another. **Manage cards** opens the [list of every card](#manage-cards).

### Unlisted metrics

**Unlisted metrics: on / off** — see [Include unlisted metrics](#include-unlisted-metrics).

### Build panels

**Build panels** creates line plots from a regex over scalar metric names:

- The regex must match the whole name and is case-sensitive.
- Metrics whose capture groups have the same values share a panel. The panel's title is those values joined by `·`.
- Without capture groups, every match goes onto one panel.

Examples:

- `(train|val)\.loss` builds one panel per split.
- `.*\.(loss)` builds one panel with every loss.
- `.*\.(loss|acc)` builds one panel with the losses and one with the accuracies.

The popover lists the panels before you add them. They go into a **Custom panels** section at the top of the workspace (created when needed); from there they are ordinary panels.

### New comparison

On the run page, **New comparison** creates a [comparison](comparisons.md) of this run, starting from a copy of the workspace's layout, and opens it.

### Colour by

**Colour by** colours every run by the value of a scalar [expression](../reference/expressions.md), such as `config.lr`, `min(val.loss)` or `run.group`:

- **Numbers** fall into 2–8 evenly spaced buckets between the lowest and highest run.
- **Text** gets one colour per value.

Pick the Turbo, Viridis or Magma palette. A legend next to the search box shows the expression and the colour of each bucket. **Clear** restores the default colours, which come from each run's id. The setting is saved in the workspace.

### Sync zoom

The link toggle makes charts that share an x-axis zoom together.

### Views

**Views** saves the current layout under a name: sections, panels and their settings, hidden and removed panels, hide patterns, defaults, prefs, and whether unlisted metrics get automatic panels. The **Include unlisted metrics** box in the save form starts at the workspace's setting; untick it to save a view of only listed cards (the automatic cards shown now are saved as cards, as when you turn the toggle off). The list marks each view **+ unlisted** or **listed only**, and applying a view applies its setting too. Views belong to the project and work in any workspace: applying one on the run page or in a comparison replaces that workspace's layout. A comparison keeps its runs. You can undo it with ++cmd+z++. The trash icon deletes a view.

On read-only surfaces, such as report viewers and share links, the toolbar shows only the search box.

## Defaults cascade

Each card setting resolves through these layers, highest first:

1. **Card:** the card's own override.
2. **Instance:** what the card was created with. This is its metric, or the x-axis you gave with `run.track(..., x=...)`.
3. **Section:** set with the section's gear.
4. **Workspace:** for the run page, set on the **Defaults** page (`/p/<project>/defaults`, the **Defaults** link in the project navigation). A comparison copies these when it is created and keeps its own afterwards; edit them through its section gears.
5. **Built-in:** the card type's default value.

Only some settings take section and workspace defaults: smoothing, axis scales, the legend, the slider key, and similar per-type settings. Other settings (the metrics shown, title, size, zoom) resolve card → instance → built-in. In a defaults editor, pick a card type to get that type's settings panel, limited to the settings that take defaults. The card types are listed in [Cards](cards.md).

A card saves only its overrides. If you set a value equal to what the card would inherit anyway, the override is removed.

- **↺** appears next to a setting while it is overridden at the level you are editing. Click it to go back to the inherited value.
- **Reset workspace defaults** or **Reset section defaults** clears every default for the chosen card type at that level.

Reports and share links ignore workspace and section defaults and use the built-in values.

## Undo and redo

Each project has one undo stack. It records every workspace edit, on the run page and in comparisons:

- card setting changes
- resizes (one drag is one step)
- card adds, duplicates, moves, hides, removals and edits
- turning unlisted metrics on or off
- section edits, hide patterns, defaults, colour by, views

Undo with ++cmd+z++ / ++ctrl+z++ and redo with ++cmd+shift+z++ / ++ctrl+shift+z++. These shortcuts do nothing while a text field has focus, because the field keeps its own typing undo. The stack holds 200 steps.

Undoing a workspace edit restores only the parts of the workspace that edit changed (its sections and panels, removed panels, the unlisted-metrics setting, hide patterns, defaults, prefs or runs), so changes another tab made to the other parts in the meantime survive. See also [Keyboard shortcuts](shortcuts.md).

## Full-screen card and settings

The gear on a card opens the card full screen, with its settings panel beside it. On a phone, the card and the settings are two tabs.

- Press ++arrow-left++ / ++arrow-right++, or use the arrow buttons next to the title, to step to the previous or next card in page order. Arrow keys that belong to a focused control, such as a slider or select, don't navigate.
- Press ++escape++ or click × to close.

The settings panel has up to four tabs: **Data**, **Grouping**, **Display** and **Expressions**. Tabs a card doesn't use are hidden, and a card with only one tab shows no tab bar. [Cards](cards.md) lists each card's settings.

## Touch devices

On a touch screen, a card starts out non-interactive, so a drag over it scrolls the page. To pan or zoom a card's content, tap the hand button in its header. The full-screen view is always interactive. On touch devices, the card's ⋯ menu has **Move up** / **Move down** in place of drag-to-reorder.
