# Artifacts and lineage

Artifacts are files and objects that belong to a run but are not a series: checkpoints, datasets,
exported models, evaluation reports. cairn has two kinds:

| Kind | Created with | Identified by | Use for |
|---|---|---|---|
| **Run attachment** | `run.log_artifact(value, name)` | run + name | One-off outputs of a run |
| **Versioned artifact** | `run.log_artifact(value, name, artifact_type=...)` | project + name + version | Datasets and models that other runs consume |

Versioned artifacts form a registry per project, with version numbers and aliases. Whenever a run
consumes one with `use_artifact`, cairn records it, and the project's **lineage graph** is built
from those records.

All blobs are content-addressed: logging the same bytes twice stores them once.

## Run attachments

Without `artifact_type`, `log_artifact` serializes the value with the same handlers as
[`run.track`](media.md) and attaches it to the run under `name`. It returns the content digest.

```python
run.log_artifact(cairn.Artifact(final_state), name="final_state")         # pickled
run.log_artifact(cairn.Table(dataframe=errors_df), name="error_analysis")
run.log_artifact(cairn.Text(open("report.txt").read()), name="report")
```

`step=` optionally ties the attachment to a step.

!!! warning
    Attachments go through the type handlers, so the value must be something `run.track` would
    accept. Raw `bytes` raise `TypeError`, and a plain string, including a file path, is stored as
    text. To store a file, use a versioned artifact.

Names starting with `_cairn/` are reserved for cairn's own attachments, such as `_cairn/git.diff`.

## Versioned artifacts

Pass `artifact_type` to register a new **version** in an artifact family. A family is identified
by its name within the run's project. The type (`"dataset"`, `"model"`, …) is a free-form label
recorded when the family is created.

```python
v = run.log_artifact("checkpoints/best.pt", name="resnet18-weights", artifact_type="model",
                     metadata={"val_acc": 0.93})
v.version     # 1, then 2, 3, ... for later versions of the same family
v.hash        # content digest
```

The value can be:

- **a path to a file** (`str` or `Path`): its bytes are stored;
- **`bytes`**;
- **a directory, a `cairn.Reference`, or a list of references**: a
  [multi-file artifact](#directories-and-external-files).

`metadata` is a free-form dict stored with the version. `log_artifact` returns an
`ArtifactVersion` with `id`, `family_name`, `version`, `hash`, `size_bytes`, `metadata`,
`created_at` and `created_by_run`.

!!! note
    Other Python values are serialized by the automatic type detection used by `run.track`, which
    may not be what you expect (a 1-D NumPy array is detected as audio, for example). Save the
    object to a file first and log the file.

### Aliases

Every version gets aliases, which are names that point at exactly one version of the family.
Assigning an alias to a new version moves it away from the old one.

- With no `aliases=`, the new version gets `latest`.
- With `aliases=[...]`, it gets exactly those aliases.

```python
run.log_artifact("best.pt", name="resnet18-weights", artifact_type="model",
                 aliases=["latest", "best"])
```

!!! warning
    `aliases=["best"]` alone does **not** move `latest`. Include `"latest"` in the list if the
    new version should also be the latest.

Aliases can also be added and removed on the artifact's page in the UI.

## Consuming artifacts

```python
weights = run.use_artifact("resnet18-weights:best")          # by alias
weights = run.use_artifact("resnet18-weights:v3")            # by version number
data = run.use_artifact("cifar10-train:latest", role="train")
```

The reference is `"name:alias"` or `"name:vN"`, resolved in the run's project. `use_artifact`
records that this run consumed that exact version, with an optional `role` label (default
`"input"`), and returns:

- an [`ArtifactDir`](#directories-and-external-files) for a multi-file artifact;
- the stored `bytes` for a file or bytes artifact.

For example, to load a checkpoint:

```python
import io, torch
state = torch.load(io.BytesIO(run.use_artifact("resnet18-weights:best")))
```

!!! note
    `use_artifact` needs to query the database immediately, so it isn't available in
    [WAL mode](../getting-started.md#wal-mode-many-writers-on-a-shared-filesystem).

## Directories and external files

A directory becomes a **multi-file artifact**. Every file under it is uploaded (content-addressed,
so unchanged files are stored once across versions), and a manifest listing them is versioned:

```python
run.log_artifact("data/cifar10/", name="cifar10-train", artifact_type="dataset")
```

A `cairn.Reference` records a file that lives elsewhere, by URI, without uploading it:

```python
run.log_artifact(cairn.Reference("s3://bucket/raw.tar", size=1_234_567), name="raw", artifact_type="dataset")

shards = [cairn.Reference(u, path=f"shard{i}.tar") for i, u in enumerate(urls)]
run.log_artifact(shards, name="shards", artifact_type="dataset")
```

`Reference(uri, path=None, *, size=None, etag=None)`: `path` is the entry's name inside the
artifact (by default the last segment of the URI). `size` and `etag` are recorded when given.
Entry paths must be unique within an artifact. A multi-file value passed without `artifact_type`
is still versioned, with type `"artifact"`.

`use_artifact` returns an `ArtifactDir` for these:

```python
ds = run.use_artifact("cifar10-train:latest")
len(ds)                        # number of entries
ds.files                       # [{"path", "hash", "size", "mime"} or {"path", "uri", "size", "etag"}, ...]
ds.read("labels.json")         # bytes of one entry
ds.open("images/0001.png")     # a binary file object
ds.download("/tmp/cifar10")    # write every entry under this directory
```

Reading a `Reference` entry goes through [fsspec](https://filesystem-spec.readthedocs.io/), so
install `fsspec` and the filesystem for the URI's scheme (for example `s3fs` for `s3://`).

## Without a run

Top-level functions work on the registry without creating a run. They resolve the repo like a
run does, and take an explicit `project`:

```python
import cairn

cairn.log_artifact("model.onnx", name="exported", type="model", project="cifar10",
                   aliases=["latest", "production"])
blob = cairn.load_artifact("exported:production", project="cifar10")
cairn.list_artifacts(project="cifar10", type="model")     # families with versions and aliases
```

A version logged this way has no producing run, and a `load_artifact` is not recorded as a
consumption.

## Lineage

Each version records the run that created it, and each `use_artifact` records a consuming run.
Together these form a graph of runs and artifact versions, which the UI shows on the project's
**Artifacts** and **Lineage** pages. Forked runs also appear linked to their parent.

From Python:

```python
reader = cairn.Reader()
run = reader.run(run_id)
run.input_artifacts()                               # versions this run consumed, with roles
run.output_artifacts()                              # versions this run created
reader.artifact_families("cifar10")                 # the registry
reader.artifact_versions("resnet18-weights", project="cifar10")
reader.lineage("cifar10")                           # {"nodes": [...], "edges": [...]}
```

See [Reading data back](reading.md) for more on the reader.
