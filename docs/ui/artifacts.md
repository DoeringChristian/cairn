# Artifact explorer

The **Artifacts** page (`/p/<project>/artifacts`) browses the project's artifacts: every version, its files, its metadata, the runs that logged and used it, and how to use it from Python. Logging and reading artifacts is covered in [Artifacts and lineage](../guides/artifacts.md).

## Layout

The left sidebar is a tree: artifact **types** (`dataset`, `model`, …), the **artifacts** of each type, and the **versions** of an artifact (newest first, with their aliases). A version no run has used is marked *unused*. The search box filters by name, type, description and alias; an artifact whose alias matches opens to show its versions.

With nothing selected, the page lists every artifact with its type, latest version, version count, total size, aliases and last update. Clicking an artifact opens its newest version.

Every view has its own URL:

| URL | Shows |
|---|---|
| `/p/<project>/artifacts` | All artifacts. |
| `/p/<project>/artifacts/<name>` | Redirects to the newest version. |
| `/p/<project>/artifacts/<name>/v<N>` | Version *N*, on its default tab. |
| `/p/<project>/artifacts/<name>/v<N>/<tab>` | A tab: `overview`, `metadata`, `usage`, `files`, `lineage`, `versions`. |

Switching versions in the sidebar keeps the current tab.

## A version

The header shows the type, the full name `project/name:vN` (with a copy button), the aliases, who logged it and when, its step, file count, size and number of consumers. **Download** saves every uploaded file as `<name>-v<N>.zip`; **Delete version** and **Delete artifact** are described [below](#deleting).

A version opens on **Overview**, except a version that no run has used yet: it opens on **Usage**, and its Usage tab is marked with a dot.

### Overview

| Field | Meaning |
|---|---|
| Full name | `project/name:vN`. |
| Type | The artifact's type. |
| Aliases | `latest` and your own aliases ([editable](#editing)). |
| Tags | The version's tags ([editable](#editing)). |
| Digest | The SHA-256 of the version's manifest. Two versions with the same digest have the same contents. |
| Created at | When the version was logged. |
| Step | The `step` given to `log_artifact`, if any. |
| Description | Markdown, rendered like run notes ([editable](#editing)). |
| Created by run | The run that logged it, with its status, or *Logged without a run*. |
| Linked to, TTL | Not supported by cairn; always `—`. |
| Consumers | How many runs used this exact version, and each one with its role and when it used it. |
| Number of files | Entries, with how many are references. |
| Size | Bytes of the uploaded files; references are not counted. |

Below the fields, **About &lt;name&gt;** shows the artifact's own description (shared by all its versions), with an **Edit** button.

A version that no run has used shows a banner linking to its Usage tab.

### Metadata

The version's metadata as a collapsible tree. **JSON** switches to the raw document. See [Editing](#editing) for changing it.

### Usage

Copy-ready Python for this exact version:

- **Use this version in a run**: `run.use_artifact("name:vN")` inside `with cairn.Run("project") as run:`. This records the run as a consumer (role `input` unless you pass `role=`).
- **Load a logged object**: `art.get()` (or `art.get("path")` when the version has more than one entry).
- **Download every file**: `art.download()` returns a `pathlib.Path`, `./artifacts/<name>-v<N>/` by default or `$CAIRN_ARTIFACT_DIR/<name>-v<N>/` when that variable is set.
- **Download one file**: `art.file("path")` returns the file's `Path`.
- **Open a file without writing it to disk**: `art.open("path", "r")` (or `"rb"`).
- **Read it without a run**: `cairn.Reader().artifact("name:vN", project="project")`. Nothing is recorded in the lineage.
- **Log a new version**: a `cairn.Artifact(name, type)` builder with `add_dir`, `add_file`, `add_reference` and `new_file` lines that follow this version's own layout, then `run.log_artifact(art, aliases=[...], tags=[...])` with this version's aliases and tags.

The snippets use the version's real entry paths, so they run as pasted.

### Files

A directory tree of the version's entries beside the selected entry. Selecting a directory lists its contents with sizes, types and digests; selecting a file shows its size, SHA-256 digest, MIME type and, for an object logged with `add` or the shorthand, how it was logged. The selected path is in the URL (`?path=`).

| Entry | Preview |
|---|---|
| Image (`.png`, `.jpg`, …) | The image, on a checkerboard. |
| Markdown (`.md`) | Rendered with the same pipeline as run notes and reports (GFM tables, math). |
| JSON | Pretty-printed and highlighted. |
| CSV / TSV | A table of the first 500 rows. |
| Text and source files | The text, highlighted when the language is known. |
| Pickle (`.pkl`, objects logged with `add`) | The Python type and the snippet to load it; browsers cannot unpickle. |
| Reference | Its URI (a link for `http(s)://`), size and ETag. Its bytes are not stored in cairn. |
| Anything else | No preview; download it. |

Text previews read the first 256 KiB of a file and say when they are cut. **Download** on a file saves that file; **Download &lt;name&gt;-v&lt;N&gt;.zip** saves every uploaded file of the version at its path. References are not in the zip.

### Lineage

The [lineage graph](lineage.md) centred on this version.

### Versions

Every version of the artifact with its aliases, tags, step, file count, size, age, the run that logged it and how many runs used it.

The **A** and **B** columns pick two versions to compare (by default the previous version and this one; the choice is in the URL as `?a=` and `?b=`). The comparison shows:

- whether the two have identical contents (the same manifest digest);
- **Metadata**: every key, flattened (`preprocess.resize`), with its value in each version and whether it was added, removed, changed or is the same;
- **Files**: files added, removed and changed between the two. A file is changed when its digest differs; a reference when its URI or ETag differs.

## Editing

With a write token, the explorer edits a version's annotations. Its files never change.

- **Aliases**: **+ alias** points an alias at this version. An alias names one version per artifact, so adding one that another version has moves it here. `latest` and `v<N>` are maintained by cairn and are refused; `latest` has no remove button.
- **Tags**: **+ tag** and **×**. A tag may be on any number of versions.
- **Description**: **Edit**, markdown.
- **Metadata**: on the Metadata tab, the pencil on a top-level key edits its value, and **+ Add key** adds one. A value that parses as JSON is stored as JSON, anything else as a string. Edits **merge**: the key is set or replaced and every other key is kept. Keys cannot be removed; set one to `null` to clear it.
- **Artifact description**: **About &lt;name&gt;** → **Edit**.

These are the same operations as `ArtifactVersion.add_alias`, `add_tag`, `update` and their removals in Python.

## Deleting

**Delete version** asks for confirmation. A version that an alias names (`latest` included) is refused by the server; the dialog then shows the reason and offers **Delete anyway**, which drops its aliases and moves `latest` to the newest remaining version. Deleting removes the version's file list, aliases and usage records; version numbers are never reused, and the files' bytes stay in the repo (other versions may share them). The page then opens the newest remaining version.

**Delete artifact** deletes the artifact with every version. Type the artifact's name to confirm.

## Read-only viewers

A viewer logged in with a `read` token sees the same pages without any editing controls: no alias, tag, description or metadata editors and no delete buttons. Downloads, previews, comparisons and the lineage graph work as usual. The server refuses writes from a read token in any case.

## A run's artifacts

The run page's **Artifacts** tab lists the versions the run logged and the versions it used (with each one's role), linking to their explorer pages, files and lineage. Below them is the lineage graph centred on the run.
