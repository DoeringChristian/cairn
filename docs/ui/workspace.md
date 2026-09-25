# Run page and workspace

Click a run in the [runs table](runs-table.md) to open its run page at `/p/<project>/r/<run>`. The header shows the run's name and id, its status, how long it has run, and a **forked from** link when the run is a fork. While the run is `running`, a **Stop** button asks it to stop. The run sees the request on its next heartbeat (see [Run lifecycle](../guides/runs.md)).

## Tabs

| Tab | What it shows |
|---|---|
| **Overview** | Details (status, exit code, host, user), Git (remote, branch, commit, dirty flag, a link to the captured diff), tags and notes, params, CLI args, the environment snapshot, the final value of every metric (system metrics hidden behind a toggle), and artifacts. |
| **Metrics & Media** | The card grid: one card per logged series and per named artifact. These docs call this card grid the *workspace*. |
| **Logs** | Captured stdout/stderr. You can search and filter by stream. While the run is running, the view follows new lines. |
| **Source** | The source snapshot, when the run captured one. |
| **Environment** | The environment snapshot and `pip freeze`. |

## Sections and the card grid

The **Metrics & Media** tab groups cards into sections automatically:

- A metric whose name contains a dot goes into the section named by its prefix. For example, `train.loss` goes into **train**.
- A metric without a dot goes into **Charts**.
- Media go into **Media**: images, audio, video, figures, histograms, tensors, tables, 3D objects, volumes, HTML, Markdown and presets.
- Sections appear in this order: **Charts**, then your prefix sections A–Z, then **Media**, and **system** last.

Within a section, cards are sorted by name until you drag them. To reorder a card, hover its header and drag the grip that appears. The run page saves the new order for that run, in this browser only. Once a run has a saved layout, a **reset layout** link appears.

Section header controls:

