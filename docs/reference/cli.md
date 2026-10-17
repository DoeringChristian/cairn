# Command line

Use `cairn COMMAND --help` for exact options. A destination is a local repo path
or a remote URL; local commands never start a tracking server.

| Command | Purpose |
|---|---|
| `init [PATH]` | Create a local repo |
| `runs`, `show RUN_ID` | Read tracked runs as JSON |
| `build`, `serve` | Build or preview executable Markdown reports |
| `report new SLUG` | Create a report source |
| `report build`, `report publish SLUG` | Build reports and publish a captured site |
| `report ls`, `report export SLUG --out FILE` | List publications or export HTML |
| `ui` | Explicitly serve the local UI or proxy a remote server |
| `server` | Explicitly serve a repo, with one configured token |
| `login URL`, `logout URL` | Save or forget that server token |
| `sync [PATHS]` | Deliver durable buffered records |
| `artifact ...` | Browse and curate tracker artifact versions |
| `viewer ...` | Develop custom media viewers |

Older administration, multi-token, report-sharing, and sweep CLI commands have been
removed. The Python tracker, query, artifact, and sweep APIs remain available.

::: mkdocs-click
    :module: cairn.cli
    :command: main
    :prog_name: cairn
    :depth: 1
    :style: table
    :list_subcommands: true
