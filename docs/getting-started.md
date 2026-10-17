# Cairn

Cairn records experiments and turns their evidence into executable Markdown reports.
Reports are the main project interface; runs, metrics, media, and versioned artifacts
remain available for investigation.

This repository continues the **cairn-track** implementation with one backend for
local and remote use, immutable report publications, and an integrated notebook
editor. The Python distribution remains `cairn-track`; import it as `cairn`.

## One destination

Choose a local repository **or** a remote tracking server:

```python
import cairn

# Direct SQLite + files. No tracking server or uploader process starts.
run = cairn.Run("study", repo="./.cairn", name="baseline")

# Or: HTTP to a remote server. No local tracking database is created.
run = cairn.Run("study", repo="https://cairn.example.org", name="baseline")
```

Local processes open the same SQLite database in WAL mode. Each run keeps a durable
journal in that repo and applies batches directly to the database. SQLite transactions
serialize concurrent writers. Reader, edits, sweeps, and artifact operations also use
the direct backend. A Reader recovers unapplied local journal records after a crash.

Remote runs write a durable upload buffer and send bounded batches to their server.
The detached uploader survives the training process, retries outages, and acknowledges
records only after the server commits them. Repeated delivery does not insert duplicate
records. `cairn sync` retries buffered runs explicitly. The buffer is not a second repo:
it has no tracking database or server-state reconciliation.

Local run journals live at `<repo>/runs/<id>/`; remote buffers use
`$CAIRN_DIR/runs/<id>/` (default `./.cairn/runs/<id>/`). Records reach the OS before
logging returns; fsync and database application are grouped, normally every 100 ms.
Finishing a local run flushes and commits its records. Sudden power loss can lose the
last unflushed interval. Use a local disk for SQLite; cluster jobs should target a server.

Select the destination explicitly with `repo=`, or through `cairn.configure(repo=...)`,
`CAIRN_REPO`, or the client config file. There is no automatic local/remote fallback.

## Install

Install the release with report support:

```bash
pip install 'cairn-track[reports,ui] @ git+https://github.com/DoeringChristian/cairn@v0.7.0'
```

From a source checkout:

```bash
uv pip install -e '.[reports,ui]'
```

`reports` installs the Markdown, mathematics, Matplotlib, and Plotly rendering tools.
`ui` adds the Python notebook-card package. Release wheels also include the matching
browser bundle. To rebuild that bundle from this checkout:

```bash
cd vendor/cairn-ui
npm ci
npm run build
```

## Record an experiment

```python
import cairn

run = cairn.init(project="study", name="baseline", config={"lr": 0.1})
cairn.define_metric("loss", summary="min")
for loss in [1.0, 0.6, 0.3]:
    cairn.log({"loss": loss})
run.summary["conclusion"] = "converged"
cairn.finish()

print(run.id)
```

`cairn.init()` defaults the project to `CAIRN_PROJECT` or the current directory's
name. It returns the same run exposed as `cairn.run`. Calling `init()` with an active
default run raises; finish it first. Logging before initialization also raises.
`cairn.finish()` is harmless if there is no active run.

All operations also work on the run itself:

```python
with cairn.init(project="study", config={"lr": 0.1}) as run:
    run.config.update({"epochs": 10})
    run.log({"loss": 0.3, "accuracy": 0.9})
    run.summary["best_accuracy"] = 0.9
```

Each `log` call appends one complete entry. `step` is an optional field, not a
uniqueness constraint: repeated and decreasing steps are retained. Without a step,
plots use observation order. Nested JSON, strings, booleans, arrays, and typed
media remain queryable without flattening the original entry.

```python
cairn.log({"loss": 0.3, "step": 12, "validation": {"split": "test"}})
cairn.log({"loss": 0.2})
cairn.track(cairn.Image(image), {"split": "validation", "epoch": 4})
```

`track(value, metadata)` stores the value under `value` and preserves metadata as
ordinary fields. Named component logging with `run.track(value, name, step)` is
also available. `commit=False` explicitly accumulates fields until the next
committed call or `finish()`; these uncommitted fields stay in memory.

