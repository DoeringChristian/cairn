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

A **list** of images logged under one name and step is a gallery, shown together in one card.
Each image keeps its own caption, and a `caption=` passed to `run.track` labels the whole point:

```python
run.track([cairn.Image(a, caption="input"), cairn.Image(b, caption="output")], "pair", step)
```

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

## Text, HTML and Markdown

```python
run.track("Loaded 50k samples", "log.info", step)              # plain text
run.track(cairn.Text(obj), "repr", step)                        # str(obj)
run.track(cairn.Html("<h1>Report</h1>…"), "report", step)
run.track(cairn.Markdown("# Notes\n\n- [x] done"), "notes", step)
```

- HTML is rendered only inside a sandboxed iframe, never inline in the page.
- Markdown is rendered as GitHub-flavoured Markdown with raw HTML escaped.
- HTML and Markdown are limited to 10 MB each.

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
run.track(cairn.Artifact(model.state_dict()), "checkpoint", step)
```

- `cairn.Tensor` stores a NumPy array or torch tensor as `.npy` (at most 10 MB), with its shape,
  dtype, min, max and mean.
- `cairn.Artifact` pickles any Python object. Downloading it from the UI gives a `.pkl` file.

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
    The viewer does not render volumes. The card shows a placeholder with the `.npz` file for
    download.

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
