# Web UI

The cairn web UI is a single-page app for browsing projects, comparing runs in a workspace, building card dashboards and writing reports. It ships with the Python package; there is nothing else to install.

## Launch the UI

Point `cairn ui` at a local repo:

```bash
cairn ui                                   # serves ./.cairn on http://localhost:4301
cairn ui --repo path/to/.cairn --port 8080
```

| Option | Default | Meaning |
|---|---|---|
| `--repo` | Configured destination, else `./.cairn` | A local repository path or a remote `cairn://HOST:PORT` / `http(s)://` server. |
| `--host` | `127.0.0.1` | Loopback interface: `127.0.0.1`, `localhost` or `::1`. |
| `--port` | `4301` | Port to bind. |
| `--open-browser / --no-open-browser` | on | Open a browser tab after startup. |

A local UI runs on loopback without authentication. Starting it is explicit;
SDK runs and Readers continue to access the local database directly. To expose
a repository on a network, use `cairn server --repo PATH --host 0.0.0.0`. The
server includes the UI by default on the same port (`4300` unless changed).

### Logging in

`cairn server` enables authentication by default. It uses `CAIRN_TOKEN` or a
private token file, creating `<repo>/token` when no credential is configured.
Startup prints a browser login link carrying the same token in a URL fragment.
The browser exchanges it for an HttpOnly cookie and clears it from the address
bar. You can also paste the token into the login form. There is one server
credential, with no separate user roles or one-time passwords. See
[Server and authentication](../guides/server.md).

### Remote servers

`cairn ui --repo cairn://HOST:PORT` serves the UI locally and proxies its API to
the remote server. The proxy binds to loopback only. With a
[resolved token](../reference/configuration.md#the-token), it authenticates for
you; otherwise log in through the browser using the remote server's token.

!!! tip "Prefer `localhost` over a LAN IP"
    Serving the page from loopback keeps it a browser *secure context*. Some browser features, such as copying a run ID or a source reference to the clipboard, only work in a secure context, so they can fail on a plain-HTTP LAN address.

## Layout

The top bar holds the **Cairn** logo (back to the projects list), a **Projects** link and a server status dot (**online**, **offline** or **checking…**). The footer shows the cairn version and server uptime.

### Projects page

The home page lists every project with its last run time, total runs and currently active runs. From here you can:

- **New project**: type a name, press ++enter++ (or ++escape++ to cancel).
- **Import runs**: upload a `.zip` produced by the runs table's **Export** action. Imported runs get new ids. See [Import and export](../guides/import-export.md).

### Inside a project

Projects open on Reports. Every project page has a left navigation bar
(a bottom bar on phones):

| Page | Path | What it is |
|---|---|---|
| Runs | `/p/<project>/runs` | The [runs table](runs-table.md). |
| Workspace | `/p/<project>/workspace` | [Project workspace](project-workspace.md): the current view bound to the runs its sidebar picks. |
| Sweeps | `/p/<project>/sweeps` | Sweeps and their trials ([Sweeps](../guides/sweeps.md)). |
| Artifacts | `/p/<project>/artifacts` | The [artifact explorer](artifacts.md): artifacts, versions, files, usage snippets. |
| Lineage | `/p/<project>/lineage` | The [lineage graph](lineage.md) of runs and the artifact versions they produce and consume. |
| Reports | `/p/<project>/reports` | Notebook-style [reports](reports.md). |
| Defaults | `/p/<project>/defaults` | Card defaults for the workspace and per section ([Run page and workspace](workspace.md)). |

A breadcrumb (`Projects › <project> › <run>`) sits above the content; on a run page it has a button that copies the run id. At its right is the alert bell: it counts alerts you have not seen since you last opened it, and lists the newest ones with links to their runs.

### Run page

Click a run's name to open `/p/<project>/r/<run id>`. The run page has seven tabs, and opens on **Workspace** (as wandb's):

| Tab | Contents |
|---|---|
| Workspace | `/p/<project>/r/<run id>`: the run's card workspace without its `system.*` series; cards with no data for the run are hidden ([Run page and workspace](workspace.md), [Cards](cards.md)). |
| Overview | `…/overview`: the Run block (notes, tags, state, group, job type, version, times, author, host, git, command, run path), the config and summary tables with a search each, the run's artifacts ([Overview](workspace.md#overview)). |
| Records | Structured log entries, with filters and selectable fields. |
| System | The same workspace over the run's `system.*` series. |
| Logs | Captured console output, filterable by stream. |
| Files | The captured source files, then the environment and `pip freeze`. |
| Artifacts | The artifact versions the run logged and used, and its [lineage graph](lineage.md) ([A run's artifacts](artifacts.md#a-runs-artifacts)). |

A running run shows a **Stop** button, which asks the run to stop ([Run lifecycle](../guides/runs.md)). A forked run links to its parent. A run opened from the [project workspace](project-workspace.md)'s runs sidebar has a **← Workspace** link back to it.

## Live updates

While a run is running, the UI polls the server for its new points and appends them to the series already on screen. Only series some visible card shows are updated; finished runs are not polled.

## Where settings are kept

| Setting | Stored |
|---|---|
| Workspace views and the current view: sections, panels, card settings, defaults, colour-by, the project workspace's runs | Server-side, per project ([Run page and workspace](workspace.md)). |
| Runs table view: filter, sort, group-by, columns, computed columns | Your browser (`localStorage`), per project. |
| Project run view: hidden, pinned and baseline runs | Your browser (`localStorage`), per project. |

Browser-stored settings do not follow you to another browser or machine.

## Theme

The UI has a single light theme; there is no dark mode. Charts take their colours from the same theme tokens. When printing (reports' **Export PDF**), the app chrome is hidden and pages print on white.

## Phones and tablets

The UI adapts to narrow screens (below 768 px) and to touch input:

- **Navigation**: the top bar collapses into a menu button; project navigation moves to a bottom bar.
- **Runs table**: rows become a list of run cards. The selection bar keeps **Clear**, **Tag** and **Show in workspace** and moves the other actions into **More**.
- **Card grid**: one column, no resize handles; a card's fixed height is capped at 75% of the viewport.
- **Card headers**: the camera, settings and **⋯** actions use the shared card header. Secondary actions appear in **⋯**. On touch devices it also offers **Move up** / **Move down** instead of drag-to-reorder.
- **Tap to interact**: on touch devices, charts, image panes and 3D views start non-interactive, so a one-finger drag scrolls the page. Use **Interact with content** in the card's **⋯** menu to pan and zoom the content; switch it off to return to scrolling. In full screen the content is always interactive.
- **Charts on touch**: drag to zoom, tap for the tooltip, double-tap to reset.
- **Overlays**: popovers open as bottom sheets and dialogs go full screen on small viewports (including a phone in landscape).
- **Hover controls**: controls that a mouse reveals on hover (row toggles, the column menu button, tag remove buttons) are always visible on touch devices, with larger touch targets.

## Next steps

- [Runs table](runs-table.md): filter, sort and group runs, and show them in the workspace.
- [Project workspace](project-workspace.md): many runs, grouped, in one set of cards.
- [Run page and workspace](workspace.md): arrange cards and set defaults.
- [Artifact explorer](artifacts.md) and [lineage graph](lineage.md).
- [Keyboard shortcuts](shortcuts.md).