The run's **Records** tab browses entries, filters arbitrary fields, and plots any
numeric x/y pair. Python provides `run.records(where={"validation.split": "test"})`
and `run.record_series("loss", x="step")` on a Reader run. JSON Pointer paths such
as `/validation/split` avoid ambiguity for keys containing dots or slashes.

`cairn.log_artifact(...)`, `cairn.use_artifact(...)`, and `cairn.define_metric(...)`
use the default run. Artifact publication with an explicit `project=` still works
without a run. Independent `cairn.Run(...)` objects do not change the default run;
use `capture_stdout=False` on additional simultaneous runs.

This follows W&B's common workflow, not its entire API. Cairn retains its media
wrappers, exact-name metric rules, and local/remote destination model. Config updates
retain Cairn's deep merge behavior. Config and summary support `.update(...)`,
`[key] = value`, and the existing callable syntax; nested reads return copies, so
write nested changes back explicitly. Summary contains explicit results; automatic
metric aggregates are available through `Reader.Run.final`. Read results with
`cairn.Reader(repo)`.

## Write a report

```bash
cairn report new fit --run FULL_RUN_ID
```

Edit `reports/fit/report.md`:

````markdown
---
title: Fit quality
inputs:
  fit: "run:FULL_RUN_ID"
---

```python exec hide
loss = read_scalars(inputs.fit)["loss"]
```

The final loss is {{ loss }}.
````

Reports support executable Python fences, figures, Plotly, tables, mathematics,
callouts, inline expressions, and checked `report:<slug>` links. Python can execute
on the author's machine or on the selected server. Choose **New report** in the UI
to start writing immediately; Markdown and Python cells autosave to a draft.
**Publish** builds a new immutable version. The Read/Edit toggle saves the draft
without publishing it.

Inputs are finished runs (`run:<full-id>`) or existing tracker artifact versions
(`artifact:<project>/<name>:vN`; aliases resolve at build time). Each build captures
input files and records their content digest in its manifest. Publication stores the
rendered site and the selected report's captured evidence as an immutable artifact
version. Later run edits or alias changes do not modify that publication.

```bash
cairn build                           # build all reports
cairn serve                           # build and preview on localhost:8000
cairn report publish fit --project study
cairn ui                              # explicitly start the reports UI
cairn report export fit --out fit.html
```

A complete example is in [examples/reports-first](https://github.com/DoeringChristian/cairn/blob/main/examples/reports-first/README.md).
Reports use Markdown/QMD source and capture their cards, sources and evidence.

## Serve remotely

```bash
CAIRN_TOKEN=your-secret cairn server --repo /srv/cairn --host 0.0.0.0
```

The server uses one token. SDK requests carry it as a bearer header; browser login
stores that same token in an HttpOnly cookie. There are no roles, token creation
commands, OTPs, SSH login, or restricted share links. Change the configured token and
restart the server to revoke the old credential. Local database access needs no token.

On clients, set `CAIRN_TOKEN` or run `cairn login https://your-server` to save the
existing token for that URL. `cairn ui --repo https://your-server` can serve the viewer
locally while proxying requests to the remote; it creates no tracking repo.
Use `--no-auth` explicitly for an unauthenticated server.

## Breaking changes from 0.6

- Filesystem targets open the database directly, even while a UI is running.
- No tracking server is spawned automatically; `server --daemon` is removed.
- Local journals belong to their repository; `CAIRN_DIR` controls remote buffering.
- One configured server token replaces database-backed credentials and share links.
- Project landing pages show reports; the runs table is at `/p/<project>/runs`.
- The CLI centers on reports, runs, artifacts, explicit serving, and buffered delivery.
  Older CLI administration and sweep commands are removed; the Python sweep API remains.

Current development schemas 7–10 upgrade transactionally to schema 11. Unsupported
older schemas are refused unchanged; there is no automatic import from the previous
artifact-store implementation, preserved separately as `cairn-report`.

A complete local SQLite/files repository can move to a server without changing its
storage backend. Stop writers, copy the whole repository, start the server on that
copy, and point clients at its URL. Run ZIP export is not a complete migration. See
[Storage architecture and migration](guides/storage-architecture.md).
