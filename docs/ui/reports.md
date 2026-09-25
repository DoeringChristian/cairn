# Reports

A report is a document with prose and live cards. It works like a notebook: a column of **markdown cells** and **cards cells**. Each cards cell draws its cards from a set of runs. Reports are saved on the server, so everyone with access to the project sees the same document.

Open **Reports** in the project navigation (`/p/<project>/reports`). From there you can:

- create a report with **+ New report**,
- rename a report inline or delete it,
- start a report from a saved report template (see [Templates](#templates)).

Click a report to open it at `/p/<project>/reports/<id>`.

## Cells

Every cell has a toolbar on its top border. It shows when you hover over or focus the cell, and is always visible on touch screens. The toolbar has **move up**, **move down**, **comment** and **delete**. To insert a cell, hover over the gap between two cells, or below the last one, and pick **+ Markdown** or **+ Cards**. The gap below the last cell is always shown.

### Markdown cells

Click a rendered markdown cell to edit it. The whole cell turns into one text area. It renders again when you press ++shift+enter++, ++ctrl+enter++ / ++cmd+enter++ or ++escape++, or when you click elsewhere. A new, empty cell opens in edit mode.

Cells render GitHub-flavoured markdown (tables, task lists, strikethrough, autolinks). They also support:

Math
:   KaTeX between double dollars: `$$E = mc^2$$` inside a line is inline math. `$$` on its own lines opens and closes display math. A single `$` stays a dollar sign.

Callouts
:   GitHub-style alerts. The kinds are `NOTE`, `TIP`, `IMPORTANT`, `WARNING` and `CAUTION`, in any case. Text after the marker becomes the title. Add `-` or `+` after the marker to make the callout collapsible, starting closed or open.

    ```markdown
    > [!TIP] Faster training
    > Mixed precision halves the step time here.

    > [!WARNING]-
    > Folded until clicked.
    ```

Raw HTML is never rendered. A `<script>` or any other tag shows as plain text.

### Images

Paste images into a markdown cell, or drag them onto it, in edit mode or while it is rendered. PNG, JPEG, GIF and WebP are accepted, up to 20 MB each. The server checks the file bytes and ignores the declared type.

- While a file uploads, a placeholder `![Uploading <name>…]()` marks where it will go.
- When the upload finishes, the placeholder becomes `![](cairn-asset:<sha256>)`.
- If an upload fails, its placeholder is removed and an error stays under the cell until you dismiss it.

The image belongs to the report's asset store, so share-link viewers can see it too.

### Cards cells

A cards cell shows live cards for its runs. Its toolbar adds two buttons:

- **+ (Add card)** opens the card picker. You need to choose runs first.
- **Runs** (the sliders icon, with the run count) opens *Runs in this cell*. This is the same run-set editor a [comparison](comparisons.md#run-sets) uses. It picks a **static** run list or an **auto (query)** selector, and sets each run's hide / pin / baseline toggles.
    - **Reset cards from runs** throws away the cell's cards and creates one card per metric across its runs.
    - With a selector, the refresh badge resolves the selector again and rebinds the existing cards to the new runs. Your cards and their order stay as they are.

A selector cell also rebinds automatically whenever its resolved run set changes.

You can drag cards within a cell to reorder them. Card settings work as they do everywhere else (see [Cards](cards.md)). Every settings change is saved with the report. The media controls above the cards (step slider sync) apply to that cell only.

!!! note "Report cards ignore workspace defaults"
    Report cards resolve settings from the built-in defaults and their own overrides only. Workspace and section defaults ([Workspace](workspace.md)) do not apply, so a report looks the same to everyone.

## The markdown source

A report is stored as one markdown document. Prose is kept as written. Each cards cell becomes a fenced ```` ```cairn ```` block of YAML listing its runs, cards and each card's settings overrides:

````markdown
## Validation

Loss keeps falling after the learning-rate drop.

```cairn
runs:
  selector: { mode: newest-per-name, namePattern: "resnet-*", n: 3 }
cards:
  - metric: val.loss
    type: scalar
    settings: { yScale: log }
  - type: parallel
```
````

The full schema is in [Report blocks](../reference/report-blocks.md).

Click **View source** to see the exact markdown a save would write. It is read-only: you edit cells, not the source. If you type a ```` ```cairn ```` fence into a markdown cell, it is saved as written. The next time the report loads, it becomes a cards cell.

### Cells with errors

A ```` ```cairn ```` block that does not compile shows as an error cell with the message. The block is saved exactly as written and is never rewritten on its own. Its toolbar only offers move and delete.

A `metric:` card without `type:` gets its type from the metrics the cell's runs have logged. The editor parses the report before those are loaded. Such a cell therefore shows *Loading…*, then compiles again once the run's metric list is available. The recompiled cards are only displayed. They reach the saved report the next time you edit that cell.

## Headings and table of contents

Headings in markdown cells form the report's outline:

- Each heading gets an anchor. A `#slug` link opens the report scrolled to that heading.
- A table of contents lists the headings. On wide screens it is a sticky column beside the report. On phones it is a floating **Contents** button.
- A heading whose section spans later cells gets a collapse chevron. Collapsing it hides the cells up to the next heading of the same or a higher level.

Collapsed sections are remembered per browser (localStorage) and are not part of the document. Anyone, share-link viewers included, can collapse sections without changing the report. Clicking a TOC entry expands any collapsed section that hides the heading.

## Saving and conflicts

Reports autosave about 1.5 seconds after your last change, and again when you leave the page. Press ++ctrl+s++ / ++cmd+s++ to save immediately. The status next to the title shows *saving…*, *saved · updated …*, *save failed*, or *changed elsewhere*.

Each save only succeeds if the report is still the version you loaded. The server rejects a save with **409** if someone else changed the report in the meantime. The editor then handles it in one of two ways:

- **Only new cells were appended** (for example with *Add to report* from another page). The editor adds those cells to your copy and saves again. Your edits and theirs are both kept.
- **Anything else changed.** The editor stops saving and shows *changed elsewhere — reload to see it (your edits are kept here)*. Your local edits stay on screen, but reloading replaces them with the server's version.

Every cell edit, insert, move and delete is an undo step. Undo and redo work as described in [Keyboard shortcuts](shortcuts.md).

## Adding cards from elsewhere

- **Add to report** on any card header lists the project's reports and offers to create a new one. It appends a new cards cell to the end of the report, containing a copy of the card with its settings inlined. Existing text is never rewritten. If the report changes during the append, the button reads it again and retries once, then reports an error.
- **Send section to a new report** in a section header (run page or comparison) creates a new report with a heading, a short intro and one cards cell holding the section's cards.
- **Create report** on a comparison copies all its cards and settings into a new report in the same way. See [Comparisons](comparisons.md).

In each case the source cards are left unchanged.

## Comments

Click **Comments** in the report header to open the comment panel. The button shows the number of open threads. You can comment on four things:

| Anchor | How to comment |
| --- | --- |
| The whole report | The box at the top of the comment panel. |
| A cell | The comment button in the cell toolbar. |
| A card | The comment button in the card header. |
| A passage of text | Select text in a rendered markdown cell and click the **Comment** button that appears. |

- Cells and cards with open threads show a count badge. Click it to open their threads.
- Threads are one level deep: a first comment and its replies.
- Anyone with the write role can comment, reply, resolve or reopen a thread.
- Only a comment's author or an admin can edit or delete it. Deleting a thread's first comment deletes the whole thread.

The panel lists report-level threads first, then the rest in document order; click a thread's label to scroll to it. Threads whose card, cell, heading or quoted text no longer exists are listed separately as **detached**. Use the filter to show open, resolved or all threads.

!!! info "How cell anchors survive edits"
    - A cards cell is anchored by its block id (`id:` in the fence).
    - A markdown cell is anchored by its first heading, or by its first line when it has no heading.
    - A text comment is anchored by its quote and the section it is in.

    Rewording a heading or a quoted passage detaches the thread.

## Export

Export PDF
:   Waits until every card has finished loading, then opens the browser's print dialog. Choose *Save as PDF* as the destination. App chrome, toolbars and insert gaps are hidden in print.

Export LaTeX
:   Draws every card with all sections expanded and folded callouts open, then downloads `<title>.zip` with:

    - `report.tex`: prose converted from the same markdown pipeline the app uses, with math passed through as `\(…\)` / `\[…\]`, and one figure per card captioned with the card's title,
    - `figures/card-<n>.png`: one PNG captured per card,
    - `assets/<hash>.<ext>`: the images uploaded into the report.

    Images from other URLs become links. A banner lists any card that had no chart to capture.

## Templates

**Save as template** stores the report's cards (type, metrics, settings) as a report template. On the Reports page, pick a template, choose runs, and click **New from template**. This creates a new report whose cards are matched to those runs. A banner reports how many of the template's cards could be restored. If none match, no report is created.

## Read-only viewing

A user whose token has the **read** role sees reports in view mode:

- There is no structure editing, image upload, comment panel or share button.
- Markdown renders only.
- Cards can still be explored: zoom, step through, change settings, toggle hide/pin/baseline. These changes stay in that browser session and are never saved.

To show a report to someone with no account, use a [share link](sharing.md).
