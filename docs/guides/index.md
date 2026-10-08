# Guides

The guides are task-oriented walkthroughs of the Python SDK and the server. If you have not
logged a run yet, start with [Getting started](../getting-started.md).

## Tracking

- [Logging metrics](logging.md): `run.track`, steps and names, `config`, `summary`, tags and
  notes.
- [Media and rich types](media.md): images, galleries, overlays, audio, video, tables, figures,
  classifier charts, 3D data, and registering your own types.
- [Final values and metric rules](metric-rules.md): which number the runs table shows for a
  metric, and how to change it with `summary=` and `x=`.
- [Run lifecycle](runs.md): run options, resume, rewind and fork, stopping from the UI, alerts,
  gradient histograms, system metrics and code capture, and where to put a heavy final
  evaluation.
- [Organising runs](organising-runs.md): names, groups, job types and versions; Latest only,
  nested grouping and filtering to a group in the UI.
- [Components and scopes](scopes.md): let models and datasets log themselves with
  `__cairn_track__`.
- [Artifacts and lineage](artifacts.md): versioned datasets and models, directories, external
  references, aliases and the lineage graph.

## Beyond a single run

- [Sweeps](sweeps.md): hyperparameter search with `cairn sweep` and `cairn agent`.
- [Integrations](integrations.md): Hugging Face, Lightning, Keras and XGBoost callbacks.
- [Reading data back](reading.md): `cairn.Reader`, queries and editing runs.
- [Notebooks](notebooks.md): a run page, the project workspace or a report inline in Jupyter
  and marimo.
- [Import and export](import-export.md): TensorBoard import, CSV/Parquet export, archives.
- [Server, auth and deployment](server.md): `cairn server`, tokens and remote access.
