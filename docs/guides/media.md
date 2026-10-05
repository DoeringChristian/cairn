# Media and rich types

`run.track` records any value that cairn has a handler for. Scalars and strings are recognized
automatically. For everything else you wrap the value in a type such as `cairn.Image` or
`cairn.Table`. The wrapper tells cairn how to store the value and which card the UI uses to show
it.

```python
run.track(cairn.Image(frame), "camera", step)
run.track(cairn.Histogram(weights), "weights", step)
run.track(cairn.Table(dataframe=df), "predictions", step)
```

Every media point belongs to a series like a scalar does: it has a name and a step, and the UI
lets you move through the steps. Wrapper keyword arguments can also be passed to `run.track`
itself, and the two are merged: `run.track(cairn.Image(x), "img", step, caption="…")`.

## Automatic detection

When you pass an unwrapped value, cairn picks the handler:

| Value | Stored as |
|---|---|
| `int`, `float`, `bool`, NumPy scalar | scalar |
| `str` | text |
| PIL image | image |
| NumPy array or torch tensor with 3 dimensions | image |
| NumPy array or torch tensor with 4 dimensions, or a list of frames | video (with the `media` extra) |
| NumPy array or torch tensor with 1 or 2 dimensions | **audio** |
| matplotlib or Plotly figure | figure |

!!! warning "Wrap 2-D arrays"
    An unwrapped 2-D array is detected as audio, not as a grayscale image. Wrap arrays
    explicitly (`cairn.Image(arr)`) whenever the type matters.

