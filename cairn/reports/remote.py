"""Submit source bundles and copy published source using the selected backend."""
import base64
import json
from pathlib import Path
import time
from urllib.parse import quote

from cairn.sdk.connect import open_writer
from cairn.sdk.transport import Transport
from cairn.sdk.reader import Reader
from cairn.sdk.artifacts import _entry_path
from .build import source_entry
from .config import load_config


def publish_remote(slug, *, project=None, repo=None, namespace='default', timeout=1900):
    config = load_config(project, repo=repo, namespace=namespace)
    source = config.reports_dir / slug
    source_entry(source)
    files, assets = {}, {}
    for path in sorted(source.rglob('*')):
        relative = path.relative_to(source)
        if any(p.startswith('.') or p == '__pycache__' for p in relative.parts):
            continue
        if path.is_symlink():
            raise ValueError(f'report source cannot contain symlinks: {relative}')
        if not path.is_file():
            continue
        data = path.read_bytes()
        try:
            text = data.decode('utf-8')
        except UnicodeDecodeError:
            text = None
        if text is not None and '\0' not in text:
            files[relative.as_posix()] = text
        else:
            assets[relative.as_posix()] = base64.b64encode(data).decode()
    api, _ = open_writer(repo)
    try:
        if not isinstance(api, Transport):
            raise ValueError('--execution server requires an explicit HTTP(S) tracking server')
        workspace = api.post_json('/api/report-workspaces', {'project_id': namespace, 'slug': slug,
                                                           'files': files, 'assets': assets}).json()
        job = api.post_json(f"/api/report-workspaces/{workspace['id']}/build",
                       {'expected_revision': workspace['revision']}).json()
        print(f"queued report build {job['id']}")
        deadline = time.monotonic() + timeout
        while job['status'] in ('queued', 'running'):
            if time.monotonic() > deadline:
                raise TimeoutError(f"build {job['id']} is still {job['status']}; query /api/report-builds/{job['id']}")
            time.sleep(.5)
            job = api.get('/api/report-builds/' + job['id']).json()
        if job['status'] != 'completed':
            raise RuntimeError(job.get('error') or 'report build failed')
        return job['result']
    finally:
        api.close()


def copy_report(report_id, *, project=None, repo=None, version=None, slug=None):
    """Download exact published sources for editing by a person or external tool."""
    # Use one API for source copying; local users can copy their existing sources
    # directly, or read a publication's artifact version through Reader.
    api, _ = open_writer(repo)
    try:
        if isinstance(api, Transport):
            workspace = api.post_json('/api/report-workspaces', {'report_id': report_id,
                                    'version_id': version, 'slug': slug, 'fork': slug is not None}).json()
            slug = workspace['slug']
            entries = workspace['files']
            def read(entry):
                return api.get(f"/api/report-workspaces/{workspace['id']}/files/" + quote(entry['path'], safe='/')).content
        else:
            from cairn.backend import report_workspaces
            workspace = report_workspaces.create(api._db, api.blobs, report_id=report_id,
                                                 version_id=version, slug=slug, fork=slug is not None)
            slug, entries = workspace['slug'], workspace['files']
            def read(entry):
                return api.blobs.get(entry['hash'])
        target = Path(project or Path.cwd()) / 'reports' / slug
        target.mkdir(parents=True, exist_ok=False)
        try:
            for entry in entries:
                path = target / _entry_path(entry['path'])
                path.parent.mkdir(parents=True, exist_ok=True)
                data = entry['text'].encode('utf-8') if entry['text'] is not None else read(entry)
                import hashlib
                if hashlib.sha256(data).hexdigest() != entry['hash']:
                    raise ValueError(f"source checksum mismatch: {entry['path']}")
                path.write_bytes(data)
        except BaseException:
            import shutil
            shutil.rmtree(target)
            raise
        return target
    finally:
        api.close()
