"""`cairn artifact ...`: the versioned artifact registry from the shell.

Reads go through ``cairn.Reader`` and edits through its ``ArtifactVersion``
methods, so a local repo, a server and the repo a server holds all behave
as they do from Python. A ref is ``[PROJECT/]NAME[:ALIAS|:vN]``; a bare
``NAME`` means ``NAME:latest``.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import click

from .cli_target import reader_location, target_options

_PROJECT_HELP = "The project, unless the ref names it (PROJECT/NAME)."
_FORMAT = click.option(
    "--format", "fmt", type=click.Choice(["table", "json"]), default="table", show_default=True,
)


@contextmanager
def _reader(repo: str | None, server: str | None) -> Iterator[Any]:
    from .cli import _ReaderErrors
    from .sdk.reader import Reader

    location, label = reader_location(repo, server)
    with Reader(location) as reader, _ReaderErrors(label):
        yield reader


def _needs_project(ref: str, project: str | None) -> None:
    if project is None and "/" not in ref:
        raise click.UsageError(f"{ref!r} names no project: pass --project or PROJECT/{ref}")


def _family_name(ref: str, project: str | None) -> tuple[str, str]:
    """``[PROJECT/]NAME`` -> (project, name); a version part is an error."""
    _needs_project(ref, project)
    if "/" in ref:
        project, _, ref = ref.partition("/")
    if ":" in ref:
        raise click.UsageError(f"expected an artifact name, not a version ref: {ref!r}")
    assert project is not None
    return project, ref


def _size(n: int | None) -> str:
    if not n:
        return "0 B" if n == 0 else ""
    size = float(n)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size < 1024 or unit == "TB":
            return f"{size:.0f} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return ""


def _when(iso: Any) -> str:
    from .cli import _cell, _parse_iso

    return _cell(_parse_iso(str(iso))) if iso else ""


def _version_row(v: Any) -> dict[str, Any]:
    info = v._info
    producer = info.get("producer") or {}
    return {
        "ref": v.ref,
        "qualified_ref": v.qualified_ref,
        "version": v.version,
        "type": v.type,
        "aliases": v.aliases,
        "tags": v.tags,
        "size": v.size,
        "files": info.get("file_count"),
        "step": v.step,
        "created_at": info.get("created_at"),
        "run": info.get("created_by_run"),
        "run_name": producer.get("name") if isinstance(producer, dict) else None,
        "description": v.description,
        "metadata": v.metadata,
        "digest": v.digest,
        "id": v.id,
    }


@click.group("artifact")
def artifact_group() -> None:
    """Browse, download and curate the artifact registry (versioned
    artifacts logged with `run.log_artifact`)."""


@artifact_group.command("ls")
@click.option("--project", default=None, help="Only this project's artifacts. Default: every project's.")
@click.option("--type", "type_", default=None, help="Only artifacts of this type (model, dataset, ...).")
@_FORMAT
@target_options
def artifact_ls(project: str | None, type_: str | None, fmt: str, repo: str | None, server: str | None) -> None:
    """List artifacts (each name with its versions), most recently updated first."""
    with _reader(repo, server) as reader:
        projects = [project] if project else [p.id for p in reader.projects()]
        fams = [f for p in projects for f in reader.artifact_families(p, type=type_)]
    fams.sort(key=lambda f: f.updated_at, reverse=True)
    if fmt == "json":
        click.echo(json.dumps([
            {"project": f.project, "name": f.name, "type": f.type, "versions": f.versions,
             "aliases": f.aliases, "description": f.description,
             "created_at": f.created_at, "updated_at": f.updated_at}
            for f in fams
        ], indent=2))
        return
    from .cli import _print_table

    headers = ([] if project else ["PROJECT"]) + ["NAME", "TYPE", "VERSIONS", "ALIASES", "UPDATED"]
    rows = [
        ([] if project else [f.project]) + [
            f.name, f.type, str(f.versions),
            ",".join(f"{a}=v{n}" for a, n in sorted(f.aliases.items(), key=lambda kv: (kv[0] != "latest", kv[0]))),
            _when(f.updated_at),
        ]
        for f in fams
    ]
    _print_table(headers, rows, empty="(no artifacts)")


@artifact_group.command("versions")
@click.argument("name", metavar="[PROJECT/]NAME")
@click.option("--project", default=None, help=_PROJECT_HELP)
@_FORMAT
@target_options
def artifact_versions(name: str, project: str | None, fmt: str, repo: str | None, server: str | None) -> None:
    """List every version of an artifact, oldest first."""
    project, name = _family_name(name, project)
    with _reader(repo, server) as reader:
        rows = [_version_row(v) for v in reader.artifact_versions(name, project=project)]
    if fmt == "json":
        click.echo(json.dumps(rows, indent=2, default=str))
        return
    from .cli import _print_table

    _print_table(
        ["VERSION", "ALIASES", "TAGS", "SIZE", "FILES", "STEP", "CREATED", "RUN"],
        [
            [
                f"v{r['version']}", ",".join(r["aliases"]), ",".join(r["tags"]), _size(r["size"]),
                "" if r["files"] is None else str(r["files"]),
                "" if r["step"] is None else str(r["step"]), _when(r["created_at"]),
                r["run_name"] or (r["run"] or "")[:8],
            ]
            for r in rows
        ],
        empty="(no versions)",
    )


@artifact_group.command("get")
@click.argument("ref", metavar="[PROJECT/]NAME[:ALIAS|:vN]")
@click.option("--project", default=None, help=_PROJECT_HELP)
@click.option(
    "-o", "--out", type=click.Path(file_okay=False, path_type=Path), default=None,
    help="Directory to write the files into. Default: $CAIRN_ARTIFACT_DIR/NAME-vN, "
         "else ./artifacts/NAME-vN.",
)
@target_options
def artifact_get(ref: str, project: str | None, out: Path | None, repo: str | None, server: str | None) -> None:
    """Download a version's files (every entry at its path) and print the directory.

    A file already there with the right content is not fetched again. A
    reference entry is copied when cairn can read its URI, else skipped
    with a warning.
    """
    _needs_project(ref, project)
    with _reader(repo, server) as reader:
        v = reader.artifact(ref, project=project)
        root = v.download(out)
    click.echo(str(root))
    click.echo(f"downloaded {v.qualified_ref} ({len(v.files())} file(s))", err=True)


def _edit_cmd(group: click.Group, what: str, add: str, remove: str) -> None:
    for action, method in (("add", add), ("rm", remove)):
        def make(action: str = action, method: str = method) -> None:
            verb = "Point" if what == "alias" else "Add"
            doc = (
                f"{verb} {what.upper()} {'at' if what == 'alias' else 'to'} a version"
                if action == "add" else f"Remove {what.upper()} from a version"
            )
            if what == "alias" and action == "add":
                doc += " (moving it from the version that had it; latest and vN are reserved)"

            @group.command(action, help=doc + ".")
            @click.argument("ref", metavar="[PROJECT/]NAME:vN")
            @click.argument(what)
            @click.option("--project", default=None, help=_PROJECT_HELP)
            @target_options
            def cmd(ref: str, project: str | None, repo: str | None, server: str | None, **kw: str) -> None:
                _needs_project(ref, project)
                with _reader(repo, server) as reader:
                    v = reader.artifact(ref, project=project)
                    getattr(v, method)(kw[what])
                    label, listed = ("aliases", v.aliases) if what == "alias" else ("tags", v.tags)
                click.echo(f"{v.qualified_ref}: {label} {', '.join(listed) or '(none)'}")

        make()


@artifact_group.group("alias")
def alias_group() -> None:
    """Point user aliases (best, prod, ...) at versions, or remove them."""


@artifact_group.group("tag")
def tag_group() -> None:
    """Add tags to versions, or remove them."""


_edit_cmd(alias_group, "alias", "add_alias", "remove_alias")
_edit_cmd(tag_group, "tag", "add_tag", "remove_tag")


@artifact_group.command("rm")
@click.argument("ref", metavar="[PROJECT/]NAME[:ALIAS|:vN]")
@click.option("--project", default=None, help=_PROJECT_HELP)
@click.option(
    "--force", is_flag=True,
    help="With a version: delete it even though aliases name it (they go with "
         "it). With a bare NAME: needed, as it deletes every version.",
)
@target_options
def artifact_rm(ref: str, project: str | None, force: bool, repo: str | None, server: str | None) -> None:
    """Delete one version (NAME:vN or NAME:ALIAS), or a whole artifact (NAME).

    Version numbers are never reused; `latest` moves to the newest remaining
    version. The files' content stays in the repo's blob store.
    """
    _needs_project(ref, project)
    bare = ref.rpartition("/")[2]
    with _reader(repo, server) as reader:
        if ":" in bare:
            v = reader.artifact(ref, project=project)
            v.delete(force=force)
            click.echo(f"deleted {v.qualified_ref}")
            return
        proj, name = _family_name(ref, project)
        fam = next((f for f in reader.artifact_families(proj) if f.name == name), None)
        if fam is None:
            raise click.ClickException(f"no artifact {name!r} in project {proj!r}")
        if not force:
            raise click.ClickException(
                f"{proj}/{name} has {fam.versions} version(s); pass --force to delete "
                f"them all, or name one ({name}:vN)"
            )
        fam.delete()
    click.echo(f"deleted {proj}/{name} ({fam.versions} version(s))")


def _node_text(n: dict[str, Any]) -> str:
    if n["kind"] == "artifact_version":
        aliases = n.get("aliases") or []
        return f"{n['qualified_ref']} [{n['type']}]" + (f" ({', '.join(aliases)})" if aliases else "")
    if n["kind"] == "run":
        if n.get("deleted"):
            return f"run {n['id'][:8]} (deleted)"
        short = n["id"][:8]
        if n.get("name"):
            return f"run {n['name']} ({', '.join([short] + ([n['status']] if n.get('status') else []))})"
        return f"run {short}" + (f" ({n['status']})" if n.get("status") else "")
    return str(n.get("label") or n["id"])


def _lineage_lines(graph: dict[str, Any]) -> list[str]:
    nodes = {n["id"]: n for n in graph["nodes"]}
    center = graph["center"]
    up: dict[str, list[dict[str, Any]]] = {}
    down: dict[str, list[dict[str, Any]]] = {}
    for e in graph["edges"]:
        if e["kind"] not in ("produced", "consumed"):
            continue
        up.setdefault(e["target"], []).append(e)
        down.setdefault(e["source"], []).append(e)

    def text(e: dict[str, Any], nxt: str, upstream: bool) -> str:
        node = _node_text(nodes.get(nxt, {"kind": "?", "id": nxt}))
        if e["kind"] == "produced":
            return f"{'produced by' if upstream else 'produced'} {node}"
        role = f" as {e['role']}" if e.get("role") else ""
        return f"{'used' if upstream else 'used by'} {node}{role}"

    def walk(node: str, upstream: bool, prefix: str, path: frozenset[str], out: list[str]) -> None:
        edges = up.get(node, []) if upstream else down.get(node, [])
        for i, e in enumerate(edges):
            nxt = e["source"] if upstream else e["target"]
            last = i == len(edges) - 1
            out.append(f"{prefix}{'└── ' if last else '├── '}{text(e, nxt, upstream)}")
            if nxt not in path:
                walk(nxt, upstream, prefix + ("    " if last else "│   "), path | {nxt}, out)

    lines = [_node_text(nodes[center])]
    for title, upstream in (("upstream (where it came from)", True), ("downstream (what came of it)", False)):
        branch: list[str] = []
        walk(center, upstream, "  ", frozenset({center}), branch)
        lines.append(f"{title}:")
        lines.extend(branch or ["  (nothing)"])
    return lines


@artifact_group.command("lineage")
@click.argument("ref", metavar="[PROJECT/]NAME[:ALIAS|:vN]")
@click.option("--project", default=None, help=_PROJECT_HELP)
@click.option("--depth", type=click.IntRange(min=0), default=None, help="At most this many hops. Default: all.")
@click.option(
    "--direction", type=click.Choice(["both", "upstream", "downstream"]), default="both", show_default=True,
)
@click.option(
    "--format", "fmt", type=click.Choice(["tree", "json"]), default="tree", show_default=True,
    help="json: the lineage graph (nodes and edges) as the UI's lineage view gets it.",
)
@target_options
def artifact_lineage(
    ref: str, project: str | None, depth: int | None, direction: str, fmt: str,
    repo: str | None, server: str | None,
) -> None:
    """Show where a version came from (the run that produced it, that run's
    inputs, their producers, ...) and what came of it (the runs that used it,
    their outputs, ...) as a tree."""
    _needs_project(ref, project)
    with _reader(repo, server) as reader:
        graph = reader.artifact(ref, project=project).lineage(depth=depth, direction=direction)
    if fmt == "json":
        click.echo(json.dumps(graph, indent=2, default=str))
        return
    lines = _lineage_lines(graph)
    if direction != "both":
        keep = "upstream" if direction == "upstream" else "downstream"
        out, skip = [lines[0]], False
        for line in lines[1:]:
            if not line.startswith(" "):
                skip = not line.startswith(keep)
            if not skip:
                out.append(line)
        lines = out
    click.echo("\n".join(lines))
