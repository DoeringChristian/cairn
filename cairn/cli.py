"""Cairn: reports, local tracking, or a remote tracking server."""
from __future__ import annotations
import json
import os
from pathlib import Path
from datetime import datetime
import click
from . import config

class CairnGroup(click.Group):
    def invoke(self, ctx):
        import httpx
        try:
            return super().invoke(ctx)
        except httpx.HTTPError as exc:
            raise click.ClickException(str(exc)) from exc
        except ImportError as exc:
            raise click.ClickException(f'{exc}; install cairn-track[reports] for report commands') from exc
        except (ValueError, LookupError, OSError) as exc:
            raise click.ClickException(str(exc)) from exc

@click.group(cls=CairnGroup)
@click.version_option(package_name='cairn-track')
def main():
    """Track experiments and write executable research reports."""

@main.command()
@click.argument('path', default='.cairn', type=click.Path(path_type=Path))
def init(path):
    """Create a local repo. Nothing runs in the background."""
    from .backend.repository import Repository
    transport = Repository(path)
    transport.close()
    click.echo(str(path.resolve()))

def _local_app(repo, *, ui, token=None, token_file=None, auth_enabled=False, database_url=None, blob_root=None):
    from .server.app import create_app
    return create_app(data_dir=Path(repo), mount_ui=ui, auth_enabled=auth_enabled, token=token,
                      token_file=token_file, database_url=database_url, blob_root=blob_root)

def _browser_url(host, port):
    host = host.strip('[]')
    host = {'0.0.0.0': '127.0.0.1', '::': '::1'}.get(host, host)
    if ':' in host:
        host = '['+host+']'
    return f'http://{host}:{port}'

def _serve(app, host, port, open_browser=False, repo=None):
    import uvicorn
    if open_browser:
        import threading
        import webbrowser
        threading.Timer(1, lambda: webbrowser.open(_browser_url(host, port)+'/')).start()
    click.echo(f'Cairn: {_browser_url(host, port)}')
    dd = None
    if repo is not None:
        from cairn.backend.storage.datadir import DataDir
        dd = DataDir(Path(repo))
        dd.add_live_server('ui', host='127.0.0.1' if host == '0.0.0.0' else host, port=port)
    try:
        uvicorn.run(app, host=host, port=port)
    finally:
        if dd is not None:
            dd.remove_live_server()

@main.command('server')
@click.option('--repo', default='.cairn', type=click.Path(path_type=Path))
@click.option('--host', default='127.0.0.1')
@click.option('--port', default=4300, type=int)
@click.option('--ui/--no-ui', default=True)
@click.option('--no-auth', is_flag=True, help='Explicitly serve without a token.')
@click.option('--token-file', type=click.Path(path_type=Path), help='Private token file (default: REPO/token).')
@click.option('--database-url', envvar='CAIRN_DATABASE_URL', help='Server database URL (PostgreSQL or SQLite).')
@click.option('--blob-root', envvar='CAIRN_BLOB_ROOT', help='Filesystem directory or s3://bucket/prefix for blobs.')
def server(repo, host, port, ui, no_auth, token_file, database_url, blob_root):
    """Serve a repo using CAIRN_TOKEN or an automatically created private token file."""
    try:
        app = _local_app(repo, ui=ui, auth_enabled=not no_auth, token_file=token_file,
                         database_url=database_url, blob_root=blob_root)
    except (ValueError, OSError) as exc:
        raise click.ClickException(str(exc)) from exc
    if app.state.token_file:
        click.echo(f'Access token file: {app.state.token_file}')
    if ui and app.state.auth_enabled:
        from urllib.parse import quote
        click.echo(f'Browser login: {_browser_url(host, port)}/login#token={quote(app.state.token, safe="")}')
    _serve(app, host, port, repo=repo if ui else None)

