"""Publish one immutable report build with a compare-and-swap current pointer."""
import json
import shutil
import tempfile
from pathlib import Path
from .. import Artifact, log_artifact
from ..sdk.connect import open_writer
from .config import load_config
from .build import build_all


_CURRENT = object()


def publish_report(slug, *, project=None, repo=None, namespace='default', expected_version=_CURRENT, build_id=None, prepared=None):
    if expected_version is _CURRENT:
        writer, _ = open_writer(repo)
        try:
            expected_version = writer.current_publication(namespace, slug)
        finally:
            writer.close()
    config = load_config(project, repo=repo, namespace=namespace)
    built = build_all(config, report=slug, prepared=prepared)[0]
    manifest = json.loads((built.generated/'manifest.json').read_text())
    with tempfile.TemporaryDirectory(prefix='cairn-publication-') as tmp:
        stage = Path(tmp)
        shutil.copytree(built.generated, stage/slug)
        shutil.copytree(built.content_root, stage/'sources')
        for role, item in built.inputs.items():
            shutil.copytree(item['path'], stage/'evidence'/role)
        for name in ('environment.json', 'requirements.lock', 'prepared.json'):
            shutil.copyfile(built.generated.parent/name, stage/name)
        draft = Artifact('report-'+slug, type='report',
                         metadata={'inputs': manifest['inputs'], 'slug': slug, 'source_ref': built.source_ref})
        draft.add_dir(stage)
        version = log_artifact(draft, project=namespace, repo=repo)
    writer, _ = open_writer(repo)
    try:
        return writer.publish_report({'project_id': namespace, 'slug': slug,
            'name': str(built.meta.get('title') or slug), 'source': built.markdown.read_text(),
            'version_id': version.id, 'expected_version': expected_version, 'build_id': build_id})
    finally:
        writer.close()
