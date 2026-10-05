"""``cairn viewer init``: write a starter custom viewer folder.

Two starters, each a complete, publishable viewer (``cairn-viewer.json`` +
``index.js`` + a ``README.md`` with the logging snippet):

* the default draws ``cairn.Data({"values": arr}, kind=KIND)`` as bars on a
  2D canvas (``examples/custom_viewers/minimal/hist`` is exactly this starter);
* ``three=True`` draws ``cairn.Data({"points": (N, 3) array}, kind=KIND)`` as
  a three.js point cloud (``cairn:three``).

The templates are Python strings (``cairn/`` holds Python only); ``__NAME__``,
``__TITLE__``, ``__KIND__`` and ``__DIR__`` are filled in.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from ..server.viewer_manifest import MANIFEST_FILE, NAME_RE, validate_kind, validate_manifest

_HIST_MANIFEST = {
    "name": "__NAME__",
    "title": "__TITLE__",
    "description": "Bars of a logged 1-D array (cairn.Data({'values': arr}, kind='__KIND__')).",
    "accepts": ["custom:__KIND__"],
    "icon": "chart-column",
    "settings": [
        {
            "key": "color",
            "type": "select",
            "label": "Bar colour",
            "options": [
                {"value": "accent", "label": "Accent (theme)"},
                {"value": "#e45756", "label": "Red"},
                {"value": "#54a24b", "label": "Green"},
            ],
            "default": "accent",
            "tab": "display",
            "section": "Appearance",
            "help": "The colour of the bars.",
        },
        {
            "key": "normalize",
            "type": "switch",
            "label": "Normalize",
            "default": False,
            "tab": "data",
            "section": "Series",
            "help": "Show every bar as a fraction of the total.",
        },
    ],
}

_HIST_JS = """\
// A minimal cairn custom viewer: draws a logged 1-D array as bars.
//
// It runs in a sandboxed frame: no network, no cookies, no access to the app.
// Everything it gets comes through `cairn:sdk` (docs: guides/custom-viewers.md).
// `cairn-viewer.json` next to this file says which data it accepts and which
// settings it has; the card's gear shows those settings.
import { onRender } from "cairn:sdk";

// One canvas filling the frame.
const canvas = document.createElement("canvas");
document.body.append(canvas);
const ctx = canvas.getContext("2d");

// Called on every change: the step (slider), the settings, the size, the theme.
//   inputs[0].data  what was logged; a dict of arrays arrives as
//                   {name: {data: TypedArray, shape: [...], dtype: "float32"}}
//   settings        this card's values of the manifest's settings
//   size            {width, height, dpr}: the frame in CSS pixels
//   theme           the app's colours: {bg, fg, muted, accent, font, ...}
onRender(({ inputs, settings, size, theme }) => {
  // Crisp on high-DPI screens: draw in device pixels, measure in CSS pixels.
  canvas.width = size.width * size.dpr;
  canvas.height = size.height * size.dpr;
  canvas.style.width = `${size.width}px`;
  canvas.style.height = `${size.height}px`;
  ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
  ctx.clearRect(0, 0, size.width, size.height);

  // The logged array: cairn.Data({"values": arr}, kind="__KIND__").
  let values = Array.from(inputs[0].data.values.data);
  // A "Data" tab setting: bars as fractions of the total.
  if (settings.normalize) {
    const total = values.reduce((a, b) => a + b, 0) || 1;
    values = values.map((v) => v / total);
  }

  // A "Display" tab setting: the bar colour ("accent" follows the app's theme).
  ctx.fillStyle = settings.color === "accent" ? theme.accent : settings.color;
  const max = values.reduce((a, b) => Math.max(a, b), 1e-12);
  const w = size.width / values.length;
  const top = 18; // room for the caption
  values.forEach((v, i) => {
    const h = (v / max) * (size.height - top);
    ctx.fillRect(i * w + 1, size.height - h, Math.max(1, w - 2), h);
  });

  ctx.fillStyle = theme.muted;
  ctx.font = `11px ${theme.font}`;
  ctx.fillText(`step ${inputs[0].step} · max ${max.toPrecision(3)}`, 4, 12);
});
// Snapshots (paused frames, report exports) default to the first <canvas>.
"""

_THREE_MANIFEST = {
    "name": "__NAME__",
    "title": "__TITLE__",
    "description": "A logged (N, 3) point array (cairn.Data({'points': xyz}, kind='__KIND__')) with three.js.",
    "accepts": ["custom:__KIND__"],
    "icon": "cube",
    "webgl": True,
    "settings": [
        {
            "key": "pointSize",
            "type": "slider",
            "label": "Point size",
            "min": 1,
            "max": 10,
            "step": 0.5,
            "default": 3,
            "tab": "display",
            "section": "Appearance",
            "help": "Point size in pixels.",
        },
        {
            "key": "maxPoints",
            "type": "number",
            "label": "Max points",
            "min": 1,
            "max": 1000000,
            "default": 100000,
            "tab": "data",
            "section": "Series",
            "help": "Draw at most this many points.",
        },
    ],
}

_THREE_JS = """\
// A minimal cairn custom viewer with three.js: a logged (N, 3) array as points.
//
// It runs in a sandboxed frame: no network, no cookies, no access to the app.
// `cairn:three` is the app's own three.js; for its addons (OrbitControls, ...)
// vendor them into this folder, e.g.
//   cairn viewer add __DIR__ three@0.185.1/examples/jsm/controls/OrbitControls.js --external three
// (see examples/custom_viewers/guiding for orbit controls and camera sync).
import * as THREE from "cairn:three";
import { onRender, onResize } from "cairn:sdk";

