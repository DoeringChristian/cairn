# Artifacts and lineage

An **artifact** is a versioned bundle of files or objects that runs produce and consume:
checkpoints, datasets, exported models, evaluation reports. Every logged artifact is a new
**version** of a name in a project, written `project/name:vN`. A version is a manifest of entries
(uploaded files, serialized objects and external references) with a type, metadata, aliases,
tags, the run that logged it and the runs that used it. Its entries never change.

The project's **lineage graph** follows from that: a run logs versions, other runs use them.

Media and series stay what they are: `run.track(value, name, step)` records per-step points that
the run page draws as cards ([Media](media.md)). Use an artifact when another run (or you, later)
needs the thing back.

All bytes are content-addressed: a file that does not change between versions is stored once.

## Logging an object

```python
run.log_artifact(model.state_dict(), "base-ckpt", type="model", step=epoch,
                 metadata={"val_loss": val})
```

With a value and a name, `log_artifact` stores the value as the version's single entry,
`<name>.<ext>`:

- a cairn wrapper (`cairn.Image`, `cairn.Table`, `cairn.Tensor`, `cairn.Text`, `cairn.Pickle`,
  …) is stored with its type, and read back decoded;
- `bytes` are stored as they are;
- **any other value is pickled** (`base-ckpt.pkl`). There is no media detection inside artifacts:
  a NumPy array is pickled and comes back as the same array.

A path is stored as files: a directory with every file under it (paths relative to it), a file at
its basename.

```python
run.log_artifact("checkpoints/best.pt", "resnet18-weights", type="model")
run.log_artifact("data/cifar10/", "cifar10", type="dataset")
```

A string that is not an existing path is an error (`FileNotFoundError`); store text with
`cairn.Text`.

`log_artifact` returns the new `cairn.ArtifactVersion`:

```python
v = run.log_artifact(state, "base-ckpt", type="model", step=3, tags=["warmup"])
v.ref, v.qualified_ref    # "base-ckpt:v4", "denoise/base-ckpt:v4"
v.aliases, v.tags         # ["latest"], ["warmup"]
v.step, v.metadata        # 3, {}
```

**Every call creates a new version**, even when the content is identical to the previous one, so
every run's output exists in the lineage. The name must not contain `:` or `/`. A name keeps one
type: logging `type="dataset"` under a name that is a `"model"` raises `ValueError`.

## Building an artifact: `cairn.Artifact`

For more than one entry, build a draft and log it once:

```python
art = cairn.Artifact("cifar10", type="dataset", description="train split, normalised",
                     metadata={"n_train": 50_000}, tags=["vision"])
art.add_dir("data/cifar10/train", name="train")       # every file, under train/
art.add_file("data/cifar10/labels.json")              # at labels.json
art.add_reference("s3://bucket/cifar10/raw.tar", size=170_498_071)
art.add(norm_stats, "stats.pkl")                      # a Python value, pickled
with art.new_file("README.md") as f:                  # written now, added on close
    f.write("CIFAR-10, per-channel normalised\n")
v = run.log_artifact(art, aliases=["normalised"])
```

| Method | What it adds |
|---|---|
| `add_file(path, name=None)` | One file, at `name` (default: its basename). |
| `add_dir(path, name=None)` | Every file under `path` (recursive, sorted, symlinks followed, hidden files included), under the prefix `name`. |
| `add_reference(uri, name=None, *, size=None, etag=None)` | An external file, recorded by URI and never uploaded. A local path or `file://` URI gets its size filled in. |
| `add(value, name)` | A Python value, serialized like the shorthand above. |
| `new_file(name, mode="w", encoding="utf-8")` | A file to write into (`"w"` or `"wb"`); added when the block exits. |
| `remove(name)` | A staged entry, or every entry under a directory prefix. |
| `files()` | The staged entries. |

Files are read when the draft is **logged**, not when they are added. Two entries at the same path
raise `ValueError`. Passing `name`, `type`, `metadata` or `description` to `log_artifact` together
with a draft is a `TypeError`: they belong on the draft. `aliases`, `tags` and `step` are given at
log time.

## Aliases and tags

An alias names one version of an artifact: `base-ckpt:best`.

- `latest` always names the newest version. cairn moves it on every log; you cannot set or remove
  it.
- `aliases=[...]` on `log_artifact` points your own aliases at the new version, **in addition to**
  `latest`. An alias that pointed at another version moves.
- `latest` and `v<number>` are reserved: using them as your own alias raises `ValueError`.

```python
best = float("inf")
for epoch in range(50):
    val = train_and_eval()
    run.log_artifact(model.state_dict(), "base-ckpt", type="model", step=epoch,
                     aliases=["best"] if val < best else None)
    best = min(best, val)
# "latest" is the last epoch; "best" the best one.
```

