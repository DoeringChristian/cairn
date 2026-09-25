# Web UI

The cairn web UI is a single-page app for browsing projects, comparing runs, building card dashboards and writing reports. It ships with the Python package; there is nothing else to install.

## Launch the UI

Point `cairn ui` at a local repo:

```bash
cairn ui                                   # serves ./.cairn on http://localhost:4301
cairn ui --repo path/to/.cairn --port 8080
```

| Option | Default | Meaning |
|---|---|---|
| `--repo` | `./.cairn` | Local `.cairn/` directory, or a remote `cairn://HOST:PORT` / `http(s)://` server. |
| `--host` | `127.0.0.1` | Interface to bind. |
| `--port` | `4301` | Port. If it is taken, the next free port above it is used. |
| `--open-browser / --no-open-browser` | on | Open a browser tab after startup. |
| `--no-auth` | off | Disable authentication (local repos only). |
| `--verbose` | off | Show the HTTP server's info and access logs. |
| `--alert-webhook URL` | none | Post alerts to an ntfy topic, a Slack or Discord webhook, or any JSON webhook (local repos only; env `CAIRN_ALERT_WEBHOOK`). |

To run an ingest server and the UI together, use `cairn server --ui`; the UI then listens on the ingest port + 1 (`--ui-port` overrides it). If a `cairn server` already holds the repo, `cairn ui` refuses to start: open the server's UI URL instead.

### Logging in

Authentication is on by default. On startup `cairn ui` prints:

- a reusable access token, stored in `<repo>/auth/local.token`;
- a one-time browser login link (`/login?otp=…`), single-use and valid for 15 minutes. With `--open-browser`, this is the link that opens.

If the link has expired, open the UI and paste a token into the login form (a token from `cairn token create` works too). The footer shows your name and role, with a **Log out** link. Tokens, roles and deployment are covered in [Server, auth and deployment](../guides/server.md).

### Remote servers

`cairn ui --repo cairn://HOST:PORT` serves the UI locally and proxies its API to the remote server. The proxy binds to loopback only, and `--no-auth` is not accepted. Set `CAIRN_TOKEN` to let the proxy authenticate for you; without it you log in in the browser.

!!! tip "Prefer `localhost` over a LAN IP"
    Serving the page from loopback keeps it a browser *secure context*. Some browser features, such as copying a run id or a share link to the clipboard, only work in a secure context, so they can fail on a plain-HTTP LAN address.

## Layout

The top bar holds the **Cairn** logo (back to the projects list), a **Projects** link and a server status dot (**online**, **offline** or **checking…**). The footer shows the cairn version and server uptime.

### Projects page

The home page lists every project with its last run time, total runs and currently active runs. From here you can:

- **New project**: type a name, press ++enter++ (or ++escape++ to cancel).
- **Import runs**: upload a `.zip` produced by the runs table's **Export** action or by `cairn export`. Imported runs get new ids. See [Import and export](../guides/import-export.md).

### Inside a project

Every project page has a left navigation bar (a bottom bar on phones):

| Page | Path | What it is |
|---|---|---|
| Runs | `/p/<project>` | The [runs table](runs-table.md). |
| Compare | `/p/<project>/compare` | [Comparisons](comparisons.md): card dashboards over a set of runs. |
| Sweeps | `/p/<project>/sweeps` | Sweeps and their trials ([Sweeps](../guides/sweeps.md)). |
| Artifacts | `/p/<project>/artifacts` | The artifact registry, filterable by type ([Artifacts and lineage](../guides/artifacts.md)). |
| Lineage | `/p/<project>/lineage` | The graph of runs and the artifacts they produce and consume. |
| Reports | `/p/<project>/reports` | Notebook-style [reports](reports.md). |
| Defaults | `/p/<project>/defaults` | Card defaults for the workspace and per section ([Run page and workspace](workspace.md)). |

A breadcrumb (`Projects › <project> › <run>`) sits above the content; on a run page it has a button that copies the run id. At its right is the alert bell: it counts alerts you have not seen since you last opened it, and lists the newest ones with links to their runs.

### Run page

Click a run's name to open `/p/<project>/r/<run id>`. The run page has five tabs:

| Tab | Contents |
|---|---|
| Overview | Details, git, tags and notes, CLI args, environment snapshot, the run's artifacts. |
| Metrics & Media | The run's card workspace ([Run page and workspace](workspace.md), [Cards](cards.md)). |
| Logs | Captured console output, filterable by stream. |
| Source | The captured source files. |
| Environment | The captured environment, including `pip freeze`. |

A running run shows a **Stop** button, which asks the run to stop ([Run lifecycle](../guides/runs.md)). A forked run links to its parent.

## Live updates

While a run is running, the UI polls the server for its new points and appends them to the series already on screen. Only series some visible card shows are updated; finished runs are not polled.

## Where settings are kept

| Setting | Stored |
|---|---|
| Card workspace: sections, layouts, defaults, colour-by, saved views | Server-side, per project ([Run page and workspace](workspace.md)). |
| Runs table view: filter, sort, group-by, columns, computed columns | Your browser (`localStorage`), per project. |
| Project run view: hidden, pinned and baseline runs | Your browser (`localStorage`), per project. |

Browser-stored settings do not follow you to another browser or machine.

## Theme

The UI has a single light theme; there is no dark mode. Charts take their colours from the same theme tokens. When printing (reports' **Export PDF**), the app chrome is hidden and pages print on white.

## Phones and tablets

The UI adapts to narrow screens (below 768 px) and to touch input:

- **Navigation**: the top bar collapses into a menu button; project navigation moves to a bottom bar.
- **Runs table**: rows become a list of run cards. The selection bar keeps **Clear**, **Tag** and **Compare** and moves the other actions into **More**.
- **Card grid**: one column, no resize handles; a card's fixed height is capped at 75% of the viewport.
- **Card headers**: on narrow screens Reset view, Save, Screenshot, Settings and Remove card move into the card's menu. On touch devices the menu also offers **Move up** / **Move down** instead of drag-to-reorder.
- **Tap to interact**: on touch devices, charts, image panes and 3D views start non-interactive, so a one-finger drag scrolls the page. Tap the hand button in the card header to pan and zoom the content; tap it again to go back to scrolling. In full screen the content is always interactive.
- **Charts on touch**: drag to zoom, tap for the tooltip, double-tap to reset.
- **Overlays**: popovers open as bottom sheets and dialogs go full screen on small viewports (including a phone in landscape).
- **Hover controls**: controls that a mouse reveals on hover (row toggles, the column menu button, tag remove buttons) are always visible on touch devices, with larger touch targets.

## Next steps

- [Runs table](runs-table.md): filter, sort, group and compare runs.
- [Run page and workspace](workspace.md): arrange cards and set defaults.
- [Keyboard shortcuts](shortcuts.md).
