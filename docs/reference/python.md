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

::: cairn.sdk.wrappers.ConfusionMatrix

::: cairn.sdk.wrappers.PRCurve

::: cairn.sdk.wrappers.ROCCurve

::: cairn.sdk.wrappers.Artifact

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

::: cairn.sdk.reader.ArtifactInfo

::: cairn.sdk.reader.LogLine

::: cairn.sdk.reader.SourceFile

::: cairn.sdk.reader.Project

::: cairn.sdk.reader.GitInfo

## Live query URLs

`query_url` builds a URL that a server resolves to the freshest matching
artifact every time it is fetched. See [Live query
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

Versioned artifacts outside a run, multi-file artifacts, and the objects
`Run.log_artifact` and `Run.use_artifact` return. See [Artifacts and
lineage](../guides/artifacts.md).

::: cairn.log_artifact

::: cairn.load_artifact

::: cairn.list_artifacts

::: cairn.sdk.run.ArtifactVersion

::: cairn.sdk.artifact_dir.Reference
    options:
      show_if_no_docstring: true

::: cairn.sdk.artifact_dir.ArtifactDir

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

::: cairn.integrations.lightning.CairnLogger
    options:
      heading: "lightning.CairnLogger"
      toc_label: "lightning.CairnLogger"

::: cairn.integrations.xgboost.CairnCallback
    options:
      heading: "xgboost.CairnCallback"
      toc_label: "xgboost.CairnCallback"

::: cairn.sdk.import_tb.import_tensorboard