A **tag** describes a version and may be on any number of versions (`"candidate"`,
`"reviewed"`). Aliases and tags can be changed later, from Python or in the UI's
[artifact explorer](../ui/artifacts.md#editing):

```python
v = cairn.Reader().artifact("base-ckpt:v12", project="denoise")
v.add_alias("production")
v.remove_alias("production")
v.add_tag("reviewed")
v.remove_tag("reviewed")
```

## Editing and deleting

A version's entries never change, but its annotations can:

```python
v.update(description="re-evaluated", metadata={"test_acc": 0.91})   # metadata keys merge
```

`v.delete()` removes a version (its entries, aliases and consumption records). A version that an
alias names, `latest` included, is refused with `ValueError` unless `v.delete(force=True)`; then
`latest` moves to the newest remaining version. Version numbers are never reused. An artifact
with all its versions goes with `ArtifactFamily.delete()`:

```python
for fam in cairn.Reader().artifact_families("denoise"):
    if fam.name.startswith("scratch-"):
        fam.delete()
```

## Using an artifact

```python
ckpt = run.use_artifact("base-ckpt:best")        # an alias
ckpt = run.use_artifact("base-ckpt:v3")          # a version
ckpt = run.use_artifact("base-ckpt")             # = base-ckpt:latest
data = run.use_artifact("shared/cifar10:normalised", role="dataset")   # another project
model.load_state_dict(ckpt.get())
```

The reference is resolved **now**, and the exact version (not the alias) is recorded as an input of
the run, with a `role` (default `"input"`). Using the same version again records nothing new.
`use_artifact` returns the `ArtifactVersion`; call `.get()` for a logged object or `.download()`
for files. It is not available in
[WAL mode](../getting-started.md#wal-mode-many-writers-on-a-shared-filesystem), which cannot
answer immediately.

## Reading a version: `cairn.ArtifactVersion`

| Member | Meaning |
|---|---|
| `name`, `type`, `project` | The artifact's name and type, and the project id. |
| `version`, `ref`, `qualified_ref` | `3`, `"name:v3"`, `"project/name:v3"`. |
| `aliases`, `tags` | As they were when the version was fetched (`latest` first). |
| `metadata`, `description`, `step`, `created_at` | As logged (or edited). |
| `digest`, `size` | The manifest's SHA-256; the bytes of the uploaded entries (references excluded). |
| `files()` | The entries, as `cairn.ArtifactEntry`: `path`, `size`, `digest`, `uri` (references), `mime`, `object_type`, and `read()`, `open()`, `download(root=None)`. |
| `get_entry(path)` | One entry (`KeyError` when absent). |
| `get(path=None)` | An entry's decoded value: a logged object as it was, a plain file as `bytes`. Without `path` the version must have exactly one entry. |
| `open(path, mode="rb")` | An entry as a file object (`"rb"`, or `"r"` for UTF-8 text). |
| `download(root=None)` | Every entry written under `root`; returns it as a `Path`. |
| `file(path, root=None)` | One entry written under `root`; returns the file's `Path`. |
| `logged_by()` | The run that logged it (a reader `Run`), or None. |
| `used_by(role=None)` | The runs that used this exact version, oldest first. |
| `add_alias`, `remove_alias`, `add_tag`, `remove_tag`, `update`, `delete` | See above. |

`download()` writes to `$CAIRN_ARTIFACT_DIR/<name>-v<N>/`, or `./artifacts/<name>-v<N>/` when the
variable is unset. A file that is already there with the right digest is not fetched again. A
reference is copied when cairn can read its URI (a local path, `file://`, or any scheme
[fsspec](https://filesystem-spec.readthedocs.io/) knows, with fsspec and the scheme's filesystem,
such as `s3fs`, installed); otherwise it is skipped with a warning and stays listed in `files()`.

```python
ds = run.use_artifact("cifar10:normalised")
root = ds.download()                              # ./artifacts/cifar10-v1/
stats = json.load(ds.open("stats.json", "r"))
labels = ds.file("labels.json")                   # Path to the downloaded file
[e.path for e in ds.files() if e.uri]             # ["raw.tar"]
```

## Without a run

`cairn.log_artifact` logs a version that no run produced. It takes the same draft or shorthand,
plus the project and, optionally, the repo:

```python
cairn.log_artifact("model.onnx", "exported", type="model", project="cifar10",
                   aliases=["production"])
```

## WAL mode

In [WAL mode](../getting-started.md#wal-mode-many-writers-on-a-shared-filesystem) the version
number is decided when the repo ingests the log, so `log_artifact` returns a **pending**
`ArtifactVersion`: `version` is None and the read methods raise until it is ingested. Read it back
later with `cairn.Reader().artifact(...)`.

## Lineage

Each version records the run that logged it, and each `use_artifact` records a consuming run.
Together these form a graph of runs and versions, which the UI shows in the
[artifact explorer](../ui/artifacts.md) and the [lineage graph](../ui/lineage.md) (forked runs
are linked to their parent there too).

```python
r = cairn.Reader()
v = r.artifact("base-ckpt:best", project="denoise")
producer = v.logged_by()                    # the run that logged it
producer.config["model"]                    # its nested config
[run.name for run in v.used_by()]           # who used this exact version

run = r.runs("denoise").filter(name="residual").last()
run.used_artifacts()                        # [ArtifactVersion denoise/base-ckpt:v37]
run.used_artifacts(role="dataset")          # only that role
run.logged_artifacts()

r.artifact_versions("base-ckpt", project="denoise")    # v1 .. vN
fam = r.artifact_families("denoise")[0]                # cairn.ArtifactFamily
fam.aliases                                            # {"best": 37, "latest": 50}
r.lineage("denoise")                                   # {"nodes": [...], "edges": [...], "groups": [...]}
```

The graph's nodes are runs (`kind: "run"`, with name, status, tags, group and job type) and
versions (`kind: "artifact_version"`, with ref, type, aliases and tags); edges are `produced`
(run to version), `consumed` (version to run, with the role) and `forked` (run to run). Runs that
used the same inputs, and versions of one name from the same producer, are siblings: they share a
`group_key`, which is how the UI folds 50 runs that used one dataset into one expandable node.

See [Reading data back](reading.md) for the reader.
