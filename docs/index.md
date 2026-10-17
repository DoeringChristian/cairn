# Cairn

Cairn records experiments and turns their evidence into versioned Markdown and
Python reports. Reports are the main project interface; runs, observations,
media and artifact versions remain available for investigation.

## Record an experiment

```python
import cairn

with cairn.init(project="study", repo="./.cairn", config={"lr": 0.1}) as run:
    for loss in [1.0, 0.6, 0.3]:
        cairn.log({"loss": loss})
    run.summary["conclusion"] = "converged"
```

Each run has one destination. A filesystem path opens SQLite and files directly,
without starting a server. A server URL sends durable batches over HTTP; its client
buffer is not a second queryable repository. The same SDK and Reader work with
either destination. See [Getting started](getting-started.md) and
[Storage architecture and evolution](guides/storage-architecture.md).

## Write and publish reports

Open the UI explicitly:

```bash
cairn ui --repo ./.cairn
```

Choose **New report** in a project and start writing. Markdown, Python and card
cells autosave as a draft. **Read/Edit** changes the editing mode; **Publish** builds
and adds an immutable report version. The header shows draft save status and
publication progress. Published versions preserve their source and captured evidence.

Reports can also be authored as `reports/<slug>/report.qmd`:

```bash
cairn report new study
cairn report publish study --project study
```

See [Reports](ui/reports.md) for editing, execution, version history and source
references, and [Report blocks](reference/report-blocks.md) for embedded cards.

## Serve a repository

```bash
cairn server --repo /srv/cairn --host 0.0.0.0
```

The server and UI share one port and one token. The server creates a private token
file when no credential is configured. Clients can use a copied token file or
`cairn login URL`; browsers use the same credential. Local database access needs no
token. See [Server and authentication](guides/server.md).

## Documentation

- [Getting started](getting-started.md): install Cairn, log a run and publish a report.
- [Guides](guides/index.md): logging, media, artifacts, queries, sweeps and delivery.
- [Web UI](ui/index.md): reports, project cards, workspaces and run inspection.
- [Reference](reference/index.md): the Python API, CLI, configuration and expressions.
- [Examples](examples.md): integrations and complete experiment workflows.
- [Storage architecture and evolution](guides/storage-architecture.md): local and
  server storage, supported schema upgrades, repository moves and backups.