// preserveDrawingBuffer lets the default snapshot read the canvas.
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
camera.position.set(2.5, 2, 3.5);
camera.lookAt(0, 0, 0);
const material = new THREE.PointsMaterial({ sizeAttenuation: false });
const points = new THREE.Points(new THREE.BufferGeometry(), material);
scene.add(points);

function resize({ width, height, dpr }) {
  renderer.setPixelRatio(dpr);
  renderer.setSize(width, height);
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
}
// Resizes only re-layout (without onResize, a resize would re-run onRender).
onResize(resize);

onRender(({ inputs, settings, size, theme }) => {
  // The logged array: cairn.Data({"points": xyz}, kind="__KIND__"), xyz of shape (N, 3).
  const { data, shape } = inputs[0].data.points;
  const n = Math.min(shape[0], settings.maxPoints);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(data.subarray(0, n * 3)), 3));
  points.geometry.dispose();
  points.geometry = geometry;
  material.size = settings.pointSize;
  material.color.set(theme.accent);
  scene.background = new THREE.Color(theme.bg);
  resize(size);
});
"""

_README = """\
# __TITLE__

A cairn custom viewer, made by `cairn viewer init`. It shows data logged as

```python
__LOG__
```

Develop it live against a running `cairn ui` (every save reloads open cards):

```
cairn viewer dev __DIR__ --project <project>
```

Publish it, or let the training script publish it when it changed:

```
cairn viewer publish __DIR__ --project <project>
```

```python
run.use_viewer("__DIR__")
```

Then pick it in a card's gear editor (type list) or let cards of the data use
it: a card shows the most specific viewer that accepts its data. Files:
`cairn-viewer.json` (manifest: what it accepts, its settings), `index.js`
(the code). Docs: guides/custom-viewers.md.
"""

_HIST_LOG = """\
counts, _ = np.histogram(samples, bins=24)
run.track(cairn.Data({"values": counts.astype(np.float32)}, kind="__KIND__"), "hist", step)"""

_THREE_LOG = """\
xyz = np.random.randn(2000, 3).astype(np.float32)
run.track(cairn.Data({"points": xyz}, kind="__KIND__"), "points", step)"""


@dataclass
class Scaffold:
    """What ``init_viewer`` wrote."""

    name: str
    kind: str
    files: list[Path]


def _title(name: str) -> str:
    return re.sub(r"[-_.]+", " ", name).strip().capitalize() or name


def init_viewer(folder: str | Path, *, kind: str | None = None, three: bool = False, name: str | None = None) -> Scaffold:
    """Write a starter viewer into ``folder`` (created; must not hold a manifest yet).

    ``name`` defaults to the folder's name (lowercased), ``kind`` to the name.
    """
    root = Path(folder)
    if (root / MANIFEST_FILE).exists():
        raise FileExistsError(f"{root / MANIFEST_FILE} exists already")
    name = name if name is not None else re.sub(r"[^a-z0-9_.-]+", "-", root.resolve().name.lower()).strip("-.")
    if not NAME_RE.match(name or ""):
        raise ValueError(f"invalid viewer name {name!r}: use [a-z0-9_.-], starting with a letter or digit (--name)")
    kind = validate_kind(kind if kind is not None else name)
    manifest, js, log = (_THREE_MANIFEST, _THREE_JS, _THREE_LOG) if three else (_HIST_MANIFEST, _HIST_JS, _HIST_LOG)
    where = Path(folder).as_posix()

    def fill(text: str) -> str:
        return (
            text.replace("__LOG__", log)
            .replace("__NAME__", name)
            .replace("__TITLE__", _title(name))
            .replace("__KIND__", kind)
            .replace("__DIR__", where)
        )

    manifest_text = fill(json.dumps(manifest, indent=2, ensure_ascii=False)) + "\n"
    validate_manifest(json.loads(manifest_text), files=["index.js"])
    root.mkdir(parents=True, exist_ok=True)
    out = []
    for rel, text in ((MANIFEST_FILE, manifest_text), ("index.js", fill(js)), ("README.md", fill(_README))):
        p = root / rel
        p.write_text(text, encoding="utf-8")
        out.append(p)
    return Scaffold(name=name, kind=kind, files=out)
