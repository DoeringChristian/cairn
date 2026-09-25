# CLI reference

The `cairn` command is installed with `cairn-track`. Run `cairn --help`, or
`cairn COMMAND --help`, for the same information in your terminal.

| Command | Purpose | Guide |
|---|---|---|
| `cairn init` | Create a local repo | [Getting started](../getting-started.md) |
| `cairn ui` | Serve the web UI over a local repo, or proxy a remote server | [Server](../guides/server.md) |
| `cairn server` | Run the tracking server (optionally with the UI) | [Server](../guides/server.md) |
| `cairn token create\|list\|revoke` | Manage auth tokens on the server host | [Server](../guides/server.md#tokens-and-roles) |
| `cairn login --ssh` | Get a token with an SSH key | [Server](../guides/server.md#logging-in-with-an-ssh-key) |
| `cairn configure` | Save the server URL to the config file | [Configuration](configuration.md) |
| `cairn ping`, `list`, `open`, `rm` | Talk to a running server | [Server](../guides/server.md#other-client-commands) |
| `cairn sync` | Replay run logs that never reached their server | [Server](../guides/server.md#server-mode-and-connection-loss) |
| `cairn export` | Write a run's or a project's metrics to JSON, CSV or Parquet | [Import and export](../guides/import-export.md#exporting-metrics) |
| `cairn import-tb` | Import TensorBoard event files | [Integrations](../guides/integrations.md#importing-tensorboard-logs) |
| `cairn diff` | Diff the working directory against a run's source snapshot | [Run lifecycle](../guides/runs.md) |
| `cairn sweep create\|ls\|pause\|resume\|cancel` | Manage sweeps | [Sweeps](../guides/sweeps.md) |
| `cairn agent` | Run a sweep's trials | [Sweeps](../guides/sweeps.md#quick-start-from-the-command-line) |

Commands that take `--repo` accept a local `.cairn/` path or a
`cairn://host:port` URL. The client commands `ping`, `list`, `open`, `rm`,
`export` and `sync` always talk to a server; see
[Configuration](configuration.md#which-server-the-cli-talks-to) for how they
find it.

## Commands

::: mkdocs-click
    :module: cairn.cli
    :command: main
    :prog_name: cairn
    :depth: 1
    :style: table
    :list_subcommands: true
