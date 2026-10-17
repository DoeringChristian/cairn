"""HTTP adapter for revision-bound publication annotations."""
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from pydantic import BaseModel, ConfigDict, Field
from cairn.backend import report_comments
from cairn.backend.report_publications import PublicationConflict
from ._common import get_db, get_blobs
from .. import auth

router=APIRouter(prefix='/api/projects/{project_id}/reports/{report_id}/comments',tags=['reports'])
_write=Depends(auth.require_auth)

class Create(BaseModel):
    model_config=ConfigDict(extra='forbid')
    body:str
    revision_id:str
    parent_id:str|None=None
    anchor_kind:Literal['report','block','card','quote']|None=None
    anchor_id:str|None=None
    quote:str|None=None
    selection:dict|None=None

class Edit(BaseModel):
    model_config=ConfigDict(extra='forbid')
    body:str
    expected_revision:int=Field(ge=1,strict=True)

class Resolve(BaseModel):
    model_config=ConfigDict(extra='forbid')
    resolved:bool
    expected_revision:int=Field(ge=1,strict=True)

def _call(function,*args,**kwargs):
    try: return function(*args,**kwargs)
    except PublicationConflict as exc: raise HTTPException(409,str(exc)) from exc
    except LookupError as exc: raise HTTPException(404,str(exc)) from exc
    except ValueError as exc: raise HTTPException(400,str(exc)) from exc

def _author(request):
    return 'Server access' if getattr(request.app.state,'auth_enabled',False) else 'local'

@router.get('')
def listing(project_id:str,report_id:str,revision_id:str,request:Request):
    return _call(report_comments.list_comments,get_db(request),report_id,revision_id,project=project_id)

@router.post('',dependencies=[_write])
def create(project_id:str,report_id:str,body:Create,request:Request):
    return _call(report_comments.create,get_db(request),get_blobs(request),report_id,project=project_id,author=_author(request),**body.model_dump())

@router.put('/{comment_id}',dependencies=[_write])
def edit(project_id:str,report_id:str,comment_id:str,body:Edit,request:Request):
    return _call(report_comments.mutate,get_db(request),report_id,comment_id,project=project_id,operation='edit',author=_author(request),**body.model_dump())

@router.post('/{comment_id}/resolve',dependencies=[_write])
def resolve(project_id:str,report_id:str,comment_id:str,body:Resolve,request:Request):
    return _call(report_comments.mutate,get_db(request),report_id,comment_id,project=project_id,operation='resolve',author=_author(request),**body.model_dump())

@router.delete('/{comment_id}',dependencies=[_write])
def delete(project_id:str,report_id:str,comment_id:str,request:Request,expected_revision:int=Query(ge=1)):
    return _call(report_comments.mutate,get_db(request),report_id,comment_id,project=project_id,operation='delete',author=_author(request),expected_revision=expected_revision)
