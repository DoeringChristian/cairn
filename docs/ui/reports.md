# Reports

Reports are the default project page. Each report is an artifact family with
immutable published versions containing source, evidence, environment details,
notebook outputs and the rendered document. The publication picker opens any
retained version; editing never changes the version someone is already reading.

Choose **New report** on the project's reports page to start writing immediately.
A draft named **NewReport** opens with a blank Markdown cell; change its title in
the notebook metadata whenever you are ready. Write Markdown and Python, run
cells, then publish the first version directly from the browser.

The book/pencil toggle switches between reading and editing. The notebook editor
has Markdown, Python, metadata and card cells, with syntax highlighting, search,
undo, automatic indentation and keyboard shortcuts. Edit prose inline, insert or
remove cells, or switch to source files for direct QMD editing. An explicit
**Make a copy** creates a separate report family. Notebook and source-file edits
autosave. One header shows draft save status and **Publish**. Switching to Read or
between editor views waits for the draft to save; a failed save keeps your edits.
**Run all** stays with the notebook execution controls.

Running a Python cell first executes its required upstream cells. Unchanged
prefixes can reuse a live kernel; upstream edits mark dependent output stale.
Saved execution results and caches survive server restarts, and idle kernels
close automatically. Publishing performs a complete build against captured
source, pinned inputs and a resolved environment, then adds a new version.
The **Publish** button shows progress above the editor and stays
disabled until the build finishes. Progress survives a reload. Success refreshes
the current version and publication history; failure leaves the published report
unchanged and shows the error with build diagnostics. Repeated requests for the
same active build reuse that build. Concurrent stale source saves or publications
fail instead of overwriting work.

For external authoring, create `reports/<slug>/report.qmd` with
`cairn report new <slug>`. YAML frontmatter declares inputs and environment;
`{python}` fences execute code. `cairn report publish <slug>` builds locally;
`--execution server --server URL` builds on the selected server. There is no
required AI integration and no Quarto runtime dependency.

Inputs use `run:<full-id>` for finished runs and
`artifact:<project>/<name>:vN` for artifacts. The build captures immutable run
snapshots and resolves artifact aliases before execution. Copies retain those
exact references. Captured run evidence includes structured `records.jsonl`,
metric projections, media, configuration and summaries.

The reader includes Markdown, math, citations, callouts, tables, Plotly, images,
audio, video, captured cards and custom viewers. Plotly figures show the standard
Plotly toolbar. Card actions use camera, settings and overflow icons; source
references and other secondary actions live in the overflow menu. File inspection,
publication history and standalone HTML/bundle downloads are report-level actions.
Copy reference produces an editor-ready source location and Markdown quotation,
for example `reports/study/report.qmd:42 "The result is $x^2$."`. Included files
retain their own paths and line numbers. Media references retain the selected
time, clip or region without copying the media payload.

The × deletes a report from the project list. Authentication uses the server's
single token; reports do not introduce separate credentials. Python execution
runs trusted author code on the selected machine, outside an OS security sandbox.
