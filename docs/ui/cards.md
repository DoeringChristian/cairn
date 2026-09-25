# Cards

A card shows one logged series, or a set of runs, in the [workspace](workspace.md), in [comparisons](comparisons.md) and in [reports](reports.md). This page lists every card type, what data it shows, and its settings. For how settings inherit (card → section → workspace → built-in) and the ↺ reset, see [Defaults cascade](workspace.md#defaults-cascade).

Settings are grouped into up to four tabs: **Data**, **Grouping**, **Display** and **Expressions**. A card shows only the tabs it uses. Some settings appear only when a card has more than one run. Settings marked *(default)* in the tables below can also be set as section or workspace defaults.

## Card types

Series cards show one logged name (plus any extra series you add), and the Python type you log decides which card you get. Multi-run cards show a set of runs rather than one series. You add them to [comparisons](comparisons.md) and reports with **Add card**.

| Type | Card | Shows | Logged with |
|---|---|---|---|
| `scalar` | Line plot | Metric curves | `run.track(value, name=…)` |
| `image` | Image | Images, galleries, boxes and masks | `cairn.Image` |
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
| `volume` | Volume | A placeholder with a `.npz` download (volumes are not rendered) | `cairn.Volume` |
| `preset` | Confusion / PR / ROC | Confusion matrices, PR and ROC curves | `cairn.ConfusionMatrix`, `PRCurve`, `ROCCurve` |
| `artifact` | Artifact | File name, size and MIME type, with a download link | `run.log_artifact(...)` |
| `parallel` | Parallel coordinates | One polyline per run across expression columns | multi-run |
| `scatter` | Scatter plot | One point per run | multi-run |
| `bar` | Bar chart | One bar (or distribution) per run or group | multi-run |
| `tile` | Scalar tile | One number reduced across runs | multi-run |
| `importance` | Parameter importance | Which params explain a target | multi-run |
| `run-compare` | Run comparer | Metrics, params and environment side by side | multi-run |
| `code-diff` | Code diff | Two runs' source snapshots diffed | multi-run |

See [Media and rich types](../guides/media.md) for the logging side. When a series has an unknown type, its card shows the type, the point count and a download button.

## Common card actions

A card header has these actions (which ones appear depends on the card and the page):

- **Title:** double-click or click the pencil to rename the card.
- **Chevron:** collapse the card.
- **House:** reset the zoomed view. It only appears while you are zoomed.
- **Save:** download the data.
- **Screenshot**
- **Add to comparison**
- **Add to report:** see [Reports](reports.md).
- **Comment:** in reports only.
- **Gear:** opens the card full screen with its settings (see [Full-screen card](workspace.md#full-screen-card-and-settings)).
- **×:** remove the card.

Cards that plot several series show them as chips. Click a chip's × to remove that series. You can drag a chip onto another card to add the series there.

## Line plot (`scalar`)

A scalar's curve, one line per run.

**Mouse and touch controls:**

- Drag to zoom. A mostly horizontal drag zooms only x, a mostly vertical drag zooms only y, and anything else zooms a box.
- Double-click (on touch, double-tap) to reset the zoom.
- ++cmd++ / ++ctrl++-click a line to open its run.
- With **Sync zoom** on in the workspace toolbar, charts that share an x-axis zoom together.

| Tab | Settings |
|---|---|
| Data | **Metrics** (the series drawn). **X axis**: `step`, `wall_time`, `relative_time` or a metric *(default)*. **X range** / **Y range**, **Log x** / **Log y** *(default)*. **Smoothing**: kind and amount *(default)*. **Outliers**: low/high percentile to clip the y range to *(default)*. **Max runs**: pinned runs come first *(default)*. |
| Grouping | **Group runs by**: None, Group, Job type or a Param. Runs that share the value draw as one centre **Line** (mean, median, min or max) with a **Band** (std, min–max or sem). **Hide member runs**, **Latest run per group** *(all default)*. Shown only when the card has several runs. |
| Display | **Line type**: linear, monotone, step, step before, step after. **Stack**: none, stacked, percent. **Show original**: the faded raw line under a smoothed one. **Full fidelity**: per-pixel min/max, recomputed on zoom. Axis titles. **Legend** on/off, position and template. **Tooltip** template and wall time *(most default)*. Each series also has its own **Colour**, **Label** and **Style**. |
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

Image, figure, audio, video, HTML, Markdown, tensor, 3D, volume and preset cards all use the same step slider.

### Step slider and slider key

The slider picks which logged step each pane shows. The **Slider key** *(default)* sets what one slider position means:

- `step` (the default): each logged step is one position.
- A scalar metric, such as `epoch`: each run's media is looked up **as of** each step, using the key's last value at or before that step. The slider then picks, in every run, the media logged while the key held that value, even when runs reach it at different steps. When several steps share a value, the position shows the newest of them.

The slider saves a *value* rather than an index, so the position stays put when new steps arrive.

### Section media sync

When **Follow section slider** is on *(default; on by default)*, a media card follows its section's shared slider. The section shows that slider above its cards. It covers the union of every following card's values and has its own key field. When a section has synced videos, the bar also gets play/pause. Turn **Follow section slider** off to give the card its own slider. The section slider position is remembered in this browser.

### Layout: gallery, grid, compare

Image, audio, video, HTML and Markdown cards have a **Mode** *(default)*:

| Mode | Layout |
|---|---|
| **Gallery** | One pane per run, all at the slider's value, in **Columns** columns. `auto` means up to two, and one on phones. |
| **Grid** | Runs as rows and slider values as columns (5 values when columns is `auto`). Click a column header to move the slider there. |
| **Compare** | 2–4 **Slots**. Each slot picks its own run. While the slots are linked to the slider they share its value; unlink them to pick a value per slot. |

**Max runs** *(default)* shows only the first N runs; 0 shows them all. Figure, preset (confusion matrix), 3D and volume cards have **Columns** and **Max runs** but no modes.

### Image

The Data tab has the slider key and **Compare**. The Display tab has layout, **Show pane labels**, **Rendering**, and **Overlays**.

Zoom and pan:

- Scroll to zoom around the cursor, and drag to pan.
- Double-click to reset the view.
- Every pane of the card zooms and pans together.
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

Plotly figures, one pane per run and metric.

- **Runs:** with several runs, `Panes` puts figures side by side. `Overlay` merges every run's traces into one plot, when the figures can be merged.
- **Appearance** *(default)*: **Show modebar**, **Scroll to zoom**, **Hover mode** (closest, x/y unified, none), **Drag mode** (zoom, pan, select, lasso, none), **Show legend**.

### Audio and video

Audio panes play the clip and show a waveform. Audio setting: **Autoplay** *(default)*.

Video settings, under **Playback** *(default)*:

- **Synced playback:** the card's panes play, pause and seek together on one transport bar. While the card follows its section, it uses the section's clock, so every synced video in the section stays in step.
- **Autoplay**, **Loop**, **Muted**
- **Preload:** metadata, auto or none

### HTML and Markdown

- **HTML** runs in a sandboxed iframe with scripts enabled but no access to cairn. Settings: **Auto height** to fit the content, or a fixed height *(default)*.
- **Markdown** renders GitHub-flavoured Markdown. Raw HTML in the source is shown as text. Setting: **Font size** *(default)*.

### Histogram and tensor

- **Histogram:** set **View** *(default)* to **Bars (per step)** at the slider's step, or **Heatmap (over steps)**, which needs more than 3 steps. There is also **Log Y axis** (in heatmap view, log colour scale) and **Colormap**.
- **Tensor:** set **View** *(default)* to **Stats**, **Histogram** (with **Bins**) or **Heatmap** (with **Colormap**). For an array with more than two dimensions, the **Slice dim** controls pick the index of each leading dimension, and the heatmap shows the last two.

### 3D and volume

Point clouds, meshes and boxes render in an orbitable 3D view, one pane per run.

- **Sync cameras** *(default)*: orbiting one pane moves them all.
- **Reset camera**
- Per-kind view options:
    - point clouds: point size and colouring
    - meshes: colouring and wireframe
    - boxes: colouring

Volume cards don't render the volume. Each pane offers the step's `.npz` for download.

### Confusion / PR / ROC (`preset`)

- **Confusion matrices** show as heatmaps side by side. **Normalize** *(default)* shows raw counts, or scales rows or columns to sum to 1.
- **PR and ROC curves** overlay every run: one colour per run and one dash per class, with the AUC in the legend.

### Text and artifact

- **Text** shows the logged text at the slider's step. Settings: **Font size**, **Word wrap** *(default)*.
- **Artifact** shows a named artifact's file name, size and MIME type, with a download link and a step slider over the steps it was logged at.

## Table

Logged tables, one pane per run. Cells that hold `cairn.Image`, `Audio` or `Video` render inline; click **Enlarge** to open one. Click a column header to sort (ascending, descending, off). **Save** downloads the current table as CSV.

**Query bar.** Above the table, type a boolean [expression](../reference/expressions.md) over the columns to keep only the rows where it is true. Examples: `score > 0.5` or `` `pred/label` != null ``.

- Refer to a column by its bare name. Dots are part of the name, so `a.b` is one column.
- Use backticks when a column name is not a plain identifier.
- `config.<col>` also names a column.

If the query has an error, it is reported and not applied.

| Tab | Settings |
|---|---|
| Data | **Tables**: `None` shows one pane per series. `Concat` stacks the tables into one, with a leading `source` column. `Join` joins the first two sources on a **Key column** (inner, left or outer). By default the key is the shared id-like first column, or rows are matched by position. Clashing columns get `_1` / `_2` suffixes. Each source is a series at the slider's step or at a fixed step. |
| Grouping | **Group by** key columns, with aggregates: `count`, `sum`, `mean`, `min`, `max`, `first`, `nunique`. |
| Display | **Rows per page** *(default)*. **Columns**: show or hide. **Compare**: **Diff colors** colours numeric cells red/green against the other runs, and is on by default with exactly two runs. **Invert colors**. **Text diff** *(default)*: off, words, chars or lines. It marks what changed in text cells against the first table, or `x_2` against `x_1` in a join. |
| Expressions | **Derived columns**: a name and an expression evaluated per row, e.g. `score * 100`. |

The pipeline runs in this order: derived columns, then the query, then group-by.

## Multi-run cards

These cards take the set of runs in their comparison or report. Where a setting asks for a value, it takes a scalar [expression](../reference/expressions.md) that gives one number per run, such as `last(acc)`, `min(val.loss)` or `config.lr`. Hidden runs are left out.

### Parallel coordinates

Each column is a scalar expression, and each polyline is a run. Lines are coloured by the rightmost column. For each column you can invert its axis, move it, or remove it.

### Scatter plot

| Tab | Settings |
|---|---|
| Data | **X**, **Y** and optional **Colour**, a colour scale; unset uses each run's colour. |
| Display | **X range** / **Y range**, with log. **Pareto front** *(default)*, with **better is** per axis. By default the direction comes from the metric's summary rule, else min. **Dim points off the front** *(default)*. **Running lines**: min, max or mean of y as x grows *(default)*. **Regression line**, fitted in log space on log axes *(default)*. Up to 5 **reference lines**. **Point label** template and **Tooltip fields**. |

Click a point to open its run.

### Bar chart

| Tab | Settings |
|---|---|
| Data | **Value**, **Log value axis**. |
| Grouping | **Group runs by**: an expression such as `run.group` or `config.optimizer`. **Plot** *(default)*: each group's mean as a bar (± std), or a box, violin or strip of its runs. |
| Display | **Compare runs**: grouped, stacked or overlay. **Sort by** value or name, **Descending** *(default)*. |

### Scalar tile

A single number. **Value** is reduced across runs by **Across runs** *(default)*: **Best** (with **Best is** maximum or minimum), **Mean** or **Latest run**.

### Parameter importance

For a **Target** expression, one bar per param. The **Method** *(default)* is either:

- **importance:** permutation importance from a seeded random forest.
- **correlation:** Pearson r, for numeric params only.

Bars are coloured by the sign of the correlation.

### Run comparer (`run-compare`)

One column per run, with tables of final metric values, params and the captured environment. For metrics, the best value is green and the worst red, following each metric's summary rule (see [Final values and metric rules](../guides/metric-rules.md)).

Settings:

- **Tables** *(default)*: which tables to show, and their order.
- **Filter**: a key substring.
- **Pinned keys**: always shown first.
- **Only differences** *(default)*: hides rows that are the same in every run.

### Code diff (`code-diff`)

Diffs the source snapshots of two runs. The runs must have captured their source (`capture_source`).

Settings:

- **Before** / **After:** default to the card's first two runs.
- A file picker. It defaults to the first changed file.
- **Layout** *(default)*: split or unified.
- **Only changed files** *(default)*.
- **Context lines** *(default)*: unchanged lines kept around each change. Empty shows the whole file.
