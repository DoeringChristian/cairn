# cp.Report templating + default cairn theme

Status: user-approved direction (2026-07-19): Jinja2 templating; typography = mono headings + sans prose. Part of the publishable milestone.

## Goals
1. Reports render through a **template** — restylable without forking the emit.
2. A branded **`cairn` default theme**: the app's token palette (light+dark), document-grade layout and typography.
3. **Formatting correctness**: complete-enough markdown (ordered lists, tables, blockquotes, `---`), proper prose CSS.

## Design

### Templating (Jinja2)
- `jinja2` becomes a dependency of `cairn-plot` (user-approved — its first non-numeric dep).
- Templates live in the package: `cairn_plot/templates/<name>/page.html.j2` + `fragment.html.j2`; loaded via `jinja2.PackageLoader("cairn_plot", "templates")`.
- `cp.Report(template="cairn")` default; accepts a built-in name (`"cairn"`, `"minimal"`), a filesystem path to a template dir, or a `jinja2.Environment`/`Template` for full control.
- **Context contract** (the stable API templates program against):
  `{ title, blocks: [{kind: "md"|"html"|"component"|"grid", html, index}], bundle_html, store_html, meta: {generated_at, cairn_plot_version} }`.
- `page.html.j2` renders the full `<!doctype html>` document (used by `.save()`); `fragment.html.j2` renders the body-only fragment (used by `_repr_html_`/notebooks — no `<html>` shell, theme CSS scoped under the report root element so it can't leak into a notebook page).
- Block framing is template-side (Jinja macros per block kind), so a custom template can re-frame components without touching Python.
- `minimal` template reproduces today's bare output byte-similar (embedding-friendly).

### `cairn` default theme
- **Tokens**: the exact app palette from `cairn/ui/src/index.css` (`--color-bg #ffffff/#0d1117`, `--color-fg #1f2328/#e6edf3`, `--color-bg-elevated #f6f8fa/#161b22`, `--color-border`, accent `#0969da`), light default + dark via `prefers-color-scheme` AND `:root[data-theme=…]` override (the existing contract).
- **Typography**: headings/title/labels/code in the app mono stack (`ui-monospace, SFMono-Regular, Menlo, monospace`); body prose in system sans (`-apple-system, system-ui, Segoe UI, sans-serif`); type scale h1 1.6rem → h3 1.1rem, mono weight 600; prose line-height ~1.6.
- **Layout**: centered prose column `max-width: 72ch`; component blocks in app-style cards (elevated bg, 1px border, 8px radius, padding) allowed wider (`max-width: 1100px`); grids full card width; title block with a muted metadata line (generated date + cairn-plot version) and a bottom border; consistent vertical rhythm (blocks 1.5–2rem apart).
- Tables (markdown + cp.Table surroundings): bordered, elevated header row, `tabular-nums`.

### Markdown correctness (`_markdown_to_html`)
Add: ordered lists (`1.`), tables (GFM pipes, header row), blockquotes (`>`), horizontal rules (`---`), nested-list indentation (one level), and keep the converter dependency-free. Escape behavior unchanged (raw HTML only via `.html()`).

## Gates
- pytest: existing report suites green + new template tests (named template selection, custom template dir, context contract fields present, minimal ≈ legacy output).
- `examples/report_cairn_plot.py` re-rendered with the cairn template; visual check (light + dark) by orchestrator.
- Notebook fragment: `_repr_html_` contains no `<html>`/`<body>` and scopes its CSS.
- Wheel gate still passes (jinja2 declared; templates included as package data).

## Out of scope
PDF export; TOC generation (candidate follow-up); app-side report editor integration.
