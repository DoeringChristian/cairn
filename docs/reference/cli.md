# CLI reference

The `cairn` command is installed with `cairn-track`. Run `cairn --help`, or
`cairn COMMAND --help`, for the same information in your terminal.

| Command | Purpose | Guide |
|---|---|---|
| `cairn init` | Create a local repo | [Getting started](../getting-started.md) |
| `cairn ui` | Serve the web UI over a local repo, or proxy a remote server | [Server](../guides/server.md) |
| `cairn server` | Run the tracking server (optionally with the UI) | [Server](../guides/server.md) |
| `cairn token create\|list\|revoke` | Manage auth tokens on the server host | [Server](../guides/server.md#tokens-and-roles) |
| `cairn login [URL]`, `cairn logout [URL]` | Save or forget a server's token (`--ssh`: get one with an SSH key; `--list`: show saved logins) | [Server](../guides/server.md#logging-in-from-the-sdk-and-cli) |
| `cairn configure` | Save the default server or repo to the config file | [Configuration](configuration.md) |
| `cairn list` | List runs (with their [version](../guides/runs.md#versions)) with filters, sorting, config and metric columns, as a table, JSON or CSV | [Server](../guides/server.md#listing-runs) |
| `cairn ping`, `open` | Check a server or a local repo; open a run in the viewer | [Server](../guides/server.md#client-commands) |
| `cairn rm`, `archive`, `unarchive` | Delete, archive or unarchive runs | [Server](../guides/server.md#client-commands) |
| `cairn sync` | Replay run logs that never reached their server, or a local repo's WAL logs | [Server](../guides/server.md#server-mode-and-connection-loss) |
| `cairn export` | Write a run's or a project's metrics to JSON, CSV or Parquet | [Import and export](../guides/import-export.md#exporting-metrics) |
| `cairn export-runs`, `import-runs` | Move whole runs between repos as run archives (ZIP) | [Import and export](../guides/import-export.md#run-archives) |
| `cairn import-tb` | Import TensorBoard event files | [Integrations](../guides/integrations.md#importing-tensorboard-logs) |
| `cairn artifact ls\|versions\|get\|alias\|tag\|rm\|lineage` | Browse, download and curate the artifact registry | [Artifacts](../guides/artifacts.md#from-the-command-line) |
| `cairn report ls\|show\|export\|rm\|share\|shares\|unshare` | Read, export, delete and share reports | [Reports](../ui/reports.md#from-the-command-line) |
| `cairn diff` | Diff the working directory against a run's source snapshot | [Run lifecycle](../guides/runs.md) |
| `cairn sweep create\|ls\|pause\|resume\|stop\|cancel` | Manage sweeps | [Sweeps](../guides/sweeps.md) |
| `cairn agent` | Run a sweep's trials | [Sweeps](../guides/sweeps.md#quick-start-from-the-command-line) |
| `cairn viewer init\|add\|dev\|publish\|ls` | Start a custom viewer, vendor libraries into it, develop it live, publish and list viewers | [Custom viewers](../guides/custom-viewers.md#commands) |

Every command that reads or changes data takes `--repo` (a local `.cairn/`
path, or a `cairn://host:port` / `http(s)://` URL) and `--server URL`, and
works on a local repo without a server as well as on a server. Without
either option the target is `CAIRN_REPO` or `CAIRN_SERVER`, then the config
file, then `./.cairn`; see
[Configuration](configuration.md#resolution-order). `cairn list`
(`table|json|csv`), `artifact ls|versions` and `report ls|shares`
(`table|json`), and `artifact lineage` (`tree|json`) take `--format`;
`sweep ls` and `viewer ls` print a table only. A failure prints one line,
`Error: ...`, and exits 1.

## Commands

::: mkdocs-click
    :module: cairn.cli
    :command: main
    :prog_name: cairn
    :depth: 1
    :style: table
    :list_subcommands: true
