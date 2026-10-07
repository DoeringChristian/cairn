# Python API

Everything below is importable from the top-level `cairn` package
(`cairn.Run`, `cairn.Image`, `cairn.Reader`, …) unless its heading shows a
module path. This page is generated from the docstrings; the
[guides](../guides/index.md) show how the pieces fit together.

## Run and scope

A `Run` records one execution: its config, metric series, media, artifacts and
summary. A `Scope` is a name prefix and step bound to a run; components log
themselves through one in `__cairn_track__`. See [Logging
metrics](../guides/logging.md), [Run lifecycle](../guides/runs.md) and
[Components and scopes](../guides/scopes.md).

::: cairn.sdk.run.Run
    options:
      show_if_no_docstring: true

`cairn.attach` and `cairn.new_run_id` are for [several processes logging into
one run](../guides/runs.md#several-processes-one-run).

::: cairn.sdk.run.attach

::: cairn.sdk.run_ids.new_run_id

::: cairn.sdk.scope.Scope

## Media and rich types

Wrap a value in one of these classes and pass it to `run.track(...)` to choose
how it is stored and shown. Plain NumPy arrays, PIL images, matplotlib and
Plotly figures are recognised without a wrapper. See [Media and rich
types](../guides/media.md).

::: cairn.sdk.wrappers.Image

::: cairn.sdk.wrappers.Figure

::: cairn.sdk.wrappers.Audio

::: cairn.sdk.wrappers.Video

::: cairn.sdk.wrappers.Histogram

::: cairn.sdk.wrappers.Tensor

::: cairn.sdk.wrappers.Table

::: cairn.sdk.wrappers.Text

::: cairn.sdk.wrappers.Html

::: cairn.sdk.wrappers.Markdown

::: cairn.sdk.wrappers.PointCloud

::: cairn.sdk.wrappers.Mesh

::: cairn.sdk.wrappers.Boxes3D

::: cairn.sdk.wrappers.Octree

::: cairn.sdk.wrappers.BVH

::: cairn.sdk.wrappers.Volume

::: cairn.sdk.wrappers.Data

::: cairn.sdk.wrappers.ConfusionMatrix

::: cairn.sdk.wrappers.PRCurve

::: cairn.sdk.wrappers.ROCCurve

::: cairn.sdk.wrappers.Pickle

## Reading data

`Reader` opens a repo, a server or a run archive; `RunQuery` selects runs; the
reader's `Run` exposes a run's data and `RunEditor` changes it. See [Reading
data back](../guides/reading.md).

::: cairn.sdk.reader.Reader

::: cairn.sdk.reader.RunQuery
    options:
      show_if_no_docstring: true

::: cairn.sdk.reader.Run
    options:
      show_if_no_docstring: true
      heading: "Run (reader)"
      toc_label: "Run (reader)"

::: cairn.sdk.reader.RunEditor
    options:
      show_if_no_docstring: true

::: cairn.sdk.reader.Sequence
    options:
      show_if_no_docstring: true

::: cairn.sdk.reader.SequencePoint

::: cairn.sdk.reader.SequenceInfo

::: cairn.sdk.reader.DataRef
    options:
      show_if_no_docstring: true

::: cairn.sdk.reader.MediaRef
    options:
      show_if_no_docstring: true

::: cairn.sdk.reader.LogLine

::: cairn.sdk.reader.SourceFile

::: cairn.sdk.reader.Project

::: cairn.sdk.reader.GitInfo

## Live query URLs

`query_url` builds a URL that a server resolves to the freshest matching
media point every time it is fetched. See [Live query
URLs](../guides/reading.md#live-query-urls).

::: cairn.sdk.query_urls.query_url

## Sweeps

`cairn.sweep` creates a hyperparameter sweep; a `Sweep` handle runs, inspects
and controls it. See [Sweeps](../guides/sweeps.md).

::: cairn.sdk.sweep.sweep

::: cairn.sdk.sweep.Sweep
    options:
      show_if_no_docstring: true

## Artifacts

`Artifact` builds a version; `Run.log_artifact` / `cairn.log_artifact` log
it; `Run.use_artifact` and the reader return `ArtifactVersion`s. See
[Artifacts and lineage](../guides/artifacts.md).

::: cairn.sdk.artifacts.Artifact

::: cairn.log_artifact

::: cairn.sdk.artifacts.ArtifactVersion
    options:
      show_if_no_docstring: true

::: cairn.sdk.artifacts.ArtifactEntry

::: cairn.sdk.artifacts.ArtifactFamily

## Custom viewers

Viewer folders (a `cairn-viewer.json` manifest and ES modules) are published as artifacts of type
`cairn-viewer`; `Run.use_viewer` publishes one from a training script, and `cairn.Data` logs the
data they draw. See [Custom viewers](../guides/custom-viewers.md).

::: cairn.publish_viewer

## Configuration

`configure` sets process-wide defaults for where runs go and whether tracking
is enabled. See [Configuration](configuration.md).

::: cairn.config.configure

## Custom type handlers

A type handler turns objects of a type into stored bytes. Register one to make
`run.track` accept a type cairn does not know.

::: cairn.sdk.handlers.registry.register_handler

::: cairn.sdk.handlers.registry.TypeHandler

## Integrations

Callbacks and loggers for training frameworks. Each needs its framework
installed. See [Integrations](../guides/integrations.md).

::: cairn.integrations.huggingface.CairnCallback
    options:
      heading: "huggingface.CairnCallback"
      toc_label: "huggingface.CairnCallback"

::: cairn.integrations.keras.CairnCallback
    options:
      heading: "keras.CairnCallback"
      toc_label: "keras.CairnCallback"

::: cairn.integrations.keras.CairnModelCheckpoint
    options:
      heading: "keras.CairnModelCheckpoint"
      toc_label: "keras.CairnModelCheckpoint"
      members: false

::: cairn.integrations.lightning.CairnLogger
    options:
      heading: "lightning.CairnLogger"
      toc_label: "lightning.CairnLogger"

::: cairn.integrations.ultralytics.add_cairn_callbacks
    options:
      heading: "ultralytics.add_cairn_callbacks"
      toc_label: "ultralytics.add_cairn_callbacks"

::: cairn.integrations.xgboost.CairnCallback
    options:
      heading: "xgboost.CairnCallback"
      toc_label: "xgboost.CairnCallback"

::: cairn.sdk.import_tb.import_tensorboard