@main.command('ui')
@click.option('--repo', default=None)
@click.option('--host', default='127.0.0.1')
@click.option('--port', default=4301, type=int)
@click.option('--open-browser/--no-open-browser', default=True)
def ui(repo, host, port, open_browser):
    """Open the reports UI for a local repo or remote server."""
    if host not in ('127.0.0.1', 'localhost', '::1'):
        raise click.ClickException('use `cairn server` with CAIRN_TOKEN to expose a repo')
    target = config.resolve_target(repo=repo)
    if target.is_local:
        app = _local_app(target.location, ui=True)
    else:
        from .server.proxy import create_proxy_app
        app = create_proxy_app(target.location, token=config.resolve_token(target.location))
    _serve(app, host, port, open_browser, repo=target.location if target.is_local else None)

@main.command('login')
@click.argument('url')
@click.option('--token', prompt=True, hide_input=True)
def login(url, token):
    """Save the existing server token for this URL."""
    import httpx
    url = config._as_server_url(url)
    response = httpx.get(url.rstrip('/')+'/api/auth/session', headers={'Authorization': 'Bearer '+token})
    if response.status_code != 200:
        raise click.ClickException(f'server refused login ({response.status_code})')
    session = response.json()
    if not session.get('auth_enabled'):
        click.echo('This server runs without authentication; no token is needed.')
        return
    if not session.get('authenticated'):
        raise click.ClickException('server rejected the token')
    config.save_token(url, token)
    click.echo('Token saved.')

@main.command('logout')
@click.argument('url')
def logout(url):
    """Forget this client's saved server token."""
    config.save_token(config._as_server_url(url), None)

@main.command('runs')
@click.option('--repo', default=None)
@click.option('--project', default=None)
def runs(repo, project):
    """List runs as JSON."""
    from .sdk.reader import Reader
    with Reader(repo) as reader:
        click.echo(json.dumps([{'id': r.id, 'name': r.name, 'status': r.status,
                                'project': r.project} for r in reader.runs(project)], indent=2))

@main.command('show')
@click.argument('run_id')
@click.option('--repo', default=None)
def show(run_id, repo):
    """Read a run's recorded metadata and final metrics."""
    from .sdk.reader import Reader
    with Reader(repo) as reader:
        run = reader.run(run_id)
        click.echo(json.dumps({'id': run.id, 'name': run.name, 'status': run.status,
                               'config': run.config, 'metrics': run.final}, indent=2))

@main.command('build')
@click.option('--report', default=None)
@click.option('--project-dir', default='.', type=click.Path(path_type=Path))
@click.option('--repo', default=None)
@click.option('--project', default='default')
def build(report, project_dir, repo, project):
    """Build executable Markdown reports into .cairn/build/."""
    from .reports import build_all
    build_all(report, project=project_dir, repo=repo, namespace=project)

@main.command('serve')
@click.option('--project-dir', default='.', type=click.Path(path_type=Path))
@click.option('--repo', default=None)
@click.option('--project', default='default')
@click.option('--port', default=8000, type=int)
def serve(project_dir, repo, project, port):
    """Build and preview the report site on loopback."""
    from functools import partial
    from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
    from .reports import build_all
    build_all(project=project_dir, repo=repo, namespace=project)
    handler = partial(SimpleHTTPRequestHandler, directory=str(project_dir.resolve()/'.cairn/build'))
    click.echo(f'Reports: http://127.0.0.1:{port}')
    with ThreadingHTTPServer(('127.0.0.1', port), handler) as server:
        server.serve_forever()

# Presentation helpers used by artifact/viewer commands.
class _ReaderErrors:
    def __init__(self, label): self.label = label
    def __enter__(self): return self
    def __exit__(self, kind, exc, tb):
        if exc is not None and isinstance(exc, (ValueError, LookupError, OSError)):
            raise click.ClickException(f'{self.label}: {exc}') from exc

def _cell(value): return str(value or '')
def _parse_iso(value): return datetime.fromisoformat(value)
def _print_table(headers, rows, empty='(none)'):
    click.echo('\t'.join(headers))
    for row in rows: click.echo('\t'.join(map(_cell, row)))
    if not rows: click.echo(empty)

from .cli_sync import sync_cmd
from .cli_artifact import artifact_group
from .cli_viewer import viewer_group
from .cli_report import report_group
main.add_command(sync_cmd)
main.add_command(artifact_group)
main.add_command(viewer_group)
main.add_command(report_group)
