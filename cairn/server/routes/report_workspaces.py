"""Authenticated source-copy editing and durable report execution requests."""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from cairn.backend import report_workspaces as core
from ._common import get_db, get_blobs
from ..report_execution import require_notebooks

router = APIRouter(prefix='/api', tags=['reports'])

class Create(BaseModel):
    report_id: str | None = None
    fork: bool = False
    version_id: str | None = None
    project_id: str = 'default'
    slug: str | None = None
    files: dict[str, str] | None = None
    assets: dict[str, str] | None = None

class Edit(BaseModel):
    files: dict[str, str | None]
    expected_revision: int = Field(ge=1)

class Build(BaseModel):
    expected_revision: int = Field(ge=1)
    slug: str | None = None


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except core.Conflict as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

@router.post('/report-workspaces', status_code=201)
def create(body: Create, request: Request):
    return _call(core.create, get_db(request), get_blobs(request), **body.model_dump())

@router.get('/report-workspaces/{ident}')
def get(ident: str, request: Request):
    return _call(core.get, get_db(request), get_blobs(request), ident)

@router.get('/report-workspaces/{ident}/files/{path:path}')
def file(ident: str, path: str, request: Request):
    row = _call(core._row, get_db(request), ident)
    entry = row['files'].get(path)
    if entry is None:
        raise HTTPException(404, 'source file not found')
    return Response(get_blobs(request).get(entry['hash']), media_type='application/octet-stream',
                    headers={'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox'})

@router.put('/report-workspaces/{ident}')
def update(ident: str, body: Edit, request: Request):
    return _call(core.update, get_db(request), get_blobs(request), ident, **body.model_dump())

@router.post('/report-workspaces/{ident}/build', status_code=202)
def build(ident: str, body: Build, request: Request):
    require_notebooks(request)
    from cairn.reports.preparation import submit
    return _call(submit, request.app.state.storage, ident, **body.model_dump())

@router.get('/report-builds/{ident}')
def status(ident: str, request: Request):
    return _call(core.build_status, get_db(request), ident)


def _diagnostic_files(request, ident):
    from ._common import get_data_dir
    _call(core.build_status, get_db(request), ident)
    root = get_data_dir(request).root/'report-jobs'/ident
    allowed = {'worker.log', 'failed.ipynb', 'status.json', 'prepared.json', 'environment.json', 'requirements.lock'}
    return {p.relative_to(root).as_posix(): p for p in root.rglob('*')
            if p.is_file() and not p.is_symlink() and p.name in allowed}


@router.get('/report-builds/{ident}/diagnostics')
def diagnostics(ident: str, request: Request):
    return {'files': [{'path': name, 'size': path.stat().st_size}
                      for name, path in _diagnostic_files(request, ident).items()]}


@router.get('/report-builds/{ident}/diagnostics/{path:path}')
def diagnostic_file(ident: str, path: str, request: Request):
    from fastapi.responses import FileResponse
    files = _diagnostic_files(request, ident)
    if path not in files:
        raise HTTPException(404, 'diagnostic file not found')
    return FileResponse(files[path], filename=files[path].name, media_type='application/octet-stream',
                        headers={'X-Content-Type-Options':'nosniff', 'Content-Security-Policy':'sandbox'})
