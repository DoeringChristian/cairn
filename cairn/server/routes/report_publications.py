"""Publish a compiled build and serve its manifest-listed files at pinned URLs."""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel
from cairn.backend import report_publications, artifact_registry_ops
from cairn.server.routes._common import get_db, get_blobs
from cairn.backend.common import slugify

router = APIRouter(prefix='/api', tags=['reports'])

class Publication(BaseModel):
    project_id: str
    slug: str
    name: str
    source: str
    version_id: str
    expected_version: str | None = None
    build_id: str | None = None

@router.get('/report-publications/current')
def current(project_id: str, slug: str, request: Request):
    return {'version_id': report_publications.current_version(get_db(request), slugify(project_id), slug)}

@router.post('/report-publications')
def publish(body: Publication, request: Request):
    try:
        return report_publications.publish(get_db(request), **{**body.model_dump(), 'project_id': slugify(body.project_id)})
    except report_publications.PublicationConflict as exc:
        raise HTTPException(409, str(exc)) from exc
    except (ValueError, LookupError) as exc:
        raise HTTPException(400, str(exc)) from exc

def _file(request, report_id, path, version_id=None):
    from cairn.backend.reports import file_entry
    try:
        entry=file_entry(get_db(request),report_id,path,version_id=version_id)
    except LookupError as exc:
        raise HTTPException(404,str(exc)) from exc
    cache='private, max-age=31536000, immutable' if version_id else 'private, no-cache'
    headers = {'Cache-Control':cache, 'X-Content-Type-Options':'nosniff'}
    if (entry.get('mime') or '').split(';')[0] == 'text/html':
        headers['Content-Security-Policy'] = 'sandbox allow-scripts allow-downloads'
    return FileResponse(get_blobs(request).path_for(entry['digest']), media_type=entry.get('mime'), headers=headers)

@router.get('/reports/{report_id}/render/{path:path}')
def render(report_id: str, path: str, request: Request):
    return _file(request, report_id, path)

@router.get('/reports/{report_id}/builds/{version_id}/{path:path}')
def render_build(report_id: str, version_id: str, path: str, request: Request):
    return _file(request, report_id, path, version_id)


@router.get('/reports/{report_id}/files')
def report_files(report_id: str, request: Request, version_id: str | None = None):
    from cairn.backend import reports
    try:
        report = reports.read(get_db(request), report_id)
        version_id = version_id or report['version_id']
        reports.file_entry(get_db(request), report_id, '', version_id=version_id)
        entries = artifact_registry_ops.version_files(get_db(request), version_id)
        return {'files': [{'path': e['path'], 'size': e['size'], 'mime': e.get('mime')} for e in entries],
                'version_id': version_id, 'entry': report['payload']['compiled']['entry']}
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.get('/reports/{report_id}/bundle')
def report_bundle(report_id: str, request: Request, version_id: str | None = None):
    import tempfile
    import zipfile
    from pathlib import Path
    from starlette.background import BackgroundTask
    manifest = report_files(report_id, request, version_id)
    entries = artifact_registry_ops.version_files(get_db(request), manifest['version_id'])
    stage = tempfile.TemporaryDirectory(prefix='cairn-report-export-')
    target = Path(stage.name)/'report.zip'
    try:
        with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            for entry in entries:
                if entry.get('digest'):
                    archive.write(get_blobs(request).path_for(entry['digest']), entry['path'])
        return FileResponse(target, media_type='application/zip', filename=f'report-{report_id}.zip',
                            background=BackgroundTask(stage.cleanup))
    except BaseException:
        stage.cleanup()
        raise
