# Organising runs

A project holds many runs: seeds, folds, re-runs, the preparation, training and evaluation
steps of one experiment. cairn organises them as wandb does, with a free **name**, a **group**
and a **job type**, and adds one extra: a **version** that tells re-runs of the same thing
apart. This page explains the four fields and how the runs table, the workspace and reports use
them.

## Identity: id, name, group, job type, version

A run has one identity and three labels:

| Field | What it is |
|---|---|
| **id** | The run itself: 32 hex characters, random unless you pass `run_id=`. URLs, `resume=`, `fork_from=` and `uses=` name runs by id. |
| **name** | A free display label (`name=`); it need not be unique and can be edited. |
| **group** | Runs that belong together: the seeds of one configuration, the folds of a cross-validation, the steps of one experiment (`group="exp-44"`). The workspace aggregates a group into one line, and clicking a group filters to it. |
| **job type** | The run's role within its group: `"prepare"`, `"train"`, `"eval"`, `"finetune"`, … The runs table and the workspace group by it below the group (group → job type), and the lineage graph labels and clusters runs by it. |
| **version** | Deduplication: the run's number among the runs with the same group, job type *and* name (below). |

```python
cairn.Run("mnist", group="exp-44", job_type="prepare", name="prepare")
cairn.Run("mnist", group="exp-44", job_type="train", name="train")
cairn.Run("mnist", group="exp-44", job_type="finetune", name="ft-lr1e-4")   # v1
cairn.Run("mnist", group="exp-44", job_type="finetune", name="ft-lr1e-5")   # v1: another name
cairn.Run("mnist", group="exp-44", job_type="finetune", name="ft-lr1e-4")   # v2: a re-run
```

The group and job type show on the run page (the Overview's Run block, and the group as a link
in the header), in the runs table's **Group** and **Job Type** columns (shown when a listed run
has one) and in `cairn list` (`GROUP` and `JOB_TYPE` columns). Filters, [expressions](../reference/expressions.md)
(`run.group`, `run.job_type`) and [`Reader`](reading.md) runs see them too.

## Versions

Runs with the same **group, job type and name** form a **series**; a missing
group or job type is part of the key, so `train` without a group, `train` in
group `exp-44`, and `train` as job type `eval` in `exp-44` are three series.
The server numbers every named run in its series when it creates the run: the
first is version 1, a re-run with the same identity version 2, and so on.
The number is the run's `version` field; it is never written into the name,
and the client never chooses it. Runs with different names never share a
series, so unique names never get a v2.

```python
run = cairn.Run("mnist", name="train")
run.version   # 3: the third ungrouped "train" without a job type
```

- **Never reused.** Each series keeps its highest number, so deleting `train`
  v3 does not make the next `train` v3 again: it is v4.
- **A new name, group or job type: a new number.** A run whose name, group or
  job type changes (a rename, or a `PATCH /api/runs/{id}` of `group` or
  `job_type`) takes the next number of its new series; its old number stays
  taken in the old one (changing back gives yet another new number).
- **Resume and shared runs keep it.** `resume=`, `rewind_to=`, and processes
  joining a run (`primary=False`, `cairn.attach`) continue the same run, with
  the same version.
- **A fork is a new run**, so it takes the next number of its series.
- **No name, no version**: an unnamed run's `version` is `None`.
- **Imported runs** ([run archives](import-export.md#run-archives)) take the
  next number of their series in the repo they are imported into; the number
  they had where they were exported is not kept.

Over HTTP the server returns the version when the run is created. On a local
repo the number is assigned when the run's log is ingested: the first read of
`run.version` catches up on the repo's logs (like `ArtifactVersion.wait()`),
and it is known from then on. Repos numbered before the job type was part of
the key are renumbered once, per series in creation order, when a newer cairn
first opens them.

The UI shows the version as a muted `v2` after a run's name, and labels runs
that share a series `train v1`, `train v2` in charts and legends. Where it
needs more, it shows what differs: the group first (`exp-44 · train v1` when
the runs span groups), then the job type (`finetune · ft` next to
`eval · ft`). `cairn list` has a `VERSION` column and `--sort version`; the
[Reader](reading.md) has `Run.version`.

## Latest versions only, Show latest only, Archive old, Delete old

The newest run of a series is its highest version, else its latest start. Two controls in
the [runs table](../ui/runs-table.md) and the
[project workspace](../ui/project-workspace.md)'s sidebar use it:

- **Latest versions only** in the **Filter** popover lists only the newest run of every
  series. It shows as the chip `latest versions only ×`. The older runs are not listed, and
  they are not deleted.
- **Show latest only** in the header eye's **▾** menu shows the newest run of every series and
  hides the older ones. They stay listed, dimmed, and the cards do not draw them. It acts once,
  and you can still click a run's eye to show that run.

**Archive old** / **Delete old** on the runs table archive or delete every run but the newest
of each series (both ask first). In the runs table the newest run of a series with several runs
has an accent bar on its left edge.

## Grouping in the UI

The runs table and the workspace's runs sidebar group runs with **Group** (both start ungrouped, one
line per run, as wandb's default workspace). **group, then job type** gives wandb's
nested grouping:

```
◉  NAME  15 listed
◉  ○ ▾ Group: exp-44        3  5
     ◉ ● ▾ Job Type: train      2
         ◉ eager-sun v2
         ◉ eager-sun v1
     ◉ ● ▸ Job Type: eval       1
     ◉ ● ▸ Job Type: prepare    2
◉  ○ ▸ Group: seeds-lr3e-4  1  3
◉  ○ ▸ Group: (none)        2  2
```

- Group rows read `Field: value`. An outer group shows a hollow circle, its sub-group count and
  its run count; an innermost group a filled dot in the colour of its chart line.
- Runs without a value are never averaged: a `(none)` group, at any level, has a hollow dot,
  and each run under it keeps its own dot and is its own line, row or column in the cards.
- In the [project workspace](../ui/project-workspace.md), a line chart draws **one line per
  innermost group**: the mean over its runs with a min–max band, labelled with its path,
  `group: exp-44, jobType: train`. The Summary section's Scalars and Config cards have a row or
  column per innermost group. Not grouped, every run is its own line.
- Grouping by a tag, a config value or an expression works the same way; see
  [Group by](../ui/runs-table.md#group-by).

There are no group pages: **clicking a group's name filters the workspace in place** to that
group (a removable `group = exp-44` chip in its filter). The group's name in the runs table,
the run page header and the lineage panel opens the workspace filtered the same way. See
[Filtering to a group](../ui/project-workspace.md#filtering-to-a-group).

To look at a hand-picked set of runs, select them in the runs table and click **Show in
workspace**: the workspace opens with exactly those runs visible.

## Which runs a run used

A run's inputs are part of how runs relate: the artifact versions it used
(`run.use_artifact`), including another project's (`"other-project/name:alias"`), and the runs
it used directly (`cairn.Run(..., uses=[...])`, `run.use_run`). They form the
[lineage graph](../ui/lineage.md), and the run page's Overview lists them as **Inputs ←** and
**Used by →**. See [Artifacts and lineage](artifacts.md#lineage).
