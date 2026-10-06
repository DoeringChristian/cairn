# Run page and workspace

Click a run in the [runs table](runs-table.md) to open its run page at `/p/<project>/r/<run>`. The header shows the run's name and id, its status, how long it has run, and a **forked from** link when the run is a fork. While the run is `running`, a **Stop** button asks it to stop. The run sees the request on its next heartbeat (see [Run lifecycle](../guides/runs.md)).

## Tabs

| Tab | What it shows |
|---|---|
| **Overview** | Details (status, exit code, host, user), Git (remote, branch, commit, dirty flag, a link to the captured diff), tags and notes (rendered as [Markdown](../guides/media.md#markdown); hover them and click **edit** to change them), the config as logged (a collapsible tree), CLI args, the environment snapshot, the final value of every metric (system metrics hidden behind a toggle), and artifacts. |
| **Metrics & Media** | The project's current [workspace view](#workspace-views), bound to this run: sections of panels, one per logged series and named artifact unless you arrange them otherwise. |
| **Logs** | Captured stdout/stderr. You can search and filter by stream. While the run is running, the view follows new lines. |
| **Source** | The source snapshot, when the run captured one. |
| **Environment** | The environment snapshot and `pip freeze`. |

## Workspaces

The **Metrics & Media** tab shows a **workspace**: a layout of named sections holding panels, bound to the run you are viewing. The layout is written in metric names, never in runs, so it is the same on every run of the project. Switching runs changes only the data.

On the run page the workspace is one of the project's [workspace views](#workspace-views). Every [comparison](comparisons.md) is a workspace too, with its own layout bound to its own runs. The run page and comparisons render the same page: the same toolbar, sections, panels and dialogs, including [adding cards](#adding-cards).

### Workspace views

A project has a list of **views**, each a complete layout: sections, panels and their settings, hidden and removed panels, hide patterns, defaults, prefs and whether [unlisted metrics](#include-unlisted-metrics) get automatic panels. A project starts with one view, **Default**.

On the run page you are always in exactly one view, the project's **current view**. Every edit you make there is saved into it; there is nothing to save or apply. The current view is stored on the server, so it is the same in every browser and on every device.

The view switcher is the first item of the [toolbar](#workspace-toolbar). On the run page it shows the current view's name. Click it to open **Workspace views**: one tile per view, oldest first, then a dashed **+ New view** tile. ×, ++escape++ or a click outside closes it.

- The top of a tile is a sketch of the view's layout for the run you are viewing: each section as its name over a rule, each card as a box as wide as its card on the 6-column grid, with its card type's icon. With unlisted metrics on, the automatic panels of the run's metrics are drawn too. A collapsed section shows only its rule; a long layout shows its top part.
- Below it: the view's name (with ✓ before the current view), then **✎** to rename it in place (++enter++ or leaving the field saves, ++escape++ cancels), **⧉** to duplicate it as **<name> copy**, and **×** to delete it. The last view cannot be deleted. Deleting the current view first switches to the first remaining one.
- The second line counts the view's cards and says **unlisted on** or **listed only**.
- Click a tile to switch to its view. The panel closes. Switching is not an edit: ++cmd+z++ never switches back, and edits inside a view undo as usual.
- **+ New view** turns into a name field with **Copy of current view** (the default) or **Empty (automatic panels only)**. ++enter++ creates the view and switches to it; ++escape++ cancels.

In a [comparison](comparisons.md), the switcher reads **Views** and opens the same panel, without a ✓. A comparison keeps its own layout: clicking a tile copies that view's layout into the comparison, replacing its layout and keeping its runs (++cmd+z++ undoes it). **+ New view** asks only for a name and saves the comparison's current layout as a new view. ✎, ⧉ and × work as on the run page.

On a phone the panel spans the full width, with one or two tiles per row.

A panel has a card type (see [Cards](cards.md)), a metric selector and its settings (title, size, smoothing, axes and so on). The selector is either:

- one or more metric names (`val.loss`, or `train.loss` and `val.loss` on one line plot), or
- a regular expression matched against the whole metric name (`val\..*`). The panel shows whatever the bound runs log that matches, so a new matching metric joins it.

### Loading

A workspace with hundreds of panels opens at once: a panel loads its data and draws when it comes within a screen's height of the window, and until then a placeholder of its size holds its place, so the page does not jump as you scroll. A panel stays loaded once it has been on screen. Collapsed sections load nothing.

### Automatic panels

You don't have to build a layout. Every metric that no panel shows gets an **automatic panel** of its type, grouped into sections:

- A metric whose name contains a dot goes into the section named by its prefix. For example, `train.loss` goes into **train**.
- A metric without a dot goes into **Charts**.
- Media go into **Media**: images, audio, video, figures, histograms, tensors, tables, 3D objects, volumes, HTML, Markdown and presets.
- Automatic sections appear in this order after the layout's own sections: **Charts**, your prefix sections A–Z, **Media**, and **system** last. When a layout section has the same name, the automatic panels join it after its own panels.

A panel whose selector names exactly one metric stands in for that metric's automatic panel. Panels over several metrics or a regex are extra views: the metrics they show keep their own panels. So are the multi-run cards (value, bar chart, scatter, …) you [add](#adding-cards) from a series: they read it through an expression in their settings, and the series keeps its own panel. Any number of panels may show the same series.

When you change an automatic panel in any way (a setting, its size, its type, its position, a duplicate), it becomes part of the layout. The panels before it in its section are written with it, so nothing on the page moves. From then on it is an ordinary panel.

### Include unlisted metrics

**Unlisted metrics: on / off** in the toolbar decides whether metrics no panel shows get automatic panels. It is a setting of each workspace: every [view](#workspace-views) and every comparison has its own (a new comparison copies the current view's along with the rest of the layout).

- **On** (the default): every metric gets a panel, as described above.
- **Off**: only the layout's own panels show. Turning it off first writes every automatic panel on screen into the layout, so nothing disappears; what changes is that metrics logged afterwards don't get a panel. **N series without a card · manage** above the sections counts them, and [Manage cards](#manage-cards) lists them, each with a **Show** button that adds its panel. Panels a hide pattern hides at that moment are not written, so they behave like a metric logged later.
- Turning it back on brings automatic panels back for every metric no panel shows.

### Editing the layout

Every edit changes the workspace, so it applies to every run the workspace shows:

| Edit | How |
|---|---|
| Remove a panel | × in its header. An automatic panel stays removed; [Manage cards](#manage-cards) lists removed panels so you can show them again. |
| Add a card | The dashed **Add card** card at the end of a section: see [Adding cards](#adding-cards). It is the only way to add one. |
| Change data, type, title or settings | The gear opens the card full screen in the [card editor](#full-screen-card-and-settings). The title, collapse chevron and resize handle edit the panel too. |
| Resize | Drag the bottom-right handle. A grey preview shows the size the card will take (height freely, width snapped to the 6-column grid); the cards resize when you let go. Every card in the section takes the new width, the cards in its row the new height. |
| Duplicate | **Duplicate card** (two squares) in the header copies the card — its data, type and settings — right after itself (in reports too). Change the copy's type or settings afterwards to see the same data two ways. |
| Move | Hover the header and drag the grip onto another panel, in the same section or another one: it takes that panel's place. Drop it on the **Add card** card or a gap of a section's grid to put it last there. On touch screens, use **Move up** / **Move down** in the ⋯ menu. [Manage cards](#manage-cards) moves cards and sections by drag & drop or the keyboard too. A card changes section only this way. |
| Hide, show, delete | [Manage cards](#manage-cards). |
| Add a section | **+ New section** below the last section. |

A panel whose metrics the bound runs don't log shows an empty state ("This run does not log this metric") instead of disappearing, so the layout holds still while you switch runs. Multi-run panels (run comparer, code diff, scatter plot, parallel coordinates, parameter importance) need at least two runs: on the run page they say so, and they come alive in a comparison. Bar charts and scalar tiles work with one run.

Section header controls:

| Control | Effect |
|---|---|
| ▼ (click the header) | Collapse or expand the section. |
| Double-click the name | Rename the section. |
| Gear | Edit [section defaults](#defaults-cascade). The gear is highlighted when the section has defaults. |
| A–Z | Show the section's panels sorted by title. This overrides the manual order and disables dragging. |
| ↑ / ↓ | Move the section up or down. |
| Send to report | Copy the section's panels, for the runs on screen, into a new [report](reports.md) and open it. |
| Trash | Delete the section. Only shown while it has no panels. |

A scalar series with a single point shows as a plain value card, not a one-dot chart. It becomes a line plot once a second point arrives.

### Adding cards

The dashed **Add card** card at the end of every section's grid adds cards to that section. An empty section shows only it, and an empty workspace shows one section, **Charts**, with it. It opens the [card editor](#full-screen-card-and-settings), the same full-screen view as a card's gear, with only its **Data** and **Type** tabs (**Type** once data is picked). The left side shows a live preview.

1. **Data.** Every series the bound runs log, grouped like the automatic sections (Charts, prefixes, Media, system), each with its kind (`scalar`, `image`, …) and how many cards already show it (hover for their names). Pick:
    - **Series**: tick one or several; they show as chips above the list. The search box filters by name (a case-insensitive regex).
    - **Regex**: a regular expression over the whole name, with the live list of what it matches. The card follows the pattern, so a matching series logged later joins it.
    - **One card per group**: a regular expression whose capture groups split the matches into cards. Series whose capture groups have the same values share a card, titled by those values joined by `·`. `(train|val)\.loss` makes one card per split, `.*\.(loss)` one card with every loss, `.*\.(loss|acc)` one with the losses and one with the accuracies. Without capture groups, every match goes onto one card. The list shows the cards before you add them. The expression must match the whole name and is case-sensitive.
    - **Whole runs**: no series, for cards that compare runs (run comparer, code diff) or that you set up in their settings.

    The preview shows the data in the first card type that fits (every card, for one card per group).
2. **Type.** The **Type** tab (or ++enter++ in the search or regex field) lists the types that can show the data, while the left side shows each one as a live tile on the bound runs:
    - a series of a kind gets that kind's card (image → image card, histogram → histogram card, …), and the [custom viewers](../guides/media.md#custom-data-for-your-own-viewers) that accept it. When a viewer is the [default viewer](../guides/custom-viewers.md#default-viewers) of that kind, the type says so (**Volume (default: Volume (ray marching))**) and the card follows the default; custom data lists **Default (<viewer>)** first, then each viewer to pin;
    - scalars also offer **Value** (one number: the last value, reduced across runs), **Bar chart**, **Scatter** (one or two series), **Parallel coordinates** and **Parameter importance**, which read the last value of each run (`last(loss)`); edit the expression in their settings for `min(loss)` and the like;
    - cards that need more runs than the workspace binds stay listed with **needs 2+ runs**: on the run page that is scatter, parallel coordinates, importance, run comparer and code diff. Add them in a [comparison](comparisons.md).

    Click a type, in the list or on its tile. The card goes at the end of the section, and the same editor turns into that card's, on its **Values** tab (else its first one): the card takes the left side, its title the header, and its settings tabs join **Data** and **Type**. With one card per group, every group's card is added and the first one opens.

Nothing is written before you pick the type; ++escape++ or × leaves without adding anything.

### Manage cards

**Manage cards** in the toolbar lists every card of the workspace by section, with what it is:

| Status | Meaning | Actions |
|---|---|---|
| shown | A panel of the layout. | Hide, edit, duplicate, move, delete. |
| automatic | An automatic panel. | Hide (it becomes removed), edit, duplicate, move (these write it into the layout). |
| hidden | A panel of the layout you hid: it keeps its place, settings and claim on its metric, but doesn't render. | Show, edit, duplicate, move, delete. |
| removed | An automatic panel you removed. | Show. |
| not shown | With unlisted metrics off, a series no panel shows. | Show (adds its panel). |

A **pattern** mark means a toolbar hide pattern hides the card. Filter the list by name or status; the **Include unlisted metrics** box is the toolbar toggle. **Edit** closes the list and opens the card's [editor](#full-screen-card-and-settings).

Move cards and sections with their grips:

- Drag a card's grip onto another card: it goes before it (upper half) or after it (lower half), in that card's section. Drop it on a section's heading or empty space to put it last in that section.
- Drag a section's grip onto another section: it goes before or after it.
- With the keyboard, focus a grip (Tab) and press ++alt+arrow-up++ / ++alt+arrow-down++. A card moves one place, and from the first or last place of its section into the end of the previous or the start of the next section. A section moves one place.

Every move applies to the page at once and is one [undo](#undo-and-redo) step.

!!! note "What is stored where"
    **In the workspace** (each view, and each comparison, on the server, shared by everyone who uses the project): sections and their order, collapsed and sorted state; panels with their type, metrics, settings, size and hidden flag; removed automatic panels; whether unlisted metrics get automatic panels; hide patterns; workspace and section defaults; prefs (sync zoom, colour by). A comparison's workspace also holds its runs and their hide / pin / baseline toggles. Which view is current is stored on the server too.

    **In this browser only:** the run page's and runs table's hidden, pinned and baseline runs.

    Two tabs or users can edit a workspace at the same time. If one write loses the race, it is replayed on top of the other one's changes, so neither edit is lost.

    A user with a read-only token sees the same page but cannot change the layout: there is no view switcher, **Add card** card, **+ New section**, **Manage cards**, **Duplicate card**, drag grip or unlisted-metrics toggle. Card settings they change (zoom, collapse, smoothing) last until they reload.

## Workspace toolbar

The toolbar appears above the sections on the run page and on [comparisons](comparisons.md).

### View switcher

The first item: the current view's name on the run page, **Views** in a comparison. See [Workspace views](#workspace-views).

### Search

Press ++cmd+k++ (macOS) or ++ctrl+k++ to focus **Search panels**. The query is a case-insensitive regular expression that can match anywhere in a panel's title (for an untitled panel, its metric names), so `val\.` finds `val.loss`. If the query is not a valid regex, it is matched as plain text and the box turns red. Press ++escape++ to clear it.

### Hide matching

While a search is active, **Hide N matching** saves the query as a hide pattern in the workspace. Matching panels then disappear for every run the workspace shows. Each pattern shows as a `/pattern/` chip; click its × to show the panels again.

### Manage cards

**Manage cards** opens the [list of every card](#manage-cards). Cards are added from the layout itself: see [Adding cards](#adding-cards).

### Unlisted metrics

**Unlisted metrics: on / off** — see [Include unlisted metrics](#include-unlisted-metrics).

### New comparison

On the run page, **New comparison** creates a [comparison](comparisons.md) of this run, starting from a copy of the current view's layout, and opens it.

### Colour by

**Colour by** colours every run by the value of a scalar [expression](../reference/expressions.md), such as `config.lr`, `min(val.loss)` or `run.group`:

- **Numbers** fall into 2–8 evenly spaced buckets between the lowest and highest run.
- **Text** gets one colour per value.

Pick the Turbo, Viridis or Magma palette. A legend next to the search box shows the expression and the colour of each bucket. **Clear** restores the default colours, which come from each run's id. The setting is saved in the workspace.

### Sync zoom

The link toggle makes charts that share an x-axis zoom together.

On read-only surfaces, such as report viewers and share links, the toolbar shows only the search box.

## Defaults cascade

Each card setting resolves through these layers, highest first:

1. **Card:** the card's own override.
2. **Instance:** what the card was created with. This is its metric, or the x-axis you gave with `run.track(..., x=...)`.
3. **Section:** set with the section's gear.
4. **Workspace:** for the run page's current view, set on the **Defaults** page (`/p/<project>/defaults`, the **Defaults** link in the project navigation). A comparison copies these when it is created and keeps its own afterwards; edit them through its section gears.
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
- section edits, hide patterns, defaults, colour by
- copying a view's layout into a comparison

Switching views on the run page is not an edit and is not recorded. Undo with ++cmd+z++ / ++ctrl+z++ and redo with ++cmd+shift+z++ / ++ctrl+shift+z++. These shortcuts do nothing while a text field has focus, because the field keeps its own typing undo. The stack holds 200 steps.

Undoing a workspace edit restores only the parts of the workspace that edit changed (its sections and panels, removed panels, the unlisted-metrics setting, hide patterns, defaults, prefs or runs), so changes another tab made to the other parts in the meantime survive. See also [Keyboard shortcuts](shortcuts.md).

## Full-screen card and settings

The gear on a card opens the card full screen, with its settings panel beside it. On a phone, the card and the settings are two tabs.

On the run page and in comparisons, the settings panel is the **card editor**, the one editor of a card, which also [adds cards](#adding-cards):

- The header, which does not scroll, has ←/→, the card's title with ✎ (click to edit; ++enter++ or leaving the field saves, ++escape++ cancels, empty names the card by its data) and one row of tabs with ×: **Data**, **Type**, then the card's own tabs (**Values**, **Grouping**, **Display**, **Expressions**, as the card has them).
- **Data**: the same data picker as when adding (without one card per group, which makes several cards), and nothing else.
- **Values**: the card's own settings of its values (x axis, ranges, smoothing, outliers, slider key, reference, …), where the card has them.
- **Type**: the types that can show the data; the left side shows each as a live tile, the current one marked, in place of the card. Picking one (in the list or on its tile) changes the card and goes back to **Data**.

Every change applies at once and can be undone. The section is not set here: drag the card to [move](#editing-the-layout) it. A card's series are its data: the line chart has no metrics picker of its own, its series chips have no ×, and a series chip dropped on a workspace card does nothing; change the **Data** instead. A read-only user gets the card and its own settings, without **Data**, **Type** and the title edit.

- Press ++arrow-left++ / ++arrow-right++, or use the arrow buttons next to the title, to step to the previous or next card in page order. Arrow keys that belong to a focused control, such as a slider or select, don't navigate.
- Press ++escape++ or click × to close.

The settings panel has up to four tabs: **Values**, **Grouping**, **Display** and **Expressions**. Tabs a card doesn't use are hidden, and a card with only one tab shows no tab bar. [Cards](cards.md) lists each card's settings.

## Touch devices

On a touch screen, a card starts out non-interactive, so a drag over it scrolls the page. To pan or zoom a card's content, tap the hand button in its header. The full-screen view is always interactive. On touch devices, the card's ⋯ menu has **Move up** / **Move down** in place of drag-to-reorder.
