"""``cairn viewer``: publish, develop, list and vendor custom viewers.

Registered into the main group by ``cairn.cli`` (one line); everything else
lives here.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import click

_REPO_HELP = (
    "Path to a .cairn/ directory or a server URL (cairn://host:port, http://...). "
    "Default: CAIRN_REPO / CAIRN_SERVER / the config file, else ./.cairn."
)
_DIR = click.Path(exists=True, file_okay=False, path_type=Path)


@click.group("viewer")
def viewer_group() -> None:
    """Custom viewers: folders of browser code (a cairn-viewer.json manifest +
    ES modules) that show data logged with ``cairn.Data``."""


@viewer_group.command("publish")
@click.argument("folder", type=_DIR)
@click.option("--project", required=True, help="Project the viewer is available in.")
@click.option("--alias", "aliases", multiple=True, help="Alias to move to the version (repeatable).")
@click.option("--repo", "--server", "repo", default=None, help=_REPO_HELP)
def viewer_publish(folder: Path, project: str, aliases: tuple[str, ...], repo: str | None) -> None:
    """Publish FOLDER as a new version of its viewer (only if it changed)."""
    from .sdk.custom_viewers import publish_viewer
    from .server.viewer_manifest import ManifestError

    try:
        version = publish_viewer(folder, project=project, aliases=list(aliases) or None, repo=repo)
    except (ManifestError, ValueError, LookupError) as exc:
        raise click.ClickException(str(exc)) from None
    click.echo(f"{version.qualified_ref}  ({version.id})")


@viewer_group.command("ls")
@click.option("--project", required=True)
@click.option("--all-versions", is_flag=True, help="Every version, not only latest.")
@click.option("--repo", "--server", "repo", default=None, help=_REPO_HELP)
def viewer_ls(project: str, all_versions: bool, repo: str | None) -> None:
    """List the project's viewers (published, and live dev sources)."""
    viewers = _list(project, all_versions, repo)
    if not viewers:
        click.echo("(no viewers)")
        return
    click.echo(f"{'NAME':<24} {'VERSION':<9} {'INPUTS':<8} ACCEPTS")
    for v in viewers:
        ver = f"dev r{v['revision']}" if v.get("dev") else f"v{v['version']}"
        accepts = ", ".join(v.get("accepts") or []) or "-"
        err = f"  [error: {v['error']}]" if v.get("error") else ""
        click.echo(f"{v['name']:<24} {ver:<9} {str(v.get('inputs') or '-'):<8} {accepts}{err}")


def _list(project: str, all_versions: bool, repo: str | None) -> list[dict[str, Any]]:
    from .sdk.connect import open_transport
    from .sdk.local import LocalTransport
    from .server.custom_viewers import published_viewers
    from .server.routes._common import slugify

    transport, _url = open_transport(repo)
    try:
        if isinstance(transport, LocalTransport):
            return published_viewers(transport.db, slugify(project), all_versions=all_versions)
        resp = transport.get(
            f"/api/projects/{slugify(project)}/viewers",
            params={"all_versions": "1"} if all_versions else None,
        )
        return resp.json()["viewers"]
    finally:
        transport.close()


@viewer_group.command("dev")
@click.argument("folder", type=_DIR)
@click.option("--project", required=True, help="Project whose cards show the dev viewer.")
@click.option("--repo", "--server", "repo", default=None, help=_REPO_HELP)
@click.option("--interval", default=0.5, show_default=True, help="Seconds between folder scans.")
def viewer_dev(folder: Path, project: str, repo: str | None, interval: float) -> None:
    """Serve FOLDER live to a running server: every change reloads the viewer
    in open cards. Needs a running ``cairn ui``/``cairn server`` (write
    access); the dev source disappears ~30 s after this stops. It is never
    part of a report or share link."""
    import httpx

    from .sdk.connect import open_transport
    from .sdk.custom_viewers import DevSync
    from .sdk.local import LocalTransport
    from .server.routes._common import slugify
    from .server.viewer_manifest import ManifestError

    transport, url = open_transport(repo)
    if isinstance(transport, LocalTransport):
        transport.close()
        raise click.ClickException(
            "`cairn viewer dev` needs a running server: start `cairn ui` (or pass --server URL)"
        )
    token = getattr(transport, "token", None)
    transport.close()
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    client = httpx.Client(base_url=url, headers=headers, timeout=30.0)
    try:
        sync = DevSync(client, slugify(project), folder)
    except ManifestError as exc:
        client.close()
        raise click.ClickException(str(exc)) from None

    def report(revision: int, problem: str | None) -> None:
        stamp = f"[{sync.name} r{revision}]"
        click.echo(f"{stamp} {problem}" if problem else f"{stamp} updated", err=bool(problem))

    click.echo(f"serving {folder} as dev viewer {sync.name!r} on {url} (project {slugify(project)}); Ctrl-C stops")
    try:
        sync.run(interval=interval, on_change=report)
    except KeyboardInterrupt:
        pass
    finally:
        sync.close()
        client.close()
    sys.exit(0)


@viewer_group.command("add")
@click.argument("folder", type=_DIR)
@click.argument("spec")
@click.option("--as", "name", default=None, help="Import name (default: the package spec without its version).")
@click.option("--external", "externals", multiple=True,
              help="Leave this package's imports bare (map it yourself), e.g. --external three.")
def viewer_add(folder: Path, spec: str, name: str | None, externals: tuple[str, ...]) -> None:
    """Vendor the npm package SPEC into FOLDER for offline use.

    Downloads a self-contained ES-module build (esm.sh), writes it under
    FOLDER/vendor/ and maps it in the manifest's ``imports``:

    \b
        cairn viewer add viewers/vmf d3@7
        cairn viewer add viewers/vmf three@0.170/examples/jsm/controls/OrbitControls.js --external three
    """
    from .sdk.viewer_vendor import add_package

    try:
        result = add_package(folder, spec, name=name, externals=list(externals) or None)
    except (FileNotFoundError, ValueError) as exc:
        raise click.ClickException(str(exc)) from None
    except Exception as exc:  # noqa: BLE001  (network)
        raise click.ClickException(f"cannot download {spec}: {exc}") from None
    click.echo(f"imports[{result.name!r}] = {result.entry!r}  ({len(result.files)} file(s))")
    if result.bare_imports:
        click.echo(
            "bare imports left for the viewer to map in `imports`: " + ", ".join(result.bare_imports),
            err=True,
        )
