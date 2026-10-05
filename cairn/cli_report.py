"""`cairn report ...`: reports (markdown documents with live cards) from the shell.

Every command goes through the server's report routes, against a server or
in-process over a local repo (see ``cairn/cli_target.py``). A report is
named by its id alone; ids are unique across projects.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import click

from .cli_target import Api, open_api, target_options

_FORMAT = click.option(
    "--format", "fmt", type=click.Choice(["table", "json"]), default="table", show_default=True,
)


def _report(api: Api, report_id: str) -> dict[str, Any]:
    return api.get(f"/api/reports/{report_id}").json()


def _base(api: Api, report: dict[str, Any]) -> str:
    return f"/api/projects/{report['project_id']}/reports/{report['id']}"


def _require_share_server(api: Api) -> None:
    """Share links are redeemed by a server with auth on; say so before asking
    one that cannot have them."""
    if api.in_process:
        raise click.ClickException(
            f"{api.local_root} is a local repo: share links need a server with auth "
            f"to redeem them. Serve it with `cairn ui --repo {api.local_root}` (auth is "
            "on by default) and run this again"
        )
    session = api.get("/api/auth/session").json()
    if session.get("auth_enabled") is False:
        raise click.ClickException(
            f"{api.base} runs without auth (--no-auth): share links need auth, and "
            "anyone who can reach this server can already read the report"
        )


@click.group("report")
def report_group() -> None:
    """List, read, export, delete and share reports."""


@report_group.command("ls")
@click.option("--project", default=None, help="Only this project's reports. Default: every project's.")
@_FORMAT
@target_options
def report_ls(project: str | None, fmt: str, repo: str | None, server: str | None) -> None:
    """List reports, most recently changed first."""
    from .server.routes._common import slugify

    params: dict[str, Any] = {"limit": 1000}
    if project:
        params["project"] = slugify(project)
    with open_api(repo, server) as api:
        reports = api.get("/api/reports", params=params).json()["reports"]
    if fmt == "json":
        click.echo(json.dumps(reports, indent=2))
        return
    from .cli import _print_table
    from .cli_artifact import _when

    headers = ["ID"] + ([] if project else ["PROJECT"]) + ["NAME", "UPDATED", "BLOCKS"]
    _print_table(headers, [
        [r["id"]] + ([] if project else [r["project_id"]])
        + [r["name"], _when(r["updated_at"]), str(r["block_count"])]
        for r in reports
    ], empty="(no reports)")


@report_group.command("show")
@click.argument("report_id")
@target_options
def report_show(report_id: str, repo: str | None, server: str | None) -> None:
    """Print a report's markdown source: its prose, and a ```cairn block of
    YAML for each cards cell (the source the UI's View source shows)."""
    with open_api(repo, server) as api:
        source = (_report(api, report_id).get("payload") or {}).get("source") or ""
    click.echo(source, nl=not source.endswith("\n"))


@report_group.command("export")
@click.argument("report_id")
@click.option(
    "--format", "fmt", type=click.Choice(["md"]), default="md", show_default=True,
    help="md: the markdown source. LaTeX and PDF capture the rendered cards, "
         "which needs a browser: use Export LaTeX / Export PDF in the UI.",
)
@click.option("-o", "--out", type=click.Path(dir_okay=False, path_type=Path), required=True,
              help="File to write.")
@target_options
def report_export(report_id: str, fmt: str, out: Path, repo: str | None, server: str | None) -> None:
    """Write a report to a file."""
    with open_api(repo, server) as api:
        source = (_report(api, report_id).get("payload") or {}).get("source") or ""
    out.write_text(source)
    click.echo(f"exported to {out}")


@report_group.command("rm")
@click.argument("report_id")
@target_options
def report_rm(report_id: str, repo: str | None, server: str | None) -> None:
    """Delete a report with its comments, uploaded images and share links (no undo)."""
    with open_api(repo, server) as api:
        api.delete(_base(api, _report(api, report_id)))
    click.echo(f"deleted {report_id}")


@report_group.command("share")
@click.argument("report_id")
@click.option(
    "--expires", default=None,
    help="When the link stops working: relative ('7d', '12h') or ISO 8601. Default: in 30 days.",
)
@target_options
def report_share(report_id: str, expires: str | None, repo: str | None, server: str | None) -> None:
    """Create a share link: anyone with it can read the report, and only it,
    without logging in. The link is printed once and cannot be shown again.
    Needs a server with auth on and the write role."""
    from .cli import _parse_expiry, _viewer_base

    with open_api(repo, server) as api:
        _require_share_server(api)
        report = _report(api, report_id)
        body = {"expires_at": _parse_expiry(expires)} if expires else {}
        share = api.post(f"{_base(api, report)}/shares", json=body).json()
        base = _viewer_base(api, api.base) or api.base
    click.echo(f"{base.rstrip('/')}{share['url']}")
    click.echo(f"share {share['id']} of {report_id}, expires {share['expires_at']}", err=True)


@report_group.command("shares")
@click.argument("report_id")
@_FORMAT
@target_options
def report_shares(report_id: str, fmt: str, repo: str | None, server: str | None) -> None:
    """List a report's share links (their ids and state, never the links)."""
    with open_api(repo, server) as api:
        _require_share_server(api)
        shares = api.get(f"{_base(api, _report(api, report_id))}/shares").json()["shares"]
    if fmt == "json":
        click.echo(json.dumps(shares, indent=2))
        return
    from .cli import _print_table
    from .cli_artifact import _when

    _print_table(
        ["SHARE", "STATUS", "CREATED_BY", "CREATED", "EXPIRES"],
        [[s["id"], s["status"], s.get("created_by") or "", _when(s["created_at"]), _when(s["expires_at"])]
         for s in shares],
        empty="(no share links)",
    )


@report_group.command("unshare")
@click.argument("report_id")
@click.argument("share_id")
@target_options
def report_unshare(report_id: str, share_id: str, repo: str | None, server: str | None) -> None:
    """Revoke a share link: every browser that opened it loses access at once."""
    with open_api(repo, server) as api:
        _require_share_server(api)
        api.delete(f"{_base(api, _report(api, report_id))}/shares/{share_id}")
    click.echo(f"revoked {share_id}")
