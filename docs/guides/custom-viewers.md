# Custom viewers

A custom viewer is browser code you write to draw data that no built-in card shows: a guiding
distribution on a sphere, a volume renderer, a bespoke diff. You log the data once with
`cairn.Data` under a `kind`; a viewer (a folder in your repo with a `cairn-viewer.json` manifest
and ES modules) declares the kinds it accepts and is published to a project. Cards then draw the
data with it, with the step slider, galleries, comparisons, section sync, reports and share links
working as for built-in cards.

Viewer code runs only in the browser, in a sandboxed frame with no network and no access to the
app (see [Security model](#security-model)). Several viewers can accept the same kind, and a
viewer can also accept a built-in kind such as `volume`; every kind has one
[default viewer](#default-viewers) per project. Cairn ships one viewer itself: `cairn.volume`,
the ray-marcher that draws every `cairn.Volume` (see [Built-in viewers](#built-in-viewers)).

## Quick start

`cairn viewer init` writes a complete starter: a manifest with two settings and an `index.js`
that draws a logged 1-D array as bars on a 2D canvas.

```bash
cairn viewer init viewers/hist --kind demo/hist
```

```
viewers/hist/
  cairn-viewer.json   # name, accepted kinds, settings
  index.js            # the code (only cairn:sdk and a <canvas>)
  README.md           # the logging snippet
```

Start the UI, then serve the folder live to it. `cairn viewer dev` needs a running server: with a
local repo it finds the `cairn ui` serving that repo; otherwise pass `--server URL`.

```bash
cairn ui --repo .cairn                      # http://localhost:4301
cairn viewer dev viewers/hist --project P   # finds that cairn ui (or: --server http://localhost:4301)
```

Log data of that kind:

```python
counts, _ = np.histogram(samples, bins=24)
run.track(cairn.Data({"values": counts.astype(np.float32)}, kind="demo/hist"), "hist", step)
```

The `hist` card is drawn by the viewer. Every save of a file in `viewers/hist` reloads it in open
cards. The viewer is also an entry of the **Type** tab in the card's gear editor (by its title and
icon), and its two settings sit in the gear's **Display** and **Data** tabs.

When you are done, publish the folder, or let the training script publish it whenever it changed:

```bash
cairn viewer publish viewers/hist --project P
```

```python
run.use_viewer("viewers/hist")   # a new version only when the folder changed
```

`cairn viewer init DIR --three` writes a three.js starter instead (a logged `(N, 3)` array as
points). [`examples/custom_viewers/`](../examples.md#custom-viewers) has the starter and three
fuller viewers to copy from.

## Data: `cairn.Data`

```python
run.track(cairn.Data(payload, kind="guiding/vmf", meta={"units": "sr"}, caption="epoch 3"), "guide", step)
```

- `kind` matches `^[a-z0-9_.-]+(/[a-z0-9_.-]+)*$`: lowercase segments separated by `/`
  (`guiding/vmf`, `field/2d`). It is required and validated when you log.
- The payload is stored by its shape:

    | Payload | Format | Stored as |
    |---|---|---|
    | `dict` with at least one NumPy array or torch tensor | `npz` | A compressed `.npz`, one member per array. The dict's other entries (numbers, strings, lists) are kept as JSON in the point's metadata (`values`). |
    | Any other JSON-able value (dict, list, str, number, bool, None) | `json` | UTF-8 JSON. NaN is rejected. |
    | `bytes`, `bytearray`, `memoryview` | `bytes` | As is. |

- Arrays are C-contiguous little-endian with dtype `float16/32/64`, `int8..64`, `uint8..64` or
  `bool` (anything else raises; float64 is kept). 0-d arrays become `values` entries. Array
  names are non-empty strings without `/`.
- Each value is at most 128 MB (array bytes before compression, JSON or bytes).
- `meta` is a JSON dict handed to the viewer with the data; `caption=` labels the point.
- A list of `cairn.Data` under one name and step is a [gallery](media.md#captions-and-galleries).
  Every item must have the same kind.
- Reading back, `run.media(name, step).load()` returns the dict (arrays and `values`), the JSON
  value, or the bytes.

The sequence's `object_type` is `custom`; its catalogue entry carries the `kind` of its latest
point, which is what cards match viewers against.

## The viewer folder

A viewer is a folder with `cairn-viewer.json` at its root. Every regular file under it is part of
the viewer, except dotfiles and dot-directories, `node_modules/` and `__pycache__/`. The folder
is at most 50 MB.

```json
{
  "name": "vmf-guiding",
  "title": "Guiding distribution (vMF)",
  "accepts": ["custom:guiding/vmf"],
  "inputs": "compare",
  "webgl": true,
  "view": true,
  "icon": "globe",
  "imports": {"three/addons/controls/OrbitControls.js": "./vendor/three/addons/controls/OrbitControls.js"},
  "settings": [
    {"key": "exposure", "type": "slider", "label": "Exposure", "min": 0.1, "max": 8, "step": 0.1,
     "default": 1, "tab": "display", "section": "Appearance", "help": "Scales the density before colouring."}
  ]
}
```

| Field | Type | Default | Meaning |
|---|---|---|---|
| `name` | `^[a-z0-9][a-z0-9_.-]*$`, at most 64 characters | required | The artifact name the viewer is published under, and the card's `viewer` setting |
| `title` | string | `name` | The label in the type list and the viewer picker |
| `description` | string | — | Free text |
| `entry` | path in the folder | `index.js` | The ES module the frame imports first; must exist |
| `accepts` | non-empty list of patterns | required | `custom:<kind glob>` for custom data, or a built-in object type (`volume`, `image`, `mesh`, …) |
| `inputs` | `single` or `compare` | `single` | `compare`: the viewer gets a pane's value and its reference together, as `[A, B]` |
| `webgl` | bool | `false` | The viewer draws with WebGL: each frame counts against the page's [WebGL budget](#webgl-budget-and-snapshots) |
| `view` | bool | `false` | The viewer has a view (a camera) that the card [syncs across its panes](#view-sync) |
| `icon` | an icon name (below) | none | Shown beside the title in the type list |
| `settings` | list of settings | `[]` | [Settings](#settings) the gear shows for the card |
| `imports` | `{specifier: "./path"}` | `{}` | [Libraries](#libraries-imports-and-cairn-viewer-add) vendored into the folder |

Unknown fields are ignored. The JSON schema is
[`docs/schemas/cairn-viewer.schema.json`](../schemas/cairn-viewer.schema.json). Publishing and
`cairn viewer dev` validate the manifest and refuse an invalid one with a message naming the
field; the published manifest is normalized (every optional field filled with its default).

**Icons** (Font Awesome solid names): `cube`, `cubes`, `globe`, `sun`, `fire`, `eye`, `compass`,
`brain`, `image`, `images`, `chart-line`, `chart-area`, `chart-column`, `wave-square`, `table`,
`table-cells`, `shapes`, `layer-group`, `circle-nodes`, `diagram-project`, `route`, `microscope`,
`atom`, `wand-magic-sparkles`.

### `accepts` patterns

Custom data is matched as `custom:<kind>`, a built-in series by its object type (`volume`).
Patterns are whole-string globs: `*` matches any run of characters including `/`, `?` one
character, everything else is literal. `custom:guiding/*` matches `custom:guiding/vmf` and
`custom:guiding/a/b`.

Accepting a kind does not make a viewer show it: which viewer draws a card is the kind's
[default viewer](#default-viewers) (or the one the card names).

### Settings

Each setting is a control in the card's gear. Its value reaches the viewer as
`settings[key]` (see [`onRender`](#the-cairnsdk-module)).

| Field | Notes |
|---|---|
| `key` | `^[A-Za-z_][A-Za-z0-9_]*$`, unique; not `viewer` or `viewer_version` (the card's own) |
| `type` | `slider`, `number`, `select`, `switch`, `colormap` or `text` |
| `label` | Shown beside the control; default the key |
| `help` | Help text under the control |
| `default` | See below |
| `tab` | `data`, `grouping`, `display` *(default)* or `expressions`: the gear tab it sits in |
| `section` | `Axes`, `Smoothing`, `Outliers`, `Series`, `Appearance` *(default)*, `Overlays`, `Layout`, `Playback` or `Compare`: the section of that tab |

| Type | Extra fields | Default when omitted |
|---|---|---|
| `slider` | `min`, `max` (required), `step` | `min` |
| `number` | `min`, `max`, `step` (optional) | `0` (or `min`) |
| `select` | `options`: non-empty list of strings or `{value, label}` | the first option |
| `switch` | — | `false` |
| `colormap` | `options`: colormap names restricting the list (optional) | `turbo` (or the first option) |
| `text` | `placeholder` | `""` |

A `default` must have the type's kind of value (a select's must be one of its options), and a
slider's `min` may not exceed its `max`. The host only renders a `colormap` picker (`turbo`,
`magma`, `plasma`, `viridis`, `greys`): the viewer gets the name and draws the colours itself
(the examples' `colormaps.js` has small fits of these five).

Settings are ordinary card settings: each shows its reset-to-default, and section and workspace
defaults apply to it. A card stores a value under the flat key `vs:<viewer>:<key>` (for example
`"vs:vmf-guiding:exposure": 2`), so defaults cascade per viewer and per setting, and switching a
card to another viewer starts that viewer's settings fresh.

### Libraries: `imports` and `cairn viewer add`

The frame has no network, so every library a viewer imports must be a file in its folder, mapped
by a bare specifier in `imports`:

```json
"imports": {"d3-scale": "./vendor/d3-scale.js", "three/addons/": "./vendor/three-addons/"}
```

- Keys are bare specifiers: no leading `.` or `/`, no URL scheme, not `cairn:`. A key ending in
  `/` maps a folder (its value ends in `/` too); otherwise the value is an existing file.
- Values are `./` paths inside the folder (no `..`).
- Relative imports between the viewer's own modules (`./src/color.js`) need no entry.

`cairn viewer add` downloads a self-contained ES-module build of an npm package (from esm.sh) into
`<folder>/vendor/`, rewrites its imports to relative files and records the `imports` entry:

```bash
cairn viewer add viewers/field d3-scale@4
cairn viewer add viewers/vmf three@0.185.1/examples/jsm/controls/OrbitControls.js \
    --external three --as three/addons/controls/OrbitControls.js
```

`--as NAME` sets the import name (default: the spec without its version). `--external PKG` leaves
that package's imports bare: use it for three.js addons, so they import the host's three (below)
rather than a second copy. The command prints any bare imports left for you to map. Vendoring
happens once, at authoring time; commit `vendor/` with the viewer.

### Provided modules

- `cairn:sdk`: the [SDK](#the-cairnsdk-module).
- `cairn:three`: the app's own three.js (r185), also importable as `three` unless the viewer maps
  `three` itself in `imports`. Using it costs no download: it is the chunk the 3D cards load.

Static imports, re-exports and `import()` with relative paths work. `new URL("./x.png",
import.meta.url)` does not (modules load from blob URLs): load files with
[`asset(path)`](#the-cairnsdk-module).

## The `cairn:sdk` module

```js
import { onRender, onResize, onView, setView, onSettings, setSettings, onTheme,
         snapshot, asset, setHeight, reportError, settings, theme, version } from "cairn:sdk";
```

| Function | Meaning |
|---|---|
| `onRender(fn)` | `fn({inputs, step, settings, size, theme, view})` draws. Called on every change of data or step, and (unless handled below) of settings, size or theme. May be async; a render arriving while one runs waits and only the latest runs. |
| `onResize(fn)` | `fn({width, height, dpr})`: the frame was resized (CSS pixels, device pixel ratio). Without it, a resize re-runs the render callback. |
| `onSettings(fn)` | `fn(settings)`: only the settings changed. Without it, the render callback re-runs with the last inputs. |
| `onTheme(fn)` | `fn(theme)`: the app's theme changed. Without it, the render callback re-runs. |
| `onView(fn)` | `fn(view)`: a sibling pane moved the shared view, or the card's stored view changed; `null` after the card's reset-view. Called at once with the current view if there is one. |
| `setView(view, {final}?)` | Share this pane's view (any JSON up to 64 kB, e.g. a camera) with the card's other panes. The card stores it once it has been still for 150 ms, or at once with `{final: true}`. |
| `setSettings(patch)` | Change the card's settings from inside the viewer (`{exposure: 2}`). Checked against the manifest: unknown keys and wrong types are dropped (with a console warning), numbers clamped to `[min, max]`. Stored like an edit in the gear; the result comes back through `onSettings` or a render. |
| `snapshot(fn)` | `fn()` returns a data URL or a canvas: the picture shown while the frame is paused and used by report exports. Without it, the first `<canvas>` is read (a WebGL canvas then needs `preserveDrawingBuffer: true`). |
| `asset(path)` | A blob URL of a file of the viewer folder (`"textures/env.png"`), or `null`. |
| `setHeight(px)` | The content's preferred height. Sent to the host but not used by cards yet: cards size their frames. |
| `reportError(e)` | Show an error in the card. Uncaught errors and rejections are reported anyway. |
| `settings()`, `theme()` | The values of the last render or settings change. |
| `version` | The SDK version (`"1"`). |

### Render arguments

- `step`: the step shown.
- `size`: `{width, height, dpr}` of the frame in CSS pixels.
- `settings`: the card's value of every manifest setting (defaults filled in).
- `theme`: `{mode, bg, fg, muted, border, accent, font, monoFont}`, CSS colours and font
  stacks. They are also set as CSS variables on the frame's root: `--cairn-bg`, `--cairn-fg`,
  `--cairn-muted`, `--cairn-border`, `--cairn-accent`, `--cairn-font`, `--cairn-mono`.
- `view`: the card's stored view, or `null`.
- `inputs`: one entry, or two (`[A, B]`) for a `compare` viewer whose card has a reference:

| Field | Meaning |
|---|---|
| `data` | The decoded value (below) |
| `format` | `npz`, `json` or `bytes` for custom data; the MIME type for a built-in kind |
| `kind` | The custom data's kind (`guiding/vmf`), or the built-in object type (`volume`) |
| `meta` | Custom data: the `meta` logged with it. A built-in kind: its stored metadata (a volume's `shape`, `spacing`, `origin`, `vmin`, `vmax`, …) |
| `step`, `run`, `name` | Where the value comes from (run id, series name) |
| `label` | What the card calls it: the series name, or the reference's name for B |
| `caption` | The point's caption, if any |

The host decodes the bytes, so a viewer needs no zip or `.npy` reader:

- `npz`: `{...values, ...arrays}`, each array `{data, shape, dtype, order}` with `data` a typed
  array (`Float32Array`, `Int32Array`, …; `float16` arrives as `Float32Array`, 64-bit integers as
  `Float64Array`, exact up to 2^53, and `bool` as `Uint8Array`), `dtype` the stored NumPy name
  (`"float32"`) and `order` `"C"`.
- `json`: the parsed value.
- `bytes`: an `ArrayBuffer`.
- A built-in kind stored as `.npz` (a volume): its arrays, e.g. `{data: {data, shape: [D, H, W], …}}`.

Buffers are transferred to the frame, not copied.

### Lifecycle

1. The card creates the frame; its boot script reports ready.
2. The host sends the viewer's files; the frame turns them into blob URLs, installs an import map
   and imports `cairn:sdk`, then the entry module. The entry registers its callbacks at the top
   level.
3. Each change sends a render (or a resize, view, theme or settings message). Snapshots are asked
   for when the frame is about to be paused or a report is exported.
4. Paused or unmounted frames are torn down; their blob URLs are revoked.

A viewer that has not finished loading after 15 s, or whose render callback has not returned
after 20 s, shows an error in the card with a **Reload** button. Errors never break the page.

## Protocol

`cairn:sdk` speaks a small postMessage protocol; you only need it to write a viewer without the
SDK. Every message is `{type, v: 1, …}`. Both sides ignore unknown fields and types, and accept
any `v` (a newer peer only adds fields). Everything a frame sends is validated by the host.

| Host → frame | Fields | |
|---|---|---|
| `cairn:boot` | `files`, `imports`, `entry` | Load the viewer (once) |
| `cairn:render` | `seq`, `inputs`, `step`, `settings`, `size`, `theme`, `view` | Draw |
| `cairn:resize` | `size` | |
| `cairn:view` | `view` | A sibling pane or the card moved the view |
| `cairn:theme` | `theme` | |
| `cairn:settings` | `settings` | Only the settings changed |
| `cairn:snapshot` | `id` | Send a picture |

| Frame → host | Fields | |
|---|---|---|
| `cairn:ready` | `sdk` | The boot script runs; send `cairn:boot` |
| `cairn:loaded` | — | The entry module ran |
| `cairn:rendered` | `seq` | A render returned |
| `cairn:view` | `view`, `final` | The user moved the view (`final`: gesture end) |
| `cairn:settings` | `patch` | The viewer changes its settings |
| `cairn:snapshot` | `id`, `url` | A `data:image/png`, `jpeg` or `webp` URL, or `null` |
| `cairn:size` | `height` | Preferred height |
| `cairn:error` | `message`, `stack` | |

## Commands

| Command | Does |
|---|---|
| `cairn viewer init DIR [--kind KIND] [--name NAME] [--three]` | Write a starter viewer (manifest, `index.js`, `README.md`). Name: the folder's name; kind: the name. Refuses a folder that already has a manifest. |
| `cairn viewer add DIR SPEC [--as NAME] [--external PKG]...` | Vendor an npm package for offline use (see [Libraries](#libraries-imports-and-cairn-viewer-add)) |
| `cairn viewer dev DIR --project P [--repo/--server] [--interval 0.5]` | Serve the folder live to a running server (with a local repo: the `cairn ui` serving it) |
| `cairn viewer publish DIR --project P [--alias A]... [--repo/--server]` | Publish a new version if the folder changed; prints `project/name:vN` |
| `cairn viewer ls --project P [--all-versions] [--repo/--server]` | List the project's viewers: name, version (or `dev rN`), inputs, accepts, and manifest errors |

`--project` is always required. From Python: `cairn.publish_viewer(dir, project=…, aliases=…,
repo=…)` and `run.use_viewer(dir, aliases=…)` (publishes to the run's project and records the run
as the version's producer).

## Publishing and versions

A published viewer is an [artifact](artifacts.md) of type `cairn-viewer`, named after the
manifest's `name`: its files are the version's entries and the normalized manifest is in the
version's metadata. A new version is created only when the folder's content digest (over every
file's path and SHA-256) differs from `latest`'s, so `run.use_viewer` at the start of every
training run is cheap. Aliases work as for any artifact.

A card uses the viewer's `latest` unless it pins a version: the gear's **Version** control (Data ›
Series) stores `viewer_version: N` in the card's settings.

### Live development

`cairn viewer dev` scans the folder every `--interval` seconds and sends changed files to the
server. It needs a running `cairn ui` or `cairn server` and write access: a local repo
(`--repo`, `CAIRN_REPO`, `./.cairn`) that a `cairn ui` serves connects to that server, as every
command does; with no server on it, the command refuses. Each complete change bumps the source's revision, and open cards reload their frames
(the UI polls the viewer list every 2 s while a dev source exists). While the dev source lives it
wins over the published viewer of the same name in every card that does not pin a version. An invalid manifest is reported in the command's output and the last valid one stays
in use. Ctrl-C removes the source; otherwise it expires 30 s after the command stops. Dev sources
are never part of reports or share links.

## Default viewers

Every kind of data has exactly one **default viewer** per project, and every card without a
viewer of its own shows its data in it:

- A **built-in type** (`image`, `mesh`, `volume`, …) shows in its built-in card, or in the
  [built-in viewer](#built-in-viewers) cairn ships for it (`cairn.volume` for volumes), until the
  project picks another. Publishing a viewer that accepts the type never changes that by itself.
- A **custom kind** gets its default when a viewer declares it, and otherwise from the first
  viewer ever published that accepts it while it has none. Publishing more viewers for it later
  does not change it.

Declare defaults when publishing (each kind must be one the viewer's `accepts` match; a bare name
that is not a built-in type is a custom kind):

```python
run.use_viewer("viewers/raymarch", default_for=["volume"])
cairn.publish_viewer("viewers/vmf", project="guiding", default_for=["guiding/vmf"])
```

```bash
cairn viewer publish viewers/raymarch --project P --default-for volume
```

A publish that declares `default_for` makes a new version when the declaration differs from
`latest`'s, and sets those defaults again then; republishing an unchanged folder with the same
declaration changes nothing, so a default changed on the Defaults page stays.

The project's **Defaults** page lists them under **Default viewer per type**: one row per built-in
type some viewer accepts and per custom kind, each with the viewers that accept it (for a
built-in type, also its built-in card or viewer). The API is
`GET /api/projects/{p}/viewer-defaults` (`{defaults: {kind: viewer}, builtin: {kind: viewer}}`)
and `PUT` with `{kind, viewer}` (`viewer: null` goes back to the built-in card or viewer). Keys are
built-in types or `custom:<kind>` patterns; a series takes the most specific key matching it.

### Built-in viewers

Cairn ships viewers with the UI, named `cairn.<name>`, in every project without publishing:

| Viewer | Accepts | Default for |
|---|---|---|
| `cairn.volume` (Volume (ray marching)) | `volume` | `volume` |

They are listed with the project's viewers (marked built-in), show in the **Type** tab, the
**Viewer** setting of reports and the Defaults page like any viewer, and are always available to reports and
share links. Viewer names starting with `cairn.` are reserved. In a browser without WebGL2 a
volume card falls back to offering each step's `.npz` for download.

## How cards pick a viewer

- A card of type `custom` (shown as the viewer's title in the type list) names its viewer in
  `settings.viewer`, optionally pinned by `viewer_version`. Without `viewer` (**Default** in the
  gear), it uses the default viewer of its data's kind; for a custom kind with no default (only
  dev sources accept it), the most specific accepting viewer: a pattern without wildcards beats
  any glob, and among globs the one with more literal characters wins.
- A series of custom data gets a `custom` card in the run page's workspace; without an accepting
  viewer it says so and offers the value for download.
- A card of a **built-in type** shows in its type's default viewer when that is a custom viewer
  (`volume` → `cairn.volume`), else in its built-in card.
- The [artifact explorer](../ui/artifacts.md) opens custom data in its kind's default viewer, else
  as arrays, a JSON tree or a download.

### The gear editor

The gear is the card's only editor (the [card editor](../ui/workspace.md#full-screen-card-and-settings),
which also adds cards). Its **Data** tab picks the series and its **Type** tab the card type: the
list offers **Default (<name>)** (the kind's default viewer; a built-in type shows it as
`Volume (default: …)`) and every viewer that accepts all of the card's data (by title, with its
icon) next to the built-in types, each as a live tile, and the card changes at once. The
viewer's own settings sit in the tabs and sections their manifest names; Data › Series has **Version** (latest or a published `vN`), and Data › Compare has the
reference. (In reports and share links, which have no Card section, Data › Series also has
**Viewer**.)

## Galleries, comparisons and sync

- **Galleries**: one frame per item, each with its caption.
- **Several runs** (a comparison, or a card with several series): one pane per run, like any
  media card, with the card's modes and **Max runs**.
- **Reference pairing**: gear › Data › Compare › **Reference tag** picks another series of the
  same run (with **Pin reference step**). A `compare` viewer gets each pane's value and the
  reference as `inputs[0]` and `inputs[1]`, and draws the comparison itself (side by side, a
  difference, …). A `single` viewer shows the reference as a second frame beside the value.
- **Step**: the card's step slider, and the section's media slider when the card follows it.
- <a id="view-sync"></a>**View sync** (`"view": true`): `setView` streams the view to every other
  frame of the card (other runs, gallery items, A and B) while the gesture runs; when it ends,
  the view is stored in the card's settings (`view`), so it survives reloads and is part of
  reports. The header's reset-view button clears it, and every frame gets `onView(null)`.

## WebGL budget and snapshots

Browsers allow about 16 live WebGL contexts per page. Each frame of a `"webgl": true` viewer
counts as one context in the same budget as Plotly's WebGL charts (10 live at a time).
Frames off screen or over the budget are paused: the host asks for a snapshot, removes the frame
and shows the picture until the frame is scrolled to or hovered again. A paused frame without a
current picture (a gallery larger than the budget, or a step or setting changed while paused)
takes a turn in a capture queue to load briefly, render, snapshot and close, one frame at a time,
on-screen frames first. 2D viewers (`"webgl": false`) are not budgeted.

So give a WebGL viewer a `snapshot()` that draws and reads back in one go:

```js
snapshot(() => { draw(); return renderer.domElement.toDataURL("image/png"); });
```

## Reports and share links

Custom cards go into [reports](../ui/reports.md) like any card. **Export PDF** prints each frame
as its `snapshot()` (a frame's own WebGL canvas may print blank), and **Export LaTeX** writes each
custom card's snapshot as its figure; both wait until the frames have rendered.

A [share link](../ui/sharing.md) of a report can load the viewers its cards use: the version a
card names (`viewer`, pinned or `latest`), and for cards without one the `latest` of their kinds'
default viewers (a `custom` card: also every viewer accepting custom data). Built-in viewers are
part of the app and always load. Share principals can list and fetch only those versions, and
never dev sources.

## Security model

Viewer code is untrusted, like logged HTML:

- It runs only inside `<iframe sandbox="allow-scripts" srcdoc=…>`: an opaque origin, without
  `allow-same-origin`, `allow-popups`, `allow-forms` or `allow-top-navigation`.
- The frame's Content Security Policy is `default-src 'none'; script-src blob: 'unsafe-inline';
  style-src blob: 'unsafe-inline'; img-src blob: data:; font-src blob: data:; media-src blob:
  data:; connect-src 'none'; worker-src blob:; base-uri 'none'; form-action 'none'`.
- The app's pages carry `Content-Security-Policy: frame-src 'self' blob:`, so a frame cannot
  navigate itself to an outside URL (data in the query string): the navigation is refused before
  a request leaves. A frame that navigates away anyway is stopped and gets no more data.
- The host fetches the viewer's files and the data with your session and passes them in;
  messages from a frame are accepted only from that frame's window and validated.
- Viewer files and data blobs are served with `X-Content-Type-Options: nosniff` and
  `Content-Security-Policy: sandbox`, so opening one directly never runs in the app's origin.

So a viewer cannot: make any network request (`fetch`, XHR, WebSocket, external scripts,
images, styles or fonts, `import("https://…")`); read cookies, `localStorage` or the API; touch
the parent page's DOM; open popups, submit forms or navigate the top window or itself away. It
can: run scripts and modules from its folder, use WebGL/WebGL2 and 2D canvases, start workers from
blob URLs, and load its own files through `asset()`.

!!! note
    Because the app's `frame-src` is inherited by sandboxed frames, an [HTML card](../ui/cards.md)
    cannot embed an external `<iframe>` (a video player, a remote page) either.

## Troubleshooting

| Symptom | Cause |
|---|---|
| "No custom viewer accepts this data" | No published (or dev) viewer of the run's project accepts `custom:<kind>`. Check `cairn viewer ls --project P`: the project and the `accepts` patterns. |
| "viewer … did not load within 15 s" | The entry threw before registering, or imports something that is not in the folder (the console of the frame shows which). Every library must be vendored. |
| "did not finish rendering step … within 20 s" | The render callback never returned (an awaited promise that never settles). |
| Manifest errors | `cairn viewer publish` refuses the folder; `cairn viewer dev` prints the error and keeps the last valid manifest; `cairn viewer ls` shows `[error: …]`. |
| A vendored library fails with a bare import | Map that package in `imports`, or vendor again with `--external PKG` (for `three`, the host's three is used). |
| Blank pictures in paused frames or exports | A WebGL canvas is cleared after drawing: give `snapshot()` a callback that draws first, or create the renderer with `preserveDrawingBuffer: true`. |
| `cairn viewer dev` changes don't show | The command needs a running server with write access (a `cairn ui` on the same local repo, or `--server URL`), and `--project` must be the project of the run you are looking at. |
| WebGL on a plain-HTTP LAN address | WebGL works; only WebGPU needs a secure context (HTTPS or localhost). |
