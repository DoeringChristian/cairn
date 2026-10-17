"""Notebook operations share report workspace authorization and source CAS."""
from fastapi import APIRouter,Request
from pydantic import BaseModel,ConfigDict,StrictBool
from .report_workspaces import _call
router=APIRouter(prefix='/api',tags=['reports'])
class Edit(BaseModel):
    model_config=ConfigDict(extra='forbid')
    source:str
    expected_hash:str
class Insert(Edit):
    type:str
    after_id:str|None=None
class Run(BaseModel):
    model_config=ConfigDict(extra='forbid')
    force:StrictBool=False
@router.get('/report-workspaces/{ident}/notebook')
def notebook(ident:str,request:Request):return _call(request.app.state.notebooks.notebook,ident)
@router.put('/report-workspaces/{ident}/cells/{cell_id}')
def edit(ident:str,cell_id:str,body:Edit,request:Request):return _call(request.app.state.notebooks.edit,ident,cell_id,body.source,body.expected_hash)
@router.post('/report-workspaces/{ident}/notebook/cells')
def insert(ident:str,body:Insert,request:Request):return _call(request.app.state.notebooks.insert,ident,body.type,body.source,body.after_id,body.expected_hash)
@router.delete('/report-workspaces/{ident}/cells/{cell_id}')
def delete(ident:str,cell_id:str,expected_hash:str,request:Request):return _call(request.app.state.notebooks.delete,ident,cell_id,expected_hash)
@router.post('/report-workspaces/{ident}/cells/{cell_id}/run',status_code=202)
def run(ident:str,cell_id:str,body:Run,request:Request):return _call(request.app.state.notebooks.submit,ident,cell_id,body.force)
@router.get('/notebook-jobs/{ident}')
def job(ident:str,request:Request):return _call(request.app.state.notebooks.job,ident)