Anything else raises `TypeError` unless you wrap it or [register a handler](#custom-types).

## Images

```python
run.track(cairn.Image(img), "sample", step)
```

`cairn.Image` takes a PIL image, a NumPy array or a torch tensor with shape `H×W`, `H×W×C` or
`C×H×W` (C = 1, 3 or 4), or a matplotlib or Plotly figure, which is rasterized.

### Pixel values

Values are interpreted by **dtype**, never by their content:

| dtype | Range |
|---|---|
| float | `[0, 1]` |
| `uint8` | `[0, 255]` |
| other integers | the dtype's full range (e.g. `uint16` is `[0, 65535]`) |

Values outside the range are clipped. cairn never rescales an image to its own min and max, so
the same value always has the same brightness across steps and runs.

If your data is scene-linear, such as a render or radiance, pass `linear=True`. cairn then
applies the sRGB transfer function for display:

```python
run.track(cairn.Image(render, linear=True), "render", step)
```

### Colormaps

For single-channel data, `colormap=` bakes a colormap into an RGB PNG:

| Colormap | Default range |
|---|---|
| `"turbo"`, `"magma"` | `[0, 1]` |
| `"red-blue"`, `"red-green"` | `[-1, 1]`, white at zero |

The range is fixed, the same for every image and step, unless you override it with `vmin` and
`vmax`. Values outside the range are clipped.

```python
run.track(cairn.Image(error, colormap="red-blue", vmin=-0.05, vmax=0.05), "error", step)
```

### Storage encoding

By default images are stored as 8-bit PNGs. For float and integer arrays you can keep more
precision with `encoding=`:

| `encoding` | Stores |
|---|---|
| `"png"` (default) | 8-bit display values, mapped as described above |
| `"exr[:<compression>[:<precision>]]"` | OpenEXR with the actual values. Compression is `piz` (default), `zip`, `zips`, `none`, or the lossy `dwaa`/`dwab`. Precision is `auto` (default: half unless the values don't fit), `half` or `float` |
| `"npy"` | the exact array bytes, with any number of channels |

```python
run.track(cairn.Image(hdr, linear=True, encoding="exr:dwab"), "radiance", step)
run.track(cairn.Image(features, encoding="npy"), "features", step)   # e.g. 5 channels
```

PIL images, figures and `uint8` arrays are always stored as PNG. PNG and EXR need 1, 3 or 4
channels, so use `"npy"` for anything else. The viewer displays PNGs directly. For other
encodings it shows a thumbnail and offers the file for download.

### Captions and galleries

`caption=` labels a point:

```python
run.track(cairn.Image(img, caption=f"epoch {epoch}"), "sample", step)
```

A **list** of media of one kind logged under one name and step is a **gallery**: one point
whose items the kind's card shows side by side, stepping together with the slider. It works for
every media kind: images, figures, audio, video, text, HTML, Markdown, histograms, tensors,
point clouds, meshes, boxes and volumes. Each item keeps its own caption, and a `caption=` passed
to `run.track` labels the whole point:

```python
run.track([cairn.Image(a, caption="input"), cairn.Image(b, caption="output")], "pair", step)
run.track([cairn.Figure(fig, caption=f"head {i}") for i, fig in enumerate(figs)], "attention", step)
run.track([cairn.Video(clip, fps=8) for clip in clips], "rollouts", step, caption="3 seeds")
run.track([cairn.Text(log) for log in worker_logs], "workers", step)
```

The items are either wrappers of one type, or raw values that would each be detected as the same
type on their own (a list of Plotly or matplotlib figures is a figure gallery). Keywords passed
to `run.track` apply to every item. Some lists are not galleries:

- Items of different kinds raise `ValueError`: log each kind under its own name.
- A list of raw numbers or strings (or dicts, or nested lists) raises `TypeError`, as before.
  Wrap strings in `cairn.Text` for a text gallery.
- A list of raw frames (PIL images, `H×W×C` arrays) is one **video**, as in the table above.
  Wrap them in `cairn.Image` for an image gallery.
- Tables, presets and `cairn.Pickle` have no gallery (`TypeError`).
- `summary=` and `x=` are for scalars only, so they raise `ValueError` on a gallery.

How each card shows a gallery:

- Image, figure, histogram and tensor cards: a near-square grid of the items filling the pane.
  Figures share one zoom, as panes do.
- Audio, video, HTML, Markdown, text and volume cards: the items one under another, or in a
  grid. A gallery's videos play together on the card's transport bar (with **Sync playback** on)
  or on the section's.
- 3D cards (point cloud, mesh, boxes): one viewer per run with a tab per item, since browsers
  limit how many 3D viewers a page can hold.

In every card a step change swaps the whole gallery at once, when all its items have loaded, and
runs compared side by side switch together.

Each item is stored as a blob of its own, and the point's blob is a small JSON manifest naming
them. `Run.media(name, step)` returns the list of `MediaRef`s with their captions; `.load()` on
each decodes it (see [Reading runs](reading.md)).

### Boxes and masks

Bounding boxes and segmentation masks are stored with the image, and the viewer draws them as
overlays:

```python
run.track(cairn.Image(
    img,
    boxes=[{
        "position": {"minX": 0.1, "minY": 0.2, "maxX": 0.5, "maxY": 0.6},
        "domain": "fraction",      # or "pixel"; default "fraction"
        "class_id": 1,
        "label": "cat",            # optional
        "score": 0.92,             # optional
    }],
    masks={"prediction": pred_ids, "ground_truth": gt_ids},   # 2-D arrays of class ids
    class_labels={0: "background", 1: "cat", 2: "dog"},
), "detections", step)
```

- `boxes`: at most 500 per image.
- `masks`: a dict of named 2-D arrays of class IDs in `[0, 255]`, with 0 as background. Each
  mask is PNG-encoded and may be at most 2 MB after encoding. Downsample larger masks before
  logging.
- `class_labels`: one mapping from class ID to name, shared by boxes and masks.

## Audio

```python
run.track(cairn.Audio(samples, sample_rate=22050), "speech", step)
```

`samples` is a 1-D array (mono) or 2-D array (channels × frames, or frames × channels) from NumPy
or torch. The default `sample_rate` is 16000. Audio is stored as 16-bit WAV. Float input whose
peak exceeds 1 is scaled down to a peak of 1.

## Video

```python
run.track(cairn.Video(frames, fps=15), "rollout", step)       # T×H×W×C, T×C×H×W or T×H×W
run.track(cairn.Video("render.mp4"), "render", step)          # an existing file, stored as-is
```

Frames are arrays or tensors, or a list of frames. Their values follow the same rules as images
(float `[0, 1]`, `uint8` `[0, 255]`, `linear=True` for linear data). Frames are encoded as H.264
MP4 at `fps` (default 30), which needs the `media` extra. A path to an existing video file (mp4,
webm, …) is stored unchanged.

## Figures

```python
fig, ax = plt.subplots()
ax.plot(xs, ys)
run.track(fig, "curve", step)              # detected automatically
run.track(cairn.Figure(fig), "curve", step)
```

Figures are stored twice: as a PNG for thumbnails, and, when possible, as Plotly JSON so the
card is interactive. A Plotly figure keeps its own JSON. A matplotlib figure is converted with
Plotly's converter when Plotly is installed. Rendering Plotly figures to PNG needs `kaleido`
(part of the `media` extra). Use `cairn.Image(fig)` if you only want a flat image.

!!! tip "Large and 3D Plotly figures"
    Build large scatter plots with WebGL: `go.Scattergl` instead of `go.Scatter`, or
    `px.scatter(..., render_mode="webgl")`. The figure card also switches `scatter` traces to WebGL
    when it draws a figure with 1000 points or more (its **WebGL** setting; the stored figure is not
    changed). 3D traces (`scatter3d`, `surface`, `mesh3d`, `volume`, …) always draw with WebGL.
    The UI caps how many WebGL plots are live on a page. Plots beyond the cap show a picture of
    themselves until you scroll back to them or hover them. See
    [Cards › Figure](../ui/cards.md#figure).

## Text, HTML and Markdown

```python
run.track("Loaded 50k samples", "log.info", step)              # plain text
run.track(cairn.Text(obj), "repr", step)                        # str(obj)
run.track(cairn.Html("<h1>Report</h1>…"), "report", step)
run.track(cairn.Markdown("# Notes\n\n- [x] done"), "notes", step)
```

- HTML is rendered only inside a sandboxed iframe, never inline in the page. Like
  `wandb.Html` it may load scripts, images and pages from the web, but it gets no access to
  cairn (see [Cards › HTML and Markdown](../ui/cards.md#html-and-markdown)).
- Markdown is rendered as GitHub-flavoured Markdown plus most of Pandoc's Markdown, math
  included (see [Markdown](#markdown) below). Raw HTML is escaped.
- HTML and Markdown are limited to 10 MB each.

### Markdown

One renderer draws every piece of Markdown in the UI: `cairn.Markdown` cards, report markdown
cells and run notes. The report LaTeX export parses with the same pipeline. It is GitHub-flavoured
Markdown plus Pandoc extensions:

````python
run.track(cairn.Markdown(r"""
# Results {#results}

The loss $\mathcal{L}(\theta) = \frac{1}{n}\sum_i \ell_i$ drops below $10^{-3}$[^ref].

$$
\begin{aligned}
\nabla_\theta \mathcal{L} &= 0 \\
\theta^\star &= \arg\min_\theta \mathcal{L}
\end{aligned}
$$

::: warning
Seeds 3 and 7 diverged.
:::

[^ref]: After 10k steps.
"""), "notes", step)
````

Math is rendered with [KaTeX](https://katex.org/docs/supported), loaded only when a text
contains math. Pandoc's rules decide what is math:

- `$…$` is inline math. The opening `$` must be followed by a non-space. The next `$` closes it; it
  must follow a non-space and must not be followed by a digit. Otherwise the opening `$` is an
  ordinary dollar sign, so `$5 and $10` stays text. Write `\$` for a literal dollar inside math.
- `$$…$$` is display math, on its own lines or inside a paragraph.
- `\(…\)` is inline math and `\[…\]` display math. Without the closing `\)` / `\]`, `\(` and `\[`
  are the usual Markdown escapes of `(` and `[`.
- A block starting with `\begin{env}` is display math when KaTeX knows `env` (`equation`,
  `align`, `alignat`, `gather`, `split`, `CD`, with or without `*`). Any other environment, such as
  `tikzpicture`, is shown as LaTeX code and passed through verbatim by the LaTeX export.
- A block of `\newcommand`, `\renewcommand`, `\def` or `\DeclareMathOperator` lines defines macros
  for all math after it in the same text. A `\newcommand` inside a formula works the same way.

Pandoc extensions and their support:

| Pandoc extension | Support | Notes |
|---|---|---|
| `tex_math_dollars` | Yes | `$…$` inline, `$$…$$` display, with Pandoc's rules above. |
| `tex_math_single_backslash` | Yes | `\(…\)` inline, `\[…\]` display. |
| `raw_tex` | Partial | `\begin{…}…\end{…}` blocks: KaTeX environments render as math, the rest as LaTeX code. Inline TeX commands outside math stay text. |
| `latex_macros` | Yes | Macro blocks and `\newcommand` in formulas apply to later math in the same text. |
| `footnotes` | Yes | `[^1]` references and `[^1]: …` notes, listed at the end of the text. |
| `inline_notes` | Yes | `^[…]`. |
| `definition_lists` | Yes | `:` and `~` markers, compact and loose. |
| `fenced_divs` | Yes | `::: {.class #id}` … `:::`, nestable. The classes `note`, `tip`, `important`, `warning` and `caution` (also `callout-note`, …) make a callout; `title="…"` sets its title. |
| `bracketed_spans` | Yes | `[text]{.class}`. `.smallcaps`, `.underline` and `.mark` are styled. |
| `header_attributes` | Yes | `# Title {#id .class}`; `{-}` or `.unnumbered` makes an unnumbered section in the LaTeX export. |
| `auto_identifiers` | Partial | Headings get GitHub-style ids (Pandoc's `gfm_auto_identifiers`), the same ids a report's table of contents uses. |
| `link_attributes` | Partial | `{#id .class title=…}` after links and images; `width` / `height` on images. |
| `superscript`, `subscript` | Yes | `2^10^`, `H~2~O`. Plain text inside, no spaces. |
| `strikeout` | Yes | `~~text~~`. A single `~` is subscript. |
| `pipe_tables` | Yes | With column alignment. |
| `simple_tables`, `multiline_tables`, `grid_tables`, `table_captions` | No | Use pipe tables. |
| `task_lists` | Yes | `- [x] done`. |
| `smart` | Yes | Curly quotes, `--` en dash, `---` em dash, `...` ellipsis. |
| `implicit_figures` | Yes | An image with alt text alone in its paragraph becomes a figure captioned by the alt text. |
| `line_blocks` | Yes | `| line`, keeping line breaks and leading spaces. |
| `fancy_lists`, `startnum` | Partial | `a.`, `A)`, `(i)`, `IV.`, `(1)`, `#.` markers. Items are one paragraph each, without nested blocks. Upper-case letters followed by `.` need two spaces (`A.  Item`), so `B. Russell` stays a sentence. |
| `example_lists` | Partial | `(@)` and `(@label)` items are numbered across the whole text, and `(@label)` in the text becomes the number. Same item limits as `fancy_lists`. |
| `citations` | Partial | `[@key]`, `[see @key, p. 4; @other]` and `[-@key]` show as written, styled as a citation. There is no bibliography. The LaTeX export writes `\cite{key,other}`. |
| `fenced_code_blocks`, `backtick_code_blocks` | Yes | The language after the fence is kept; other code attributes are ignored. |
| `raw_html`, `native_divs`, `native_spans`, `markdown_in_html_blocks` | No | Raw HTML is always shown as text. |
| `yaml_metadata_block`, `pandoc_title_block` | No | |

Everything rendered stays inert. Raw HTML shows as text. `javascript:` and other unsafe URLs are
dropped. Attribute blocks set only an id, classes (rendered with an `md-` prefix, so they cannot
pick up the app's own styles), and `title`, `lang`, `dir`, `width`, `height`; anything else, such
as `onclick=…` or `style=…`, is ignored. KaTeX runs with `trust` off, so `\href`, `\url`,
`\includegraphics` and `\htmlClass` render as errors, never as links or markup.

## Tables

```python
run.track(cairn.Table(columns=["id", "pred", "correct"],
                      data=[[0, "cat", True], [1, "dog", False]]), "predictions", step)
run.track(cairn.Table(dataframe=df), "predictions", step)
```

Column types (`number`, `string`, `bool`, `media`, `other`) are inferred at log time. Values
that are not JSON-native are converted to strings. Tables are capped at 10,000 rows; longer
tables are truncated, and the original row count is recorded.

Cells can hold `cairn.Image`, `cairn.Audio` or `cairn.Video`. Each such cell is uploaded as its own
artifact and shown inline:

```python
rows = [[i, cairn.Image(x), label] for i, (x, label) in enumerate(samples)]
run.track(cairn.Table(columns=["i", "input", "label"], data=rows), "samples", step)
```

## Histograms

```python
run.track(cairn.Histogram(weights, bins=64), "weights", step)
run.track(cairn.Histogram(counts=counts, edges=edges), "grads", step)   # already binned
```

Pass either raw values, which are binned at log time into `bins` equal-width bins (default 64),
or `counts` and `edges`, where `edges` has one more entry than `counts`. For per-layer gradient
and weight histograms of a torch model, use [`run.watch`](runs.md#gradient-and-parameter-histograms).

## Tensors and pickled objects

```python
run.track(cairn.Tensor(activations), "activations", step)
run.track(cairn.Pickle(model.state_dict()), "checkpoint", step)
```

- `cairn.Tensor` stores a NumPy array or torch tensor as `.npy` (at most 10 MB), with its shape,
  dtype, min, max and mean.
- `cairn.Pickle` pickles any Python object. Downloading it from the UI gives a `.pkl` file.

For files and versioned models or datasets, use [artifacts](artifacts.md) instead.

## Classifier charts

These wrappers store the underlying data, not a picture, so the UI can draw them and compare runs
side by side:

```python
run.track(cairn.ConfusionMatrix(y_true, y_pred, class_names=["cat", "dog"]), "val.confusion", epoch)
run.track(cairn.PRCurve(y_true, probs, labels=["cat", "dog"]), "val.pr", epoch)
run.track(cairn.ROCCurve(y_true, probs), "val.roc", epoch)
```

- `ConfusionMatrix(y_true, y_pred, class_names=None)`: integer class labels. The true label is
  the row and the prediction is the column.
- `PRCurve(y_true, y_score, labels=None)` and `ROCCurve(...)`: one curve per class, one-vs-rest.
  `y_score` is `(n_samples, n_classes)` (for example softmax output), or 1-D for a binary problem.
  The PR curve reports average precision and the ROC curve reports AUC, both computed on the full
  curve. Each curve keeps at most 500 points.

## 3D data

The 3D types are drawn in an interactive three.js viewer.

### Point clouds

```python
run.track(cairn.PointCloud(xyz), "cloud", step)                    # (N, 3)
run.track(cairn.PointCloud(xyz_category), "segments", step)        # (N, 4): xyz + class id
run.track(cairn.PointCloud(xyz_rgb), "scan", step)                 # (N, 6): xyz + rgb
run.track(cairn.PointCloud(xyz, values={"loss": l, "curvature": c}), "cloud", step)
```

Colours may be `0–255` or `0–1`; the range is detected. `values` is a length-N array or a dict of
named per-point scalars. The viewer offers a property selector and a colormap for them. Clouds
with more than 300,000 points are uniformly downsampled at log time, and the original count is
recorded.

### Meshes

```python
run.track(cairn.Mesh(vertices, faces), "mesh", step)
run.track(cairn.Mesh(vertices, faces, values={"curvature": c}), "mesh", step)
run.track(cairn.Mesh(vertices, faces, colors=vertex_rgb), "mesh", step)
```

`vertices` is `(N, 3)` and `faces` is `(M, 3)` triangle indices. Optional per-vertex `values`
(an array or a dict of named arrays), `colors` (`(N, 3)`, `0–255` or `0–1`) and `normals`
(`(N, 3)`; computed by the viewer when omitted).

Faces should be wound counter-clockwise as seen from outside. cairn repairs mixed winding at log
time and orients closed surfaces outward. Non-manifold meshes are stored untouched and flagged,
and the viewer's double-sided rendering keeps them visible.

### Boxes, octrees and BVHs

```python
run.track(cairn.Boxes3D(mins, maxs), "boxes", step)
run.track(cairn.Octree(mins, maxs, depth=depth), "octree", step)
run.track(cairn.BVH(mins, maxs, values={"cost": cost, "iou": iou}), "bvh", step)
```

All three store axis-aligned boxes. `mins` and `maxs` are `(N, 3)` with `mins <= maxs`, `depth`
is an optional `(N,)` integer level, and `values` is an optional per-box scalar array or dict of
named arrays. `Octree` and `BVH` differ from `Boxes3D` only in how the UI labels them. Sets with
more than 200,000 boxes raise an error; they are not truncated.

### Volumes

```python
run.track(cairn.Volume(density, spacing=[2.0, 1.0, 1.0], origin=[0, 0, 0]), "scan", step)
```

A dense `(D, H, W)` scalar grid, stored as compressed float32 `.npz` with its statistics and
bounds. `spacing` and `origin` follow the `[D, H, W]` axis order. Volumes may be at most 128 MB as
float32.

!!! note
    Volume cards draw with `cairn.volume`, the WebGL2 ray-marcher cairn ships as a
    [built-in viewer](custom-viewers.md#built-in-viewers). A project can make its own viewer the
    default for volumes ([default viewers](custom-viewers.md#default-viewers)); without WebGL2 the
    card offers the `.npz` file for download.

## Custom data for your own viewers

`cairn.Data` logs data that no built-in card shows, under a `kind` you choose, for a custom
viewer (browser code you write and publish per project) to draw:

```python
run.use_viewer("viewers/vmf")    # publish the viewer folder if it changed
run.track(cairn.Data({"mu": mu, "kappa": kappa, "weights": w},
                     kind="guiding/vmf", meta={"lobes": 8}),
          "guide", step)
```

- `kind` is lowercase segments separated by `/` (`guiding/vmf`, `field/2d`). Viewers declare
  the kinds they accept, so several viewers can show one kind.
- The payload is stored by its shape: a `dict` holding NumPy arrays (or torch tensors) is a
  compressed `.npz` (its other entries, numbers or strings, are kept as JSON beside the arrays),
  any other JSON-able value is JSON, and `bytes` are kept as is. Arrays must be numeric or bool.
  Each value is limited to 128 MB.
- `meta` is a JSON dict handed to the viewer with the data; `caption=` labels the point.
- A list of `cairn.Data` of one kind is a [gallery](#captions-and-galleries). Mixing kinds raises
  `ValueError`.
- Reading it back, `run.media("guide", step).load()` returns the dict (arrays and JSON entries),
  the JSON value, or the bytes.

A viewer is a folder with a `cairn-viewer.json` manifest and ES modules. Publish it with
`cairn viewer publish viewers/vmf --project P` (or `cairn.publish_viewer`, or `run.use_viewer`
as above), develop it live with `cairn viewer dev viewers/vmf --project P`, and vendor libraries
it imports with `cairn viewer add viewers/vmf d3@7`. Without a viewer for a kind, the card offers
the value for download. [Custom viewers](custom-viewers.md) covers writing, publishing and using
viewers; `cairn viewer init` writes a starter.

## Custom types

`cairn.register_handler` adds a handler for your own types. A handler has an `object_type`
(which decides how the UI displays the value), a `mime_type`, a `can_handle(obj)` predicate and
a `serialize(obj, **kwargs)` method that returns `(bytes, metadata)`. It can also define
`mime_type_for(obj, **kwargs)`, when the format depends on the value, and
`deserialize(data, metadata)`, used when reading the value back. Handlers registered later take
precedence.

The viewer only has cards for cairn's built-in object types, so the practical approach is to
convert your object into a built-in type by extending its handler:

```python
from dataclasses import dataclass
import numpy as np
import cairn
from cairn.sdk.handlers import ImageHandler

@dataclass
class Heatmap:
    values: np.ndarray            # (H, W), in [0, 1]

@cairn.register_handler
class HeatmapHandler(ImageHandler):
    def can_handle(self, obj):
        return isinstance(obj, Heatmap)

    def mime_type_for(self, obj, **kwargs):
        if isinstance(obj, Heatmap):
            return super().mime_type_for(obj.values, colormap="magma")
        return super().mime_type_for(obj, **kwargs)

    def serialize(self, obj, **kwargs):
        if isinstance(obj, Heatmap):
            return super().serialize(obj.values, colormap="magma", **kwargs)
        return super().serialize(obj, **kwargs)

run.track(Heatmap(attn), "attention", step)    # no wrapper needed
```

!!! warning
    `cairn.Image(...)` and the other wrappers look up the **newest** handler for their object
    type. A handler that reuses `object_type = "image"` therefore also receives every
    `cairn.Image`, which is why the example passes anything that isn't a `Heatmap` on to the
    built-in behaviour.

Often it is simpler to convert the value yourself and use the built-in wrappers.
