# Sharing

There are two ways to let someone see your results:

- **Give them a token.** They log in and use the whole UI, within the limits of the token's role.
- **Send a share link.** They see one report, read-only, with no account.

Both depend on authentication, which is on by default. See [Server, auth and deployment](../guides/server.md).

## Roles

Every token has a role. Share links add a fourth, restricted kind of access.

| Access | Can |
| --- | --- |
| `read` | View everything in the UI. Reports open in view mode: cards can be explored, but nothing is saved. There is no commenting or sharing. |
| `write` | Everything `read` can, plus edit reports, comparisons and workspaces, comment, and create or revoke share links. |
| `admin` | Everything `write` can, plus edit or delete anyone's report comments. |
| share link | View one report and its runs. See below. |

Create tokens with `cairn token create --name NAME --role read|write|admin [--expires 30d]` (see [CLI](../reference/cli.md)).

## Share links

A share link is a secret URL, `/share/<secret>`, that opens one report read-only. It needs no token or login.

### Create a link

1. Open the report and click **Share**. You need the write role.
2. Under **Expires after**, pick 1 day, 7 days, 30 days (the default), 90 days or 1 year.
3. Click **Create link** and copy the URL.

!!! warning "The link is shown once"
    The server stores only a hash of the secret, so it cannot show the link again once you close the dialog. If you lose it, create a new link and revoke the old one.

The **Links** list in the same dialog shows each of the report's links:

- its status: **active**, **expired** or **revoked**,
- who created it and when,
- when it expires or expired.

### Revoke a link

Click **Revoke** next to an active link. Every browser that opened the link loses access immediately. An expired link stops working in the same way. Neither can be reactivated: create a new link instead.

### Not available with `--no-auth`

When the server runs with `--no-auth`, the dialog explains that anyone who can reach the server can already read the report. Creating a link is refused (HTTP 400).

## What a viewer sees

When someone opens a link, the browser swaps the secret for an HttpOnly `cairn_share` cookie that lasts until the link expires. The address then changes to `/s/<report-id>`, so the secret does not stay in the address bar or browser history. A client gets at most 10 attempts per minute at redeeming a link.

The viewer gets the report without the rest of the app: a title, *Shared report · view only*, and the report's cells.

Viewers **can**:

- read the markdown and use the table of contents,
- collapse sections (remembered in their browser),
- explore cards: zoom, pan, step sliders, card settings, and hiding, pinning or choosing a baseline run.

Card changes last only for that session and are never saved.

Viewers **cannot**:

- edit, comment, or add cards to comparisons or reports,
- open any page other than the report,
- read runs outside the report's scope.

A selector cell appears as a fixed set of the runs it matched when the page loaded.

## Which runs a link exposes

A share link gives access to the report's own runs and nothing else. The server works these out from the report's current source. A run is in scope if it is named in a ```` ```cairn ```` fence ([Report blocks](../reference/report-blocks.md)) in any of these ways:

- listed in `runs.ids`,
- matched by a `runs.selector`, resolved against the project's newest 500 runs just as the UI resolves it,
- named as a run of a card's series (`series[].runId`),
- in the cell's run view: `hidden`, `pinned` or `baseline`,
- given as a run id in a card's settings, such as a code-diff card's left and right run.

For runs in scope, a viewer can read the run record, its logged series, its artifacts and the report's uploaded images. Viewers can only read runs' source files through a code-diff card, for the runs that card compares.

!!! note "Scope follows the report"
    Scope is **live**: the server works it out again from the current report at most every 30 seconds. If you add a cell for more runs, the link exposes them too. Remove a cell, and its runs drop out. A selector that matches newer runs brings them into scope.
