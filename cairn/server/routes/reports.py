"""HTTP adapter for immutable report publications; source edits use workspaces."""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from cairn.backend import reports
from cairn.backend.report_publications import PublicationConflict
from cairn.server import auth
from cairn.server.routes._common import get_db

router=APIRouter(prefix='/api',tags=['reports'])


def _read(call):
    try:
        return call()
    except LookupError as exc:
        raise HTTPException(404,str(exc)) from exc


@router.get('/projects/{project_id}/reports')
def list_reports(project_id: str, request: Request, limit: int=Query(50,ge=1,le=1000), offset: int=Query(0,ge=0)):
    return reports.list_page(get_db(request),project_id,limit=limit,offset=offset)


@router.get('/reports')
def list_all_reports(request: Request, project: str|None=None, limit: int=Query(200,ge=1,le=1000), offset: int=Query(0,ge=0)):
    return reports.list_page(get_db(request),project,limit=limit,offset=offset)


@router.get('/reports/{report_id}')
def get_report_by_id(report_id: str, request: Request):
    return _read(lambda: reports.read(get_db(request),report_id))


@router.get('/projects/{project_id}/reports/{report_id}')
def get_report(project_id: str, report_id: str, request: Request):
    return _read(lambda: reports.read(get_db(request),report_id,project=project_id))


@router.get('/reports/{report_id}/history')
def history(report_id: str, request: Request, limit: int=Query(200,ge=1,le=1000), offset: int=Query(0,ge=0)):
    return _read(lambda: reports.history(get_db(request),report_id,limit=limit,offset=offset))


@router.delete('/reports/{report_id}',dependencies=[Depends(auth.require_auth)])
def delete_report(report_id: str, request: Request, expected_version: str=Query(...)):
    try:
        return _read(lambda: reports.delete(get_db(request),report_id,expected_version=expected_version))
    except PublicationConflict as exc:
        raise HTTPException(409,str(exc)) from exc
