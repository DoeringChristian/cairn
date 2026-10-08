# Lineage graph

The lineage graph shows how runs and artifact versions connect: a run **produced** the versions it logged, and **consumed** the versions it used. It appears in three places, all the same viewer:

| Where | Centred on |
|---|---|
| **Lineage** in the project navigation (`/p/<project>/lineage`) | The whole project. The **Artifact** menu narrows it to one artifact's versions (`?artifact=<id>`). |
| A version's **Lineage** tab in the [artifact explorer](artifacts.md) | That version. |
| A run's **Artifacts** tab | That run. |

A centred graph first loads two hops in each direction from its centre (the producing run and its inputs upstream, the consumers and what they logged downstream). The centre is marked *(this)*.

## Reading the graph

The graph flows left to right, from inputs to outputs, laid out automatically.

- **Run** cards have a blue bar on the left and show the run's name, status, job type and group, and tags (`#tag`).
- **Artifact version** cards have a header in the colour of their type and show `name:vN`, the step, the file count and size, the aliases and tags.
- **Group** cards look like a stack of cards: a count and *N runs* or *N &lt;name&gt; versions*.
- Arrows are right-angled. A label on an arrow names the role a run used a version with (roles other than the default `input`) and, for an arrow into or out of a group, how many arrows it stands for (`×13`). A dashed arrow joins two nodes through hidden ones (see [Filters](#filters)) or links a forked run to its parent (`fork`).

## Navigating

- **Pan** by dragging the background; **zoom** with the scroll wheel, a pinch, or the **+** / **−** buttons at the bottom left.
- The **minimap** at the bottom right shows the whole graph; drag or scroll on it to move around.
- **Fit** (toolbar) or the frame button (bottom left) fits the whole graph into view. When the graph opens, or grows, it is fitted automatically. The project graph fits whole; a centred graph is never zoomed out so far that its cards are unreadable: when it is too wide, the view is centred on its centre node and you pan for the rest.
- **Drag a card** to move it. Moved cards stay put while you expand and filter. Positions are not saved: the graph is laid out afresh on every visit, and **Reset layout** returns to the automatic layout.

## Details panel

Click a card to open its details on the right (click the background or **×** to close it). The panel is the place to act on a node:

- **Run**: status, group, job type, created, tags (editable), how many artifacts it used and logged, its config as a collapsible tree, **Open run**.
- **Version**: aliases and tags (editable), description (editable), digest, created, step, files and size, the run that logged it, the number of consumers, **Open in explorer** and **Files**.
- **Group**: its members (clicking one expands the group and selects it) and **Expand group**.

Editing follows the explorer's rules ([Editing](artifacts.md#editing)); the cards update as soon as an edit is saved. With a read-only token, the panel shows the same details without editors.

## Highlighting a path

Selecting a card highlights its lineage: everything upstream of it (what it was made from) and downstream of it (what was made from it). Other cards fade and the arrows on the path turn blue.

## Expanding

Only part of the lineage is loaded at first. A card with more connections than the graph shows has a **+N** button on its left (upstream) or right (downstream) edge; clicking it loads one more hop in that direction. The details panel has the same **Upstream** / **Downstream** buttons. The buttons disappear once everything on that side is loaded.

## Groups

Sibling nodes are folded into a group card when there are more than **5** of them:

- runs of one job type that used exactly the same inputs (for example every run of a sweep that used one dataset); the card reads `12 finetune runs`, and the evals of the same model are a separate set;
- versions of one artifact whose producers are siblings (each sweep run's checkpoint).

**Expand** on a group card, or **Expand group** in its panel, shows the members; **Collapse siblings** in a member's panel folds them again. The toolbar's **Expand groups** and **Collapse groups** do this for every group at once. The centre node is never folded into a group.

## Filters

The toolbar's chips show or hide:

- **Runs** and **Artifacts**: every node of that kind;
- one chip per artifact type (`dataset`, `model`, …).

Hiding nodes keeps the rest connected: when runs are hidden, `dataset → run → checkpoint` becomes a dashed `dataset → checkpoint` arrow. The centre node is never hidden.

## From Python

The same graph is available from the reader: `cairn.Reader().lineage("project")`. Each node carries `degree` (its arrows within the returned graph) and `full_degree` (its produced/consumed arrows in the whole repo: when they differ there is more to expand). See [Artifacts and lineage](../guides/artifacts.md#lineage).
