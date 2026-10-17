# Reports: implemented contract and Prism2 comparison

This is an acceptance inventory for the current working tree, compared against
`../prism2/docs/REPORT_FEATURES.md`, `NOTEBOOK.md`, `EDITING.md`, and its native
`DocumentRenderer`, `MediaLightbox`, selection and notebook components. It is not
a claim of complete Prism2, Folio, or Quarto parity. AI/ACP integrations are
intentionally excluded. Cairn keeps runs, artifact versions, publications, source
workspaces and build jobs as distinct domain concepts.

“Verified” below means exercised by the named tests or the executable showcase.
“Implemented” means code exists but that interaction still needs an acceptance
check. “Gap” describes behavior that is absent or materially narrower.

## Authoring and execution

| Capability | Cairn status | Acceptance evidence or remaining work |
|---|---|---|
| Canonical `report.qmd`, YAML, `{python}` fences | Verified | Showcase executes three QMD sources; ordinary Markdown remains a supported alternate entry |
| CommonMark, tables, raw HTML, footnotes | Verified within a source block | Methods report and Markdown parsers; footnote definitions spanning separately rendered source blocks need shared-context handling |
| Inputs exposed as path-compatible `inputs[role]`, `.summary`, `.config`, `.ref` | Verified | Local and authenticated HTTP showcase; no universal artifact wrapper required |
| Coherent captured run input and pinned artifact files | Verified | Snapshot domain tests; captured evidence checksums; copied publications rewrite exact input references |
| Pin inputs and environment before a new server job enters its queue | Verified | Source, input snapshots and environment are prepared before enqueue; mutation-after-enqueue integration test retains captured value |
| Parameters dictionary | Implemented | Bootstrap injects JSON-compatible values; malformed values rejected by engine contract tests |
| Real fresh Jupyter kernel | Verified | Full showcase builds; CLI server build and copied-source server build |
| `echo`, `eval`, `include`, `label`, `fig-cap` | Verified | Methods disabled/hidden cells; multiline option regression test |
| Unsupported options produce diagnostics | Verified | Frontmatter/cell validation tests; custom cards reject missing dependencies |
| Local relative includes, cycle and traversal checks, original line spans | Verified | Nested/repeated include tests check exact original lines and SHA256; each include occurrence has distinct block IDs; include-local media rebased |
| Streams, errors, HTML, SVG, PNG/JPEG, Markdown, JSON, LaTeX outputs | Implemented; representative outputs verified | Showcase exercises HTML, PNG, JSON, stdout; remaining MIME variants need a single acceptance fixture |
| Plotly MIME output | Verified | Engine contract test and media showcase; standalone bundles Plotly offline |
| MathML standalone and native KaTeX | Implemented | Methods math rendered; exact native/standalone typography need visual comparison |
| Explicit figure/table/cell references and numbered citations | Verified engine | Canonical first-citation ordering travels in document.json; Markdown-token resolution preserves code, math and link destinations; unused references omitted |
| Callouts and image galleries | Implemented | Finding/note/warning showcase; nested/custom divs rejected |
| Current-environment fingerprint | Verified locally | Retained in each build; generated current-mode kernels execute correctly |
| Managed `uv` environment lock and recreation | Verified | Fresh-cache managed Python 3.13 kernel smoke passed; packages and interpreter must remain available |
| Failed notebook and diagnostic retention | Verified by report build tests | Failure must preserve the last successful publication |
| Durable server queue, bounded worker, leases and explicit retry | Verified basic queue path | CLI enqueue/wait/publish and copy/edit/build tested; restart/lease race is separately covered by backend tests |
| Build cache keyed by source, inputs, engine and environment | Verified | Opt-in execute.cache preserves fresh builds by default; reuse, force rebuild and corrupt-cache fallback passed |
| Generated files, source map, notebook, manifest and provenance | Verified | Artifact publication bundles source/evidence/output; standalone embeds `cairn-provenance` JSON |

## Reading and cards