| Control | Effect |
|---|---|
| ▼ (click the header) | Collapse or expand the section. Saved per run, in this browser only. |
| Gear | Edit [section defaults](#defaults-cascade). The gear is highlighted when the section has defaults. |
| A–Z | Sort the section's cards by name. This overrides the manual order and disables dragging. |
| Pin | Move the section to the top. Pinned sections stay in the order you pinned them. |
| Send to report | Copy every card of the section into a new [report](reports.md) and open it. |

Card controls:

- **Resize:** drag the bottom-right handle. Height changes freely; width snaps to a 6-column grid.
- **Rename:** double-click the title or click the pencil.
- **Collapse:** click the chevron.
- **Remove:** click ×. This hides the card on every run of the project. The **N hidden · manage** link lists hidden cards so you can bring them back.

!!! note "What is stored where"
    **In the project workspace** (on the server, shared by everyone who uses the project):

    - hidden cards and hide patterns
    - section pins and sorting
    - workspace and section defaults
    - custom panels
    - prefs: sync zoom and colour by

    **In this browser only:**

    - each card's own setting overrides, per run and metric name
    - card order within sections
    - collapsed sections

    Two tabs or users can edit the workspace at the same time. If one write loses the race, it is replayed on top of the other one's changes, so neither edit is lost.

A scalar series with a single point shows as a plain value card, not a one-dot chart. It becomes a line plot once a second point arrives.

## Workspace toolbar

The toolbar appears above the cards on the run page and on [comparisons](comparisons.md).

### Search

Press ++cmd+k++ (macOS) or ++ctrl+k++ to focus **Search panels**. The query is a case-insensitive regular expression that can match anywhere in a card's name, so `val\.` finds `val.loss`. If the query is not a valid regex, it is matched as plain text and the box turns red. Press ++escape++ to clear it.

### Hide matching

While a search is active, **Hide N matching** saves the query as a hide pattern in the workspace. Matching cards then disappear on every run of the project. Each pattern shows as a `/pattern/` chip; click its × to show the cards again.

### Build panels

**Build panels** creates line plots from a regex over scalar metric names:

- The regex must match the whole name and is case-sensitive.
- Metrics whose capture groups have the same values share a panel. The panel's title is those values joined by `·`.
- Without capture groups, every match goes onto one panel.

Examples:

- `(train|val)\.loss` builds one panel per split.
- `.*\.(loss)` builds one panel with every loss.
- `.*\.(loss|acc)` builds one panel with the losses and one with the accuracies.

The popover lists the panels before you add them. On the run page, they go into a **Custom panels** section that every run of the project shows. On a comparison, they are added as cards.

### Colour by

**Colour by** colours every run by the value of a scalar [expression](../reference/expressions.md), such as `config.lr`, `min(val.loss)` or `run.group`:

- **Numbers** fall into 2–8 evenly spaced buckets between the lowest and highest run.
- **Text** gets one colour per value.

Pick the Turbo, Viridis or Magma palette. A legend next to the search box shows the expression and the colour of each bucket. **Clear** restores the default colours, which come from each run's id. The setting is saved in the workspace.

### Sync zoom

The link toggle makes charts that share an x-axis zoom together.

### Views

**Views** saves the current workspace document under a name. A view contains:

- hidden cards and hide patterns
- pinned and sorted sections
- defaults
- custom panels
- prefs
- on a run page, also that run's card layout

Applying a view replaces the workspace, and on a run page also that run's layout. You can undo it with ++cmd+z++. The trash icon deletes a view.

On read-only surfaces, such as report viewers and share links, the toolbar shows only the search box.

## Defaults cascade

Each card setting resolves through these layers, highest first:

1. **Card:** the card's own override.
2. **Instance:** what the card was created with. This is its metric, or the x-axis you gave with `run.track(..., x=...)`.
3. **Section:** set with the section's gear.
4. **Workspace:** set on the **Defaults** page (`/p/<project>/defaults`, the **Defaults** link in the project navigation).
5. **Built-in:** the card type's default value.

Only some settings take section and workspace defaults: smoothing, axis scales, the legend, the slider key, and similar per-type settings. Other settings (the metrics shown, title, size, zoom) resolve card → instance → built-in. In a defaults editor, pick a card type to get that type's settings panel, limited to the settings that take defaults. The card types are listed in [Cards](cards.md).

A card saves only its overrides. If you set a value equal to what the card would inherit anyway, the override is removed.

- **↺** appears next to a setting while it is overridden at the level you are editing. Click it to go back to the inherited value.
- **Reset workspace defaults** or **Reset section defaults** clears every default for the chosen card type at that level.

Reports and share links ignore workspace and section defaults and use the built-in values.

## Undo and redo

Each project has one undo stack. It records:

- card setting changes
- resizes (one drag is one step)
- card moves and layout resets
- every workspace edit: hide, pin, sort, defaults, panels, colour by, views

Undo with ++cmd+z++ / ++ctrl+z++ and redo with ++cmd+shift+z++ / ++ctrl+shift+z++. These shortcuts do nothing while a text field has focus, because the field keeps its own typing undo. The stack holds 200 steps.

Undoing a workspace edit restores only the fields that edit changed, so changes another tab made in the meantime survive. See also [Keyboard shortcuts](shortcuts.md).

## Full-screen card and settings

The gear on a card opens the card full screen, with its settings panel beside it. On a phone, the card and the settings are two tabs.

- Press ++arrow-left++ / ++arrow-right++, or use the arrow buttons next to the title, to step to the previous or next card in page order. Arrow keys that belong to a focused control, such as a slider or select, don't navigate.
- Press ++escape++ or click × to close.

The settings panel has up to four tabs: **Data**, **Grouping**, **Display** and **Expressions**. Tabs a card doesn't use are hidden, and a card with only one tab shows no tab bar. [Cards](cards.md) lists each card's settings.

## Touch devices

On a touch screen, a card starts out non-interactive, so a drag over it scrolls the page. To pan or zoom a card's content, tap the hand button in its header. The full-screen view is always interactive. On touch devices, the card's ⋯ menu has **Move up** / **Move down** in place of drag-to-reorder.
