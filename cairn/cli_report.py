"""Report authoring and publication through the selected tracker backend."""
import json
from pathlib import Path
import click
from .cli_target import target_options, explicit

@click.group('report')
def report_group():
    """Build and publish executable Markdown reports."""

@report_group.command('build')
@click.option('--report', default=None)
@click.option('--project-dir', default='.', type=click.Path(path_type=Path))
@click.option('--project', default='default')
@target_options
def build(report, project_dir, project, repo, server):
    from .reports import build_all
    build_all(report, project=project_dir, repo=explicit(repo, server), namespace=project)

@report_group.command('publish')
@click.argument('slug')
@click.option('--project-dir', default='.', type=click.Path(path_type=Path))
@click.option('--project', default='default')
@click.option('--execution', type=click.Choice(['local', 'server']), default='local', show_default=True)
@target_options
def publish(slug, project_dir, project, execution, repo, server):
    from .reports.publishing import publish_report
    if execution == 'server':
        from .reports.remote import publish_remote
        publish_report = publish_remote
    result = publish_report(slug, project=project_dir, repo=explicit(repo, server), namespace=project)
    click.echo(json.dumps(result, indent=2))


@report_group.command('copy')
@click.argument('report_id')
@click.option('--version', default=None)
@click.option('--slug', default=None)
@click.option('--project-dir', default='.', type=click.Path(path_type=Path))
@target_options
def copy_source(report_id, version, slug, project_dir, repo, server):
    """Copy a published version's source for editing by you or an external tool."""
    from .reports.remote import copy_report
    click.echo(str(copy_report(report_id, version=version, slug=slug,
                              project=project_dir, repo=explicit(repo, server))))

@report_group.command('ls')
@click.option('--project', default=None)
@target_options
def ls(project, repo, server):
    from .sdk.reader import Reader
    with Reader(explicit(repo, server)) as reader:
        click.echo(json.dumps([{'id': r.id, 'project': r.project, 'name': r.name,
                                'updated_at': r.updated_at} for r in reader.reports(project)], indent=2))

@report_group.command('export')
@click.argument('slug')
@click.option('--out', required=True, type=click.Path(path_type=Path))
@click.option('--project-dir', default='.', type=click.Path(path_type=Path))
@click.option('--project', default='default')
@target_options
def export(slug, out, project_dir, project, repo, server):
    from .reports.config import load_config
    from .reports.share import share
    share(load_config(project_dir, repo=explicit(repo, server), namespace=project), report=slug, out=out)


@report_group.command('new')
@click.argument('slug')
@click.option('--project-dir', default='.', type=click.Path(path_type=Path))
@click.option('--run', 'run_id', default=None)
def new(slug, project_dir, run_id):
    """Create a report source, optionally declaring a finished run as evidence."""
    from cairn.backend.report_publications import SLUG
    if not SLUG.fullmatch(slug):
        raise click.BadParameter('use lower-case letters, numbers, hyphens or underscores')
    folder = project_dir/'reports'/slug
    folder.mkdir(parents=True, exist_ok=True)
    inputs = f'inputs:\n  fit: "run:{run_id}"\n' if run_id else ''
    source = f'---\ntitle: {slug.replace("-", " ").capitalize()}\n{inputs}---\n\n# Findings\n\nWrite the question, evidence, and conclusion here.\n'
    path = folder/'report.qmd'
    with path.open('x') as file:
        file.write(source)
    click.echo(str(path))


@report_group.command('rm')
@click.argument('report_id')
@target_options
def remove(report_id, repo, server):
    """Remove a publication from the catalog; its artifact history is retained."""
    from .sdk.connect import open_writer
    writer, _ = open_writer(explicit(repo, server))
    try:
        from .sdk.reader import Reader
        with Reader(explicit(repo, server)) as reader:
            version = reader.report(report_id).version_id
        click.echo(json.dumps(writer.remove_report(report_id, expected_version=version)))
    finally:
        writer.close()
