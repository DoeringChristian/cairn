"""Inline edits use the same authenticated workspace lifecycle as source edits."""
from fastapi import APIRouter,Request
from pydantic import BaseModel,Field,ConfigDict
from cairn.backend import report_inline
from ._common import get_db,get_blobs
from .report_workspaces import _call

router=APIRouter(prefix='/api/report-workspaces',tags=['reports'])

class Edit(BaseModel):
    model_config=ConfigDict(extra='forbid')
    expected_revision:int=Field(ge=1,strict=True)
    replacement:str

@router.get('/{ident}/blocks/{block_id}')
def block(ident:str,block_id:str,request:Request):
    return _call(report_inline.block,get_db(request),get_blobs(request),ident,block_id)

@router.put('/{ident}/blocks/{block_id}')
def edit(ident:str,block_id:str,body:Edit,request:Request):
    return _call(report_inline.update,get_db(request),get_blobs(request),ident,block_id,**body.model_dump())