| Capability | Cairn status | Acceptance evidence or remaining work |
|---|---|---|
| Native reader from versioned `document.json` | Implemented and demo generated | UI visual verification is tracked separately from backend publication checks |
| Versioned report artifact; inline, notebook and source editing | Verified backend | Same-family new-version publication and explicit fork; original builds remain immutable; cell and source edits use revision/hash checks |
| Same card data in native and standalone readers | Verified contract | `card_spec` is stored with notebook/document; captured values do not read live run heads |
| Line, scatter, bar, histogram, table, scalar cards | Verified data/rendering | All six appear in showcase; native renderer uses shared figure/table components |
| Custom viewer cards with captured data and code | Verified capture | Showcase includes the same `hist` viewer as the run; dependencies and SDK are bundled; missing imports fail |
| Custom viewer SDK consistency | Verified | Exact SDK/boot-source comparison against workspace runtime in `test_report_engine_contract.py` |
| Screenshot, Settings, overflow card controls | Browser verified | Shared Cairn settings; custom viewer Normalize changed plotted maximum to 0.333; screenshot protocol captured view |
| Numeric expressions and custom x-expressions | Verified | Prism bounded AST evaluator; captured step-aligned metrics/config/summary context; no Python eval or object access |
| Grouping and capture-time smoothing/downsampling | Verified | Per-run EMA then same-x group mean and standard deviation; 1,200 endpoint-preserving samples; scan limited to 500k events, 64 MiB and 8 seconds per card |
| Nested viewer dependencies and offline execution | Verified basic dependency graph | Relative and manifest imports captured; host-provided Three.js is not implicitly available—vendor dependencies explicitly |
| Images, SVG, video, audio and interactive Plotly | Verified generated assets; UI checks pending | Media report contains all; native sanitization and media URL mapping are separate reader responsibilities |
| Image zoom/pan, regions, video time/clip selection | Implemented from Prism reader | Native `MediaLightbox`; browser acceptance must check actual region coordinates and clip references |
| Exact passage selection across blocks and inline formatting | Implemented | Prism quote/prefix/suffix/text-offset selector and unambiguous reanchoring; browser acceptance pending |
| Revision-bound comments, replies, reanchoring, resolve/reopen CAS | Verified backend | Immutable publication and existing block validation, revision-isolated list/reply, edit/resolve/delete compare-and-swap; native UI uses Prism selection contract; browser create/reply/resolve passed |
| Source inspection from displayed content | Partial | Code and source coordinates are shown; a complete source-tree inspector and exact passage routing need work |
| Publication history and pinned build URLs | Verified backend | Prior overview build remains readable after republish; list/read/history share the report domain service |
| Rich evidence/provenance/history reader panel | Partial | Data is retained; presentation is narrower than Prism's full reader workspace |
| Standalone HTML with embedded local media/runtime | Verified | Three standalone files; manifest has no unbound-media warnings for showcase |
| Standalone interaction parity with native reader | Gap | Export retains readable output and interactive chart/custom frames; native lightbox, comments and source workspace are not embedded |

## Editing scope

Cairn reports are versioned artifact publications. Editing opens a workspace for
that report family; publishing adds a new immutable version. An explicit fork
creates a separate report. Source edits and publication replacement use revision
checks, preserving prior versions and rejecting concurrent stale saves.

The native editor now adopts Prism's typed metadata/prose/Python/card cells,
source-mapped inline edits, cell insertion/deletion, and the shared CodeMirror
Markdown/Python/YAML editor. Python cells execute their dependency prefix, reuse
an unchanged live kernel, invalidate downstream output after upstream edits, and
retain execution results and cached outputs across restarts. Kernels are bounded
and close after inactivity. Whole-report publication remains an explicit build.

Reference verification ran Prism2's four notebook tests successfully, followed by
Cairn tests for prefix reuse, forced fresh execution, stale output, persistent
cache, failures, editing conflicts, HTTP operations and idle cleanup. Browser
acceptance for the new reader/editor is tracked separately.

## Acceptance sequence

1. Freeze source, input snapshots and environment together before enqueueing; mutate a live input while a job waits and prove its output stays pinned.
2. Validate the complete native reader against the showcase: every card, shared settings, screenshots, source references, Plotly, image gallery, audio, video, regions and clips.
3. Add one report fixture containing includes, citations, xrefs, all supported MIME bundles, parameters and source hashes; assert standalone and native document outputs agree.
4. Implement exact passage selectors and publication-bound comments as one domain contract before wiring comment controls.
5. Validate the adopted cell editor in the browser: edit upstream, run a later cell, inspect stale outputs, publish a new version, and reopen the prior version.

Execution uses trusted author Python in a dedicated working directory and virtual
environment. It is not an operating-system sandbox, and fingerprints do not freeze
undeclared network reads or native libraries. These limits also apply to Prism's
corresponding execution model.

### General record storage limits

Structured observations are authoritative in `run_records`; scalar and media
sequences remain a rendering index for existing cards. Ordinary JSON keys,
including empty strings and literal `$media` metadata, are preserved. A singleton
`$media` envelope declaring a hash or object type is a typed media reference and
must validate. JSON Pointer field paths escape slashes and tildes. Leading-slash paths always use JSON Pointer interpretation; other literal
top-level field names take precedence over dotted path interpretation.

Each record is limited to 256 KiB and 32 nesting levels. Queries scan at most
100,000 records, 32 MiB, or five seconds (checked between records), and return a
continuation cursor or a truncated-series flag. Series queries share these limits
across their internal pages. A single fetched batch can occupy approximately
32 MiB before decoding. Filters are limited to 32 fields and 64 KiB.

The explicit named `track(value, name)` sequence API still shares rendering names
with `log({...})` projections. Colliding sequence coordinates keep the first
rendering point and emit a run warning; complete observations and record queries
retain the later value. Avoid mixing both APIs under the same series name.
Capturing a run snapshot currently materializes its history under the run lock;
very large histories can consume substantial memory and delay concurrent writes.
