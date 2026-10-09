# Cards

A card shows one logged series, or a set of runs, in the [workspace](workspace.md), in the [project workspace](project-workspace.md) and in [reports](reports.md). This page lists every card type, what data it shows, and its settings. For how settings inherit (card → section → workspace → built-in) and the ↺ reset, see [Defaults cascade](workspace.md#defaults-cascade).

Settings are grouped into up to four tabs: **Values**, **Grouping**, **Display** and **Expressions**. A card shows only the tabs it uses. Some settings appear only when a card has more than one run. Settings marked *(default)* in the tables below can also be set as section or workspace defaults.

## Card types

Series cards show one logged name (or several: in a workspace, the card's **Data** in the [card editor](workspace.md#full-screen-card-and-settings)), and the Python type you log decides which card you get. Multi-run cards show a set of runs rather than one series. You add them to the [project workspace](project-workspace.md) and reports with **Add card**.

| Type | Card | Shows | Logged with |
|---|---|---|---|
| `scalar` | Line plot | Metric curves | `run.track(value, name=…)` |
| `image` | Image | Images, boxes and masks | `cairn.Image` |
| `figure` | Figure | Plotly / matplotlib figures | `cairn.Figure` |
| `audio` | Audio | Players with a waveform | `cairn.Audio` |
| `video` | Video | Video players | `cairn.Video` |
| `histogram` | Histogram | Distributions over steps | `cairn.Histogram` |
| `tensor` | Tensor | Stats, histogram or heatmap of an array | `cairn.Tensor` |
| `text` | Text | Logged text | `cairn.Text` |
| `table` | Table | Tables, including media cells | `cairn.Table` |
| `html` | HTML | Sandboxed HTML | `cairn.Html` |
| `markdown` | Markdown | Rendered Markdown | `cairn.Markdown` |
| `pointcloud`, `mesh`, `boxes3d` | 3D | Point clouds, meshes, boxes / octrees / BVHs | `cairn.PointCloud`, `cairn.Mesh`, `cairn.Boxes3D` / `Octree` / `BVH` |
| `volume` | Volume | The built-in ray-marcher `cairn.volume`, or the project's [default viewer](../guides/custom-viewers.md#default-viewers) for `volume` | `cairn.Volume` |
| `custom` | Custom viewer | Your own browser code: a [custom viewer](../guides/custom-viewers.md) of the project, listed by its title | `cairn.Data`, or a built-in kind a viewer accepts |
| `preset` | Confusion / PR / ROC | Confusion matrices, PR and ROC curves | `cairn.ConfusionMatrix`, `PRCurve`, `ROCCurve` |
| `artifact` | Artifact | A pickled point, or the versions of an artifact the run logged: files, sizes and download links | `run.track(cairn.Pickle(...))`, `run.log_artifact(...)` |
| `parallel` | Parallel coordinates | One line per run (or group) across the varying config keys and a metric | multi-run |
| `scatter` | Scatter plot | One point per run | multi-run |
| `bar` | Bar chart | One bar (or distribution) per run or group | multi-run |
| `tile` | Scalar tile | One number reduced across runs | multi-run |
| `importance` | Parameter importance | Which config keys explain a metric: importance and correlation | multi-run |
| `run-compare` | Run comparer | Metrics, params and environment side by side | multi-run |
| `code-diff` | Code diff | Two runs' source snapshots diffed | multi-run |
| `scalars` | Scalars | Single-step metrics, summary values and run info, one row per run or group; best green, worst red | multi-run |
| `config` | Config | Config keys, tags and notes, one column per run or group | multi-run |

A list of media logged under one name at one step is a **gallery**. Every media card above (image, figure, audio, video, histogram, tensor, text, HTML, Markdown, 3D, volume) shows it: see [Galleries](#galleries).

See [Media and rich types](../guides/media.md) for the logging side. When a series has an unknown type, its card shows the type, the point count and a download button.

## Common card actions

On the left of a card header: the chevron (collapse), the title (double-click or click the pencil to rename) and the card's own controls (log scale, badges, the interact hand on touch screens, **Comment** in reports). Right of the bar, every card has the same actions in the same order:

1. **Screenshot** (camera): the card's body as a PNG, exactly as displayed — its size, zoom, camera, step and scroll, at your screen's pixel density. Two things the browser does not let a page picture are left blank: the native controls of audio and video players, and pages from other sites embedded in logged HTML.
2. **Download data**: the card's data. Line charts: a CSV of the plotted series; value, bar, scatter, parallel coordinates, importance, tables and the run comparer: a CSV of what they show; code diff: the diff as a `.patch`; media (images, video, audio, HTML, markdown, text, figures, tensors, histograms, 3D, volumes, artifacts, custom data): the logged file(s) at the shown step, zipped when several panes or gallery items show.
3. **Add to report:** see [Reports](reports.md).
4. **Reset view:** back to the card's default view (zoom and pan, camera); nothing happens when nothing changed.
5. **Settings** (gear): opens the card full screen with its settings (see [Full-screen card](workspace.md#full-screen-card-and-settings)). On the run page and the project workspace that is the card editor.
6. **Duplicate card** (two squares): a copy of the card — data, type and settings — right after itself.
7. **×:** remove the card.

Read-only cards (a read-only token, share links) have Screenshot, Download data, Reset view and Settings only. On narrow screens the actions fold into the **⋯** menu, except **Add to report**.

Cards that plot several series show them as chips. In reports, click a chip's × to remove that series, or drag a chip onto another card to add the series there; on the run page and in the project workspace a card's series are its **Data**. There, a card that shows one metric for every run has no chip strip: its title names the metric.

## Line plot (`scalar`)

A scalar's curve, one line per run.

**Mouse and touch controls:**

- Drag to zoom. A mostly horizontal drag zooms only x, a mostly vertical drag zooms only y, and anything else zooms a box.
- Double-click (on touch, double-tap) to reset the zoom.
- ++cmd++ / ++ctrl++-click a line to open its run.
- With **Sync zoom** on in the workspace toolbar, charts that share an x-axis zoom together.

| Tab | Settings |
|---|---|
| Values | **Metrics** (the series drawn; reports and share links only: in a workspace the card editor's **Data** picks them). **X axis** *(default)*: **Step**, **Relative time (wall)** (seconds since the run was created), **Relative time (process)** (the seconds its process ran; cairn records no resume times yet, so this equals the wall-relative time), **Wall time**, or any metric; a metric whose values decrease somewhere is noted *Not monotonically increasing* (it still works, joined as of each step). **X range** / **Y range**, **Log x** / **Log y** *(default)*. **Smoothing**: kind and amount *(default)*. **Outliers**: low/high percentile to clip the y range to *(default)*. **Max runs**: pinned runs come first *(default)*. |
| Grouping | **Group runs**: **Workspace** *(default)* follows the [workspace](project-workspace.md) sidebar's grouping (grouped: one line per innermost sidebar group, labelled `group: exp-44, jobType: train`; not grouped: one line per run), and outside a workspace (run page, reports) uses the settings below. **Off** draws one line per run, even in a grouped workspace. **By key** always uses the settings below, also in a grouped workspace. **Group runs by**: Group, Job type or a Param. Runs that share the value draw as one centre **Line** (mean, median, min or max) with a **Band** (std, min–max or sem). **Hide member runs**, **Latest run per group** *(all default)*. Shown only when the card has several runs. |
| Display | **Line type**: linear, monotone, step, step before, step after. **Chart type**: **Line**, **Area** (the lines stacked, each filled down to the one below) or **Percentage area** (each line's share of the total). **Show original**: the faded raw line under a smoothed one. **Full fidelity**: per-pixel min/max, recomputed on zoom. Axis titles. **Legend** (it lists only the lines that draw in the chart: a run or group that does not log the metric is left out) on/off, position (top, bottom, right, left), font size (small, medium, large, or auto: small below a 480 px chart, medium above) and [template](../reference/expressions.md#templates) (e.g. `${run.name} · ${run.group} · ${config.lr}`). **Tooltip** template and wall time *(most default)*. Each series also has its own **Colour**, **Width** and **Dash**, and a **Label**: a run template whose `[[ … ]]` sections show in the legend only while hovering, with `${x}` and `${y}` the hovered point (as wandb's `[[ ${x}: ${y} ]] name`). A series of one or two points is drawn as point markers. |
| Expressions | **X expression**: any [expression](../reference/expressions.md) over the run, evaluated on each line's steps, e.g. `step * 32`, `epoch` or `relative_time / 60`. A metric is joined as of each step. **Add derived series**: an expression such as `loss / step`, drawn for every run. |

Smoothing kinds:

- **Exponential moving average:** the amount is the weight on the previous value.
- **Time-weighted EMA:** EMA weighted by each average x step, debiased at the start.
- **Gaussian:** the amount is the kernel's standard deviation, in points.
- **Running average:** the amount is the trailing window size, in points.

A smoothing amount of 0 turns smoothing off.

Legend and tooltip templates are `${…}` [template strings](../reference/expressions.md), for example `${run.name} lr=${config.lr}`. Leave a template empty to get the automatic label.

If you logged a metric with `run.track(..., x="epoch")`, its card starts on that x-axis.

## Media cards

Image, figure, audio, video, HTML, Markdown, tensor, 3D, volume and preset cards all use the same step slider. The slider shows the current step. On image, figure, audio, video, HTML, Markdown, text, 3D and volume cards the header repeats it only while the card is collapsed. With several runs, each pane is labelled by a chip with the run's colour and name in its top-left corner.

### Step slider and slider key

The slider picks which logged step each pane shows. The **Slider key** *(default)* sets what one slider position means:

- `step` (the default): each logged step is one position.
- A scalar metric, such as `epoch`: each run's media is looked up **as of** each step, using the key's last value at or before that step. The slider then picks, in every run, the media logged while the key held that value, even when runs reach it at different steps. When several steps share a value, the position shows the newest of them.

The exact rule: at slider value *x*, each run shows the media logged at the step whose key value is the largest value at or below *x*; when several of its media steps share that value, the latest of them. A run that does not log the key (or not yet at any media step) shows nothing. With a metric key the slider is labelled with it on both sides: `epoch ━━━━● epoch 4 (5/5)`.

A [summary media value](../guides/runs.md#media-in-the-summary) (`run.summary(fig=cairn.Figure(f))`) is one value with no step: a card whose series are all summary media values has no slider and does not follow the section slider. With several runs it still shows one pane per run, and a later `run.summary` write replaces what it shows (at once while the run is running; on a finished run, when the page is reloaded).

A slider starts at the newest step and follows new steps as they arrive. Move it back and it saves that *value* (not an index), so it stays put while new steps arrive; move it to the end again and it follows them again. The section slider does the same.

### Section media sync

When **Follow section slider** is on *(default; on by default)*, a media card follows its section's shared slider. The section shows that slider above its cards. It covers the union of the values of every following card loaded so far (panels load as they come near the screen, see [Loading](workspace.md#loading)) and has its own key field. When a section has synced videos, the bar also gets play/pause. Turn **Follow section slider** off to give the card its own slider. The section slider position is remembered in this browser.

### Index, layout and media limit

These controls work as wandb's media panel. Image, audio, video, HTML, Markdown, text, custom viewer, point cloud, mesh and boxes cards have them.

```
┌ samples ──────────────────────────── 📷 ⤓ ↺ ⚙ ⧉ ✕ ┐
│ Index [ One ▾ ]   ‹ 3 / 8 ›                        │  lists only
│ (media)                                            │
│ epoch ━━━━━━━━━━━━━━━━━━━━━━━━━━●  epoch 4 (5/5)   │
└────────────────────────────────────────────────────┘
```

**Index** (gear › Values, and over the media; only on cards whose points are [lists](#galleries)) picks which items of each logged list the card shows, counting from 0:

| Index | Shows |
|---|---|
| **All** *(default)* | every item |
| **One** `i` | item `i`. Over the media, `‹ i / n ›` steps through the items (`n` is the longest list shown). |
| **Range** `a`–`b` | items `a` to `b` |
| **First N** `k` | the first `k` items |

The Index applies in every mode. A list shorter than the index shows its last item (One) or what it has (Range, First N).

**Mode** *(default)*, on the Display tab:

| Mode | Settings | Layout |
|---|---|---|
| **Gallery** | **Columns**, **Column content** *(default)* | Tiles in **Columns** columns. **Column content** says what one tile is. **Index** (the default, as wandb's): one tile per item of each run's list, at the slider's value. **Run** (the default for point clouds, meshes and boxes: each tile is a 3D viewer, and browsers allow only a few): one tile per run, at the slider's value, with the Index's items together (several runs: `auto` columns means up to two, one on phones). **Step**: one tile per step (slider value), sampled evenly like the grid's columns (5 for `auto`), each with the first item the Index selects; one row per run. On a card without lists, Index is the same as Run. |
| **Grid** | **X-axis**, **Y-axis** *(default)*, **Grid columns**, **Steps** *from*–*to*, **Rows** *(default)* | Two of **Step**, **Index** and **Run** as columns and rows (X Step and Y Run by default; Index only for lists). The step axis is the slider values within **Steps** (in slider-key values; an empty bound is open), sampled evenly: **Grid columns** values on the X-axis (5 for `auto`), **Rows** on the Y-axis. When Run is on neither axis, each run repeats the Y-axis (rows `media-a · #0`, `media-a · #1`, …). When Index is on neither axis, each cell shows the Index's items. At most **Rows** *(default 30)* rows. Click a step column's header to move the slider there. |
| **Compare** | **Slots**, **Run** / **Step** / **Index**: **Linked** or **Individual** *(default)* | 2–4 slots side by side. A linked variable is the card's for every slot: the first run, the slider's value, the Index. An individual one has its own picker in each slot's header (`media-b`, `epoch 3`, `Index 5`). By default Run is individual and Step and Index are linked. Going individual starts each slot where it was. |

**Media limit** *(default)*: **Show all**, or **Limit** `N` tiles (25 by default). The grid keeps whole rows while they fit.

**Max runs** *(default)* shows only the first N runs; 0 shows them all. Figure, preset (confusion matrix) and volume cards have **Columns** and **Max runs** but no modes.

### Galleries

A [gallery](../guides/media.md#captions-and-galleries) point holds several items of the card's kind. The card shows its caption in one line above the items. With several runs, that line also carries the pane's run label. Each item's caption sits in the item's top-right corner for images, video and audio, and in one small line above the item for charts and text. Hover a cut-off caption to read all of it.

- **Image, figure, histogram, tensor**: a near-square grid that fills the pane. When the pane is too small the grid scrolls instead of shrinking charts. Figures share the card's zoom.
- **Audio, video, HTML, Markdown, text, volume**: the items in a grid at their natural height. With **Sync playback** on, a gallery's videos (and every run's) play together on the card's transport bar, or on the section's when the card follows the section slider.
- **Point cloud, mesh, boxes**: one viewer per run, with a tab per item the Index selects. The chosen tab applies to every run's pane. Browsers limit a page to about 16 live 3D viewers, so a 3D card's Column content defaults to Run (one viewer per run), and it does not open one per item unless its layout asks for it (Column content Index or Step, a grid, compare); keep such cards to a few tiles with **Media limit**.

A step change swaps the whole gallery once all its items have loaded; until then the previous step stays on screen. Runs side by side (the Gallery mode's panes, grid cells, compare slots) switch steps together. The histogram card's heatmap shows one item of a list at a time: step through them with **Index ‹ ›** above it.

### Image

The Values tab has the slider key and **Compare**. The Display tab has layout, **Show pane labels**, **Rendering**, and **Overlays**.

Zoom and pan:

- Scroll to zoom around the cursor, and drag to pan.
- Double-click to reset the view.
- Every pane of the card zooms and pans together. Each pane shows the same point of its own image at its centre, at the same zoom relative to the fitted image, whatever the pane's size or the image's shape.
- Resizing the card or the window, opening the card's settings view, and collapsing and expanding the card keep that point at the centre and keep the zoom.
- **Rendering** *(default)* controls upscaling. `auto` switches to nearest-neighbour once a source pixel covers more than about 1.5 screen pixels. You can also force `smooth` or `pixelated`.

**Split view against a reference.** Under **Compare → Reference tag**, pick another image tag. Each pane then splits its image against that tag *from its own run*:

- The **reference is on the left** and the **image is on the right** of a vertical divider.
- Drag the divider to move it. The position is shared by every pane *(default)*.
- Click a pane to focus it, then press ++arrow-left++ to show all of the image or ++arrow-right++ to show all of the reference.
- **Pin reference step** freezes the reference at one step. When it is off, the reference follows the slider.

**Overlays** (bounding boxes and masks logged with the image):

- **Show boxes** and **Min box score**
- **Show masks** and **Mask opacity**
- **Classes**, to hide individual classes

On a card, only the controls for what the images actually carry are shown.

### Figure

Plotly figures, one pane per run and metric. A figure logged without a Plotly source (a matplotlib figure Plotly could not convert) shows its PNG in the image card's zoomable pane.

- **Runs:** with several runs, `Panes` puts figures side by side. `Overlay` merges every run's traces into one plot, when the figures can be merged.
- **Appearance** *(default)*: **Show modebar**, **Scroll to zoom**, **Hover mode** (closest, x/y unified, none), **Drag mode** (zoom, pan, select, lasso, none), **Show legend**, **WebGL**.
- **WebGL** (`auto` *(default)*, `on`, `off`; a workspace or section default can set it): draws `scatter` traces as `scattergl` when the figure is drawn. The stored figure is not changed. `auto` switches once the figure's scatter traces hold 1000 points or more together, the same cut-off as plotly.express's `render_mode="auto"`. `on` switches at any size, and `off` draws the figure as logged. All convertible traces of a figure switch together, so their drawing order stays the same. A trace stays SVG when it uses something `scattergl` can't draw: spline lines, stacking (`stackgroup`), fill patterns or gradients, marker gradients, and text shadows or case. Two traces joined by a `fill: "tonext*"` both switch or both stay SVG. 3D traces (`scatter3d`, `surface`, `mesh3d`, `cone`, `streamtube`, `isosurface`, `volume`), `splom` and `parcoords` always use WebGL.
- **3D scenes:** dragging rotates a 3D scene (Plotly's turntable) whatever the **Drag mode**, and the wheel zooms it (with **Scroll to zoom** on). **Drag mode** `none` keeps 3D scenes still too. A `dragmode` the figure sets on its scene wins. A figure with only 3D scenes and no margins of its own is drawn with thin margins, with its legend over the scene, so it fills small gallery cells.
- **3D camera:** rotating or zooming one pane or gallery item moves every other pane and item of the card with it, live while you drag. Stepping a 3D figure series keeps the camera you set. 2D figures follow live too: panning or wheel-zooming one pane moves every other pane with it while you drag (a box zoom applies on release, as it has no in-between view). Zoom ranges of 2D figures reset when the figure changes. **Reset view** restores the figure's own camera.

#### Many WebGL plots on one page

A browser keeps only about 16 live WebGL contexts per page, and Chrome silently drops the oldest when a plot asks for another one. Each 3D scene uses one context, a plot's 2D WebGL layer uses two, and parcoords uses three. Every Plotly plot that uses WebGL shares one page budget of 10 contexts. This covers figure cards, galleries and overlays, and also the scatter card.

- The plots you hover, then the ones on screen, then the ones within a screen of the viewport, get the budget first. Plots that have scrolled away keep their contexts until another plot needs room.
- A plot outside the budget is released and shows a picture of itself instead: a snapshot of how it last looked (with your camera and zoom), else the figure's stored PNG (when one was rendered with kaleido), else a note. It draws again, with the same camera and zoom, when it scrolls back into view or when you hover or click it.
- If the browser takes a context away anyway (other WebGL views on the page), the plot shows its picture instead of going blank. It draws again when you use it or scroll it back into view.

### Audio and video

Audio panes play the clip and show a waveform. Audio setting: **Autoplay** *(default)*.

Video panes zoom, pan and compare exactly like [image](#image) panes:

- Scroll to zoom around the cursor, drag to pan, double-click to reset. Every pane of the card zooms and pans together, and keeps its view through resizes and the settings view, as image panes do; the header's home button resets them all.
- **Rendering** *(default)*, on the Display tab: `auto` switches to nearest-neighbour once a source pixel covers more than about 1.5 screen pixels, or force `smooth` or `pixelated`.
- **Compare → Reference tag** (Values tab) picks another video tag. Each pane then splits its video against that tag *from its own run*: the **reference on the left**, the video on the right, with a draggable divider shared by every pane *(default)*, and ++arrow-left++ / ++arrow-right++ to show all of the video or all of the reference. **Pin reference step** freezes the reference at one step. In a gallery, a reference gallery pairs item by item; a single reference video serves every item.

Playback runs on a transport bar under the panes, not on each player's own controls, so zooming never covers them. The video and its reference always play on the same clock: they play, pause and seek together and show the same frame. When the slider changes step, the new videos load out of sight and every pane of the card switches once all of them show the clock's current frame. The previous step stays on screen until then, so stepping never blanks a pane or shows a poster frame.

Video settings, under **Playback** *(default)*:

- **Synced playback:** the card's panes play, pause and seek together on one transport bar. While the card follows its section, it uses the section's clock, so every synced video in the section stays in step. Turned off, each of several panes gets its own transport bar.
- **Autoplay**, **Loop**, **Muted** (a reference is always muted)
- **Preload:** metadata, auto or none

### HTML and Markdown

- **HTML** is its own page in a sandboxed iframe, as with `wandb.Html`: its scripts run, and it can load anything from the web, such as scripts from a CDN, images and embedded pages. It has no access to cairn: it runs under an opaque origin with no cookies, no storage of cairn's and no API, and it cannot navigate the app away. Links can open in a new tab. Embedded YouTube players stay black, because YouTube needs an origin of its own and the sandbox is inherited by the frames it embeds. Settings: **Auto height** to fit the content, or a fixed height *(default)*.
- **Markdown** renders GitHub-flavoured Markdown plus Pandoc's extensions, math included (see [Logging media › Markdown](../guides/media.md#markdown)). Raw HTML in the source is shown as text. Setting: **Font size** *(default)*.

### Histogram and tensor

- **Histogram:** **View** *(default)* **Heatmap (over steps)**, as wandb draws histograms: x is the step, y the value, and a cell's colour is the share of that step's samples in the bin (light grey low, blue high). Every run of the card has its own strip, stacked on one value axis and labelled with the run's name and colour dot; when the workspace is grouped, each innermost group is one strip that pools its runs' histograms per step. Hover a cell to see that step's histogram of the strip as small bars, with the hovered bin's count. **Bars (per step)** shows the histograms at the slider's step instead, the runs overlaid in their colours. **X axis**: **Step** *(default)*, **Relative time** (seconds since the run started) or **Wall time**. There is also **Log colour scale** (bars: **Log Y axis**) and **Colormap** (default **Blues**). For a list of histograms the heatmap shows one index at a time (**Index ‹ ›**); bars follow the card's Index.
- **Tensor:** set **View** *(default)* to **Stats**, **Histogram** (with **Bins**) or **Heatmap** (with **Colormap**). For an array with more than two dimensions, the **Slice dim** controls pick the index of each leading dimension, and the heatmap shows the last two.

### 3D and volume

Point clouds, meshes and boxes render in an orbitable 3D view, one pane per run.

- **Sync cameras** *(default)*: orbiting one pane moves them all.
- **Reset camera**
- Per-kind view options:
    - point clouds: point size and colouring
    - meshes: colouring and wireframe
    - boxes: colouring

Volume cards draw the volume with `cairn.volume`, the [built-in viewer](../guides/custom-viewers.md#built-in-viewers) cairn ships: WebGL2 ray marching with a colormap transfer function, density, step count, a threshold and a slice plane (gear › Display), drag to orbit and wheel to zoom. A project can make another viewer the default for volumes (Defaults › **Default viewer per type**), and a card can pin its own (in a workspace, the viewer's entry in the gear's **Type** tab; in a report, gear › Values › Series › **Viewer**). Without WebGL2, each pane offers the step's `.npz` for download.

Every kind of data has one [default viewer](../guides/custom-viewers.md#default-viewers): other built-in types show in their built-in card unless the project makes a custom viewer their default.

### Custom viewer

A custom viewer card draws its data with one of the project's [custom viewers](../guides/custom-viewers.md#how-cards-pick-a-viewer), in a sandboxed frame per pane, with the step slider, galleries, the panel modes and the section slider of the other media cards. The gear's **Type** tab names each viewer that accepts the card's data by its title, after **Default (<name>)**.

- **Viewer**: **Default (<name>)** (the project's [default viewer](../guides/custom-viewers.md#default-viewers) of the data's kind) or a named one. In a workspace it is the card type (gear › **Type**); in reports and share links, Values › Series › **Viewer**. **Version** (Values › Series): `latest` or a published `vN`.
- **Reference tag** and **Pin reference step** (Values › Compare): a `compare` viewer gets the value and the reference together; any other viewer shows the reference as a second frame.
- The viewer's own settings, in the tabs and sections its manifest names. They cascade from section and workspace defaults per viewer.
- **Reset view** in the header clears a viewer's stored camera (viewers with a shared view).

### Confusion / PR / ROC (`preset`)

- **Confusion matrices** show as heatmaps side by side. **Normalize** *(default)* shows raw counts, or scales rows or columns to sum to 1.
- **PR and ROC curves** overlay every run: one colour per run and one dash per class, with the AUC in the legend.

### Text and artifact

- **Text** shows the logged text at the slider's step, one pane per run, with the slider key, [Index, layout and media limit](#index-layout-and-media-limit) of the other media cards. Settings: **Font size**, **Word wrap** *(default)*.
- **Artifact** shows a pickled point (`cairn.Pickle`) or the versions of an artifact the run logged: a one-file version in the viewer for its kind (an image zooms, a table sorts, as in the [explorer](artifacts.md#files)); otherwise file names, sizes and MIME types with download links, and a step slider over the steps they were logged at (a version without a step sits at its version number).

## Table

Logged tables at the slider's step, as wandb's table panel: with several runs, every run's rows in one table behind a leading `run` column with the run's colour dot. Cells that hold `cairn.Image`, `Audio` or `Video` render inline; click **Enlarge** to open an image or video in the image card's zoomable pane or the video card's player.

- Click a column header to sort (ascending, descending, off). The sort is kept with the card.
- **Columns** (beside the query bar): show or hide each column and move it up or down; **Show all** / **Hide all**.
- **Reset**: the query, sort, columns and page size back to their defaults.
- Below the table: **Rows** per page (10, 25, 50, 100) and `1–10 of 23` with previous / next.
- **Download data** in the header exports what the table shows as CSV: its columns in their order and every row in its sort order, all pages.

**Query bar.** Above the table, type a boolean [expression](../reference/expressions.md) over the columns to keep only the rows where it is true. Examples: `score > 0.5` or `` `pred/label` != null ``.

- Refer to a column by its bare name. Dots are part of the name, so `a.b` is one column.
- Use backticks when a column name is not a plain identifier.
- `config.<col>` also names a column.

If the query has an error, it is reported and not applied.

| Tab | Settings |
|---|---|
| Values | **Tables**: `Rows` *(default)* stacks every series' table at the slider's step into one, with a leading `run` column. `Panes` shows one pane per series, side by side. `Concat` stacks the tables into one, with a leading `source` column. `Join` joins the first two sources on a **Key column** (inner, left or outer). By default the key is the shared id-like first column, or rows are matched by position. Clashing columns get `_1` / `_2` suffixes. Each source is a series at the slider's step or at a fixed step. |
| Grouping | **Group by** key columns, with aggregates: `count`, `sum`, `mean`, `min`, `max`, `first`, `nunique`. |
| Display | **Rows per page** *(default)*. **Columns**: show or hide. **Compare** (`Panes`): **Diff colors** colours numeric cells red/green against the other runs, and is on by default with exactly two runs. **Invert colors**. **Text diff** *(default)*: off, words, chars or lines. It marks what changed in text cells against the first table, or `x_2` against `x_1` in a join. |
| Expressions | **Derived columns**: a name and an expression evaluated per row, e.g. `score * 100`. |

The pipeline runs in this order: derived columns, then the query, then group-by.

## Multi-run cards

These cards take the set of runs in their workspace or report. Where a setting asks for a value, it takes a scalar [expression](../reference/expressions.md) that gives one number per run, such as `last(acc)`, `min(val.loss)` or `config.lr`. The parallel-coordinates and parameter-importance cards instead read config keys and metrics by name: a metric's value is its final value under the project's [summary rule](../guides/metric-rules.md), as in the runs table. Hidden runs are left out.

### Parallel coordinates

```
┌ Parallel coordinates ──────────────────────────────── ⚙ ✕ ┐
│  lr        batch_size   model.depth   noise     eval/mse   │
│ 1e-3 ┬       128 ┬          8 ┬       0.5 ┬      0.50 ┬    │
│      │ ╲╲        │ ╱        ╱ │         │ ╲        │       │
│ 1e-5 ┴        32 ┴          2 ┴       0.0 ┴      0.10 ┴    │
│ drag along an axis to brush · 12 runs                      │
└────────────────────────────────────────────────────────────┘
```

One line per run across its axes. By default the axes are the config keys that vary across the card's runs, then the **metric** (the first metric with a goal, unless you choose one). An axis of numbers is linear, or log with its **log** setting; an axis of anything else shows its values as ordered categories. A run without a value on an axis skips it.

- **Brush:** drag along an axis to keep the lines inside that range coloured and dim the rest; brush several axes to combine them, click an axis to clear its brush. Brushes are not saved.
- **Hover** a line for its values; in the [project workspace](project-workspace.md) its row in the runs sidebar lights up.
- **Grouped workspace:** one line per innermost group, at the mean of its runs for numbers; a category shows only when all of the group's runs agree, else the line skips that axis.
- **Many axes:** the default axes are spaced at least 64 px apart. When more config keys vary than fit the card's width, the card shows the metric and the config keys the runs vary most along, in their usual order, and the footer says `7 of 41 axes`. How much the runs vary along a key is the entropy of its values: numbers are counted in 10 equal bins over their range (in log10 when they are all positive and span more than two decades, such as a learning rate), anything else by distinct value. Add the others under **Axes** in the settings. The expanded card is wider and shows more.
- **Axis labels** never overlap: when an axis's name does not fit between its neighbours, the names alternate between two rows, and a name still too long for its room ends in `…`. Hover a name for the full one.

| Tab | Settings |
|---|---|
| Values | **Metric**. **Axes**: add config keys and metrics, remove or reorder them, **log** per axis; **Default axes** goes back to the varying config keys (the most varying ones that fit) and the metric. |
| Display | **Line colour**: a **gradient by the last axis** *(default)* or the **run colours** (group colours when grouped). |

### Scatter plot

| Tab | Settings |
|---|---|
| Values | **X**, **Y** and optional **Colour**, a colour scale; unset uses each run's colour. |
| Display | **X range** / **Y range**, with log. **Pareto front** *(default)*, with **better is** per axis. By default the direction is the goal of the axis's metric in the project ([metric rules](../guides/metric-rules.md#project-overrides)), else min. **Dim points off the front** *(default)*. **Running lines**: min, max or mean of y as x grows *(default)*. **Regression line**, fitted in log space on log axes *(default)*. Up to 5 **reference lines**. **Point label** template and **Tooltip fields**. |

Click a point to open its run.

### Bar chart

| Tab | Settings |
|---|---|
| Values | **Value**, **Log value axis**. |
| Grouping | **Group runs by**: an expression such as `run.group` or `config.optimizer`. **Plot** *(default)*: each group's mean as a bar (± std), or a box, violin or strip of its runs. |
| Display | **Compare runs**: grouped, stacked or overlay. **Sort by** value or name, **Descending** *(default)*. |

### Scalar tile

A single number. **Value** is reduced across runs by **Across runs** *(default)*: **Best** (with **Best is** maximum or minimum), **Mean** or **Latest run**.

### Parameter importance

```
┌ Parameter importance for [eval/mse ▾] ───────────────── ⚙ ✕ ┐
│ Parameter      Importance ↓          Correlation            │
│ lr             ████████░░  0.62      ▓▓▓▓ +0.71             │
│ model.depth    ███░░░░░░░  0.21      ▓▓   −0.33             │
│ noise          ██░░░░░░░░  0.12      ░     +0.05            │
│ 12 runs · random forest + correlation                       │
└─────────────────────────────────────────────────────────────┘
```

Which config keys explain a metric, as in wandb. Pick the metric in the title (default: the first metric with a goal). One row per config key that varies across the runs:

- **Importance:** a random forest (100 trees, bootstrap samples, a random subset of the keys at each split, a fixed seed so the result is stable) predicts the metric from the config; a key's importance is how much its splits reduce the error, and the importances sum to 1. A key of text values counts as one key.
- **Correlation:** the linear correlation (Pearson r) between a numeric key and the metric, "—" for keys of text values. Its bar is green when raising the key moves the metric towards its [goal](../guides/metric-rules.md) (goal lower: a negative correlation), red when it moves it away, and grey when the metric has no goal.

Click **Importance** or **Correlation** to sort by it (correlation: the strongest first, either sign). The card needs at least 5 runs with the metric. In a grouped workspace it uses the runs of the shown groups, not their means. Settings: **Metric** and **Sort by**.

### Run comparer (`run-compare`)

One column per run, with tables of final metric values, params and the captured environment. For metrics with a goal in the project, the best value is green and the worst red (see [Final values and metric rules](../guides/metric-rules.md)); metrics without a goal are not coloured.

Settings:

- **Tables** *(default)*: which tables to show, and their order.
- **Filter**: a key substring.
- **Pinned keys**: always shown first.
- **Only differences** *(default)*: hides rows that are the same in every run.

### Scalars (`scalars`)

One table: a row per run, or per innermost group when the [project workspace](project-workspace.md) is grouped, labelled and coloured as in the charts. Its columns:

- **Run info** (status, duration, created, user, host) first, while **Show run info** *(default)* is on.
- Every scalar logged at a single step, A–Z.
- The runs' `run.summary(...)` values, A–Z, with italic headers.

A group's cell is the mean over its runs that have a value, its earliest created time, or a shared text value (`mixed` when its runs differ); `—` when none has one. Click a header to sort by it: ascending, descending, then unsorted; empty cells go last. A single-step metric column's ▾ opens the [metric column menu](runs-table.md#metric-column-menu): sort, the project's **Summary** and **Goal** for the metric, **Reset to logged** and **Hide column** (settings → **Show hidden columns** brings hidden ones back). In a metric column with a goal and at least two values, the best cell is green and the worst red, as in the run comparer; tied cells share the colour, empty and `mixed` cells get none. The [Summary section](workspace.md#automatic-panels) has one automatically.

### Config (`config`)

The config's keys as rows (nested keys dotted, `model.depth`), after **tags** and **notes**, with a column per run, or per innermost group when the project workspace is grouped. A group's cell shows the value when all its runs with a config agree, else a muted `mixed`. The rows whose values differ across the columns are tinted, as in the run comparer. **only diffs** *(default)*, in the header and the settings, hides the keys that are the same in every column. The [Summary section](workspace.md#automatic-panels) has one automatically.

### Code diff (`code-diff`)

Diffs the source snapshots of two runs. The runs must have captured their source (`capture_source`).

Settings:

- **Before** / **After:** default to the card's first two runs.
- A file picker. It defaults to the first changed file.
- **Layout** *(default)*: split or unified.
- **Only changed files** *(default)*.
- **Context lines** *(default)*: unchanged lines kept around each change. Empty shows the whole file.
