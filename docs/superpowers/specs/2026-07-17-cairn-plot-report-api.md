# Design: `cp.Report` — a composable, self-contained cairn-plot HTML report

Date: 2026-07-17. Status: IMPLEMENTED (Q21). Track: cairn-plot / cp.Report API.

## 0. TL;DR

`cairn.plot.Report` (a.k.a. `cp.Report`, lowercase factory `cp.report`) is a
chainable builder that assembles **markdown + raw HTML + composable `cp.*`
components** into **ONE self-contained HTML document** — no server round-trip,
no CDN, no webfonts. It is built entirely on the existing pure `cairn-plot`
`PlotElement` bundle+store+mount emit: the renderer bundle is inlined **once**,
every component's baked binary blobs are merged into **one** content-addressed
store (deduped by content hash), and the markdown/raw-HTML/per-component mount
`<div>`s are interleaved in insertion order.

It is a **different deliverable** from the pre-existing `cairn.Report` (the
notebook-inline, server-backed *card* container in `cairn/sdk/report.py`), and
the two coexist case-insensitively across namespaces — `cairn.Report` vs
`cairn.plot.Report` — the same posture as `cp.Bar` (native composable) vs
`cp.bar` (plotly recipe).

## 1. Why a new object (not an extension of `cairn.Report`)

`cairn.Report` concatenates each element's own `_repr_html_`; for a
server-backed `CardElement` that is a live `/embed/card` **iframe**, which
needs a running `cairn ui`. That is exactly the coupling the cairn-plot library
was built to remove. `cp.Report` instead composes the **pure renderer** emit
(`PlotElement`), so the whole report is offline and portable: it opens from a
`file://` path with nothing running. Reusing the same class name across the two
namespaces keeps the ergonomics W&B/Plotly users expect (`report = cp.Report()`)
without breaking the existing `cairn.Report` contract or its tests.

## 2. Public API

```python
import cairn.plot as cp

rep = (
    cp.Report(title="Ablation study")            # or cp.report("...")
      .md("# Results\n\n**bold**, `code`, [link](https://x)")
      .markdown("...")                            # alias of .md
      .html("<div class='note'>raw html</div>")   # injected verbatim
      .add(cp.Line(run["loss"]))                  # any cp.* Component
      .add(cp.Image(img_bytes))                   # or a prebuilt PlotElement
      .grid([cp.Image(a), cp.Image(b)], cols=2)   # sugar for .add(cp.Grid(...))
)

rep._repr_html_()          # notebook display (fragment)
rep._repr_mimebundle_()    # Jupyter/marimo
rep.show()                 # IPython.display, else returns self
rep.save("report.html")    # ONE self-contained .html file (full document)
```

Every builder returns `self` (chainable). `.add(x)` accepts any `cp.*`
`Component` (leaf or container) or an already-built `PlotElement` (what the
lowercase `cp.image`/`cp.line`/... factories return); anything else raises a
clear `TypeError` pointing at `.md`/`.html`.

## 3. Emit model

`_body_html()` produces the report fragment in this order:

1. **Renderer bundle (once).** The core IIFE + design-token CSS, inlined and
   guarded by `window.__cairnPlotBundleLoaded`, plus **only** the addons some
   component actually needs — figure (Plotly), three (3D), gpu-image
   (image/compare) — each guarded include-once. Addon need is aggregated across
   all components via `PlotElement._descriptor_has_figure/_three/_image()`. A
   line-only report pulls **no** addon.
2. **Merged content-addressed store (once).** `_merged_store()` unions every
   component's `PlotElement._store` into one dict keyed by content hash, so a
   blob shared across cells (e.g. the same image twice) is emitted **exactly
   once**, then additively `Object.assign`-ed into `window.__cairnPlotStore`.
3. **Interleaved blocks.** In insertion order: markdown → HTML
   (`_markdown_to_html`), raw HTML verbatim, and each component's
   `PlotElement._mount_html(div_id, desc_id)` (a `<div class="cairn-plot-mount">`
   + its `application/cairn-plot+json` descriptor + a `__cairnPlotQueue` push).

`_repr_html_` returns this fragment (or a visible placeholder when empty), and
**never raises** — a missing dist / serialization failure degrades to an inline
`<pre>` message. `save()` wraps the same fragment in a complete
`<!doctype html>` document; because the bundle and data are already inlined, the
file is fully offline.

Key reuse: the report does **not** reinvent any bundling. It calls the same
`cairn/sdk/_plot_bundle.py` helpers (`inline_core_js/css`, `inline_*_addon_js`,
`json_script_safe`) and the same `PlotElement._mount_html`/`._store` the
single-plot emit uses — one bundling path, one XSS-safe script serializer
(`<`/`>`/`&`/U+2028/U+2029 escaped).

## 4. Markdown → HTML

Reuses (and extends) the existing minimal converter in `cairn/sdk/report.py`
(`_markdown_to_html`) — cairn has **no** markdown dependency and `pyproject`
adds none. Supported: headings, paragraphs, bullet lists, `**bold**` /
`*italic*` / inline `` `code` ``, plus the two spans this task added —
**fenced ```` ``` ```` code blocks** (`<pre><code>`, content HTML-escaped,
info-string ignored, unterminated fence still flushed) and **`[text](url)`
links** (`<a href>`, applied to already-escaped text so the url is
attribute-safe). Extending the shared converter is additive: the existing
`cairn.Report` tests stay green and inherit fenced code + links for free.

## 5. Decisions

- **One class name per namespace.** `PlotReport` is the concrete class in
  `cairn/sdk/report.py`; `cairn.plot` exposes it as `Report` and the lowercase
  `report()` factory. It never shadows `cairn.Report`.
- **Inline bundle always.** Even if a component was built `data_mode="endpoint"`
  (a `bundle="link"` PlotElement), the report emits the inline core bundle; the
  descriptor still carries the endpoint and the core bootstrap fetches by
  reference at runtime. This keeps the report self-contained for the common
  (local) case and functional for the endpoint case, with one code path.
- **Store dedup is free.** The store is content-addressed, so a plain `dict`
  union deduplicates; no explicit hashing pass is needed in the report.
- **Display hooks never raise** (matches `Component`/`PlotElement`), so a report
  is always safe as the last expression in a notebook cell.

## 6. Files

- `cairn/sdk/report.py` — `PlotReport` class + markdown fenced-code/link
  extensions (shared `_markdown_to_html`).
- `cairn/plot.py` — `Report` (== `PlotReport`) + `report()` factory + `__all__`.
- `tests/unit/test_plot_report.py` — new coverage (self-contained doc with
  md+html+2 components; merged-store dedup; addon gating; markdown extensions;
  save/mimebundle/empty/repr).
