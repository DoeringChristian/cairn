# Cairn showcase

A deterministic experiment with a report as its entry point. It creates eight runs, a dataset, three model versions and aliases, a custom viewer, a three-trial grid sweep, and three linked reports. The overview is published twice to exercise retained publication history. No dataset downloads or external services are used.

From the Cairn checkout, using an environment with `cairn-track[reports,media]`, NumPy, matplotlib, Plotly, IPython and the report execution dependencies installed:

```sh
.venv/bin/python examples/showcase/run.py --output /tmp/cairn-showcase
.venv/bin/cairn ui --repo /tmp/cairn-showcase/repo --port 4382
```

Open <http://127.0.0.1:4382/p/cairn-showcase>. Start with **A complete Cairn experiment**. The output directory contains editable `reports/*/report.qmd`, `showcase.json` with run and publication identifiers, and standalone `showcase.html`, `media.html`, and `methods.html` exports. Choose a new output directory to rerun; the script refuses to overwrite existing reports.

The same experiment works against an explicitly started remote server:

```sh
# Configure CAIRN_TOKEN for the selected server in your shell.
.venv/bin/python examples/showcase/run.py \
  --output /tmp/cairn-showcase-remote \
  --repo http://127.0.0.1:4300
```

Use `--project another-name` when sharing a repository with another showcase. The verification expects a fresh project containing exactly this example's eight runs. Remote journal files live under OUTPUT/buffer; they are delivery state, not a second repository.

For development, `--prepare-only` creates evidence and report sources, then `--publish-only --output PATH` builds and publishes that prepared directory. To change the reports after preparation, edit the generated sources in PATH/reports.

| Feature | Where to see it |
|---|---|
| `init`, `log`, `finish`, explicit `Run` | `run.py`; preparation, training, evaluation |
| Config, summaries, tags, shared steps, `commit=False`, metric rules | Three training runs; overview comparison |
| Reader metric queries and lineage | Executable assertions in `run.py` |
| Dataset and model versions, aliases, producer/consumer lineage | Artifacts and lineage navigation |
| Grid sweep and selected trial | Methods report; Sweeps |
| Images, boxes, masks, gallery | Evaluation run: `image`, `image_gallery` |
| matplotlib, Plotly, tables, text, Markdown, HTML | Evaluation run and report media atlas |
| Audio and video | Media atlas and evaluation run |
| Histograms, tensors, classification matrix, PR and ROC | Evaluation run |
| Point clouds, meshes, boxes, octree, BVH | Evaluation run's geometry series |
| Volume storage | Evaluation run; built-in volume support is download/metadata |
| Custom typed data and sandboxed versioned viewer | Evaluation run `custom`; artifact `hist` |
| Expressions, transformed x, grouped mean/standard deviation and exponential smoothing | Overview; bounded evaluation over captured evidence |
| Pinned line, bar, scatter, histogram, scalar, table and custom cards | All three reports; identical captured HTML in native and offline readers |
| Executed Python, display HTML/Markdown/JSON, figures and math | Three executable `.qmd` report sources |
| Callouts, tables, source media, includes, footnotes | Overview and methods reports |
| Echo, disabled execution, hidden output, generated files | Methods execution examples |
| Pinned inputs, publication history, source and output provenance | Report versions and `showcase.json` |
| Offline HTML export | OUTPUT/showcase.html, media.html, methods.html |
| Local path or remote URL | Same script's `--repo` option |

This tour covers the core tracking, media, artifacts, sweep and report workflows. Specialized framework hooks and distributed launchers remain separate examples. It does not benchmark performance or simulate crash recovery, and it does not claim complete Folio/Quarto compatibility. Graphviz diagrams additionally require a Graphviz installation.

Reports are versioned artifacts. In the browser, open **Edit** to change Markdown, Python or metadata cells, run a selected Python prefix, inspect outputs, and publish a new version of the same report. **Source** opens the Markdown/Python editor with all source files. Inline block edits use the original source range. **Make a copy** creates a separate report family; prior versions remain immutable. A server build executes on the selected server; a local build executes on the authoring machine. Keep the older publication available while the new draft is being edited and built. The authoring format is executable Markdown with YAML frontmatter, `{python}` fences, and `#|` cell options; it does not require Quarto.

For external authoring on a shared server, this example copies a publication into a separately named report and publishes it explicitly:

```sh
cairn report copy REPORT_ID --server http://127.0.0.1:4300 \
  --project-dir ./report-work --slug revised-comparison
# Edit report-work/reports/revised-comparison/report.qmd and its local assets.
cairn report publish revised-comparison --server http://127.0.0.1:4300 \
  --project-dir ./report-work --project cairn-showcase --execution server
```

`copy --version VERSION` starts from a particular published build. Editing source can happen in a text editor or an external coding assistant; the report system has no built-in AI service. Server execution runs author-supplied Python on the chosen server and requires an explicit build request.

Notebook acceptance: run the first Python cell, then a later cell; the later run reuses the unchanged prefix. Edit the first cell and downstream output becomes stale. Run again to recompute, then publish and use version history to reopen the prior report. Cell runs are draft previews; publishing is explicit.
