"""Prism notebook editing and execution semantics adapted to Cairn workspaces.

Cells use file/ordinal identities; execution reuses only an unchanged Python
prefix with the same pinned dependencies and environment. Publications are built
separately from drafts and remain immutable.
"""
from __future__ import annotations
import copy
import hashlib
import json
import os
from pathlib import Path
import queue
import shutil
import tempfile
import threading
import time
import uuid
from contextlib import contextmanager
from jupyter_client import KernelManager
from jupyter_client.kernelspec import KernelSpecManager
from nbclient import NotebookClient
from cairn.backend import report_workspaces as drafts, revisions
from .engine import _document_notebook, _frontmatter, _json, _read_source, ReportError
from .environment import _resolve_environment, _provision_environment
from .config import load_config
from .inputs import materialize

def digest(value):
    return hashlib.sha256(_json(value).encode()).hexdigest()


def display_outputs(outputs):
    result = []
    for output in outputs:
        kind = output.get("output_type")
        if kind == "stream":
            result.append({"type":"stream","name":output.get("name","stdout"),"text":output.get("text","")})
        elif kind == "error":
            result.append({"type":"error","name":output.get("ename","Error"),"message":output.get("evalue","")})
        else:
            result.append({"type":"display","data":dict(output.get("data",{}))})
    return result


def cells_for(root, entry, draft_id, source_ref):
    info = {"entry":entry,"source_ref":source_ref}
    config, mapped = _read_source(root, info.get("entry", "report.md"))
    notebook, _ = _document_notebook(mapped, config, {}, capture_cards=False)
    cells, counters = [], {}
    entry = info.get("entry", "report.md")
    entry_raw = (root / entry).read_text()
    entry_lines = entry_raw.splitlines(keepends=True)
    if entry_lines and entry_lines[0].strip() == "---":
        closing = next((index for index,line in enumerate(entry_lines[1:],1) if line.strip() == "---"), None)
        if closing is not None:
            source = "".join(entry_lines[1:closing])
            cells.append({"id":"metadata-"+digest(entry)[:20],"index":0,"type":"metadata","source":source,
                          "file":entry,"line":1,"end_line":closing+1,"hash":hashlib.sha256(entry_raw.encode()).hexdigest(),
                          "source_hash":digest(source),"outputs":[],"status":"idle","execution_count":None})
    for cell in notebook.cells:
        origin = cell.metadata.get("cairn", {})
        if origin.get("bootstrap"):
            continue
        file = origin["file"]
        raw = (root / file).read_text()
        lines = raw.splitlines(keepends=True)
        start, end = origin["line"] - 1, origin["end_line"]
        kind = "card" if origin.get("kind") == "card" else cell.cell_type
        spans=[]
        if kind == "markdown":
            segment=start
            for position in range(start,end):
                if lines[position].strip() == "<!-- cairn:cell -->":
                    spans.append((segment,position))
                    segment=position+1
            spans.append((segment,end))
        else:
            spans=[(start,end)]
        for start,end in spans:
            source = "".join(lines[start + 1:end - 1]) if kind in {"code", "card"} else "".join(lines[start:end])
            if kind == "markdown" and not source.strip():
                continue
            index = counters.get(file, 0)
            counters[file] = index + 1
            # Stable across text edits; structural insertion reindexes this file.
            identity = "cell-" + digest([file, index])[:20]
            cells.append({"id":identity,"index":len(cells),"type":kind,"source":source,"file":file,
                          "line":start+1,"end_line":end,"hash":hashlib.sha256(raw.encode()).hexdigest(),
                          "source_hash":digest(source),"outputs":[],"status":"idle","execution_count":None})
    return {"draft_id":draft_id,"source_ref":info["source_ref"],"entry":entry,
            "hash":hashlib.sha256(entry_raw.encode()).hexdigest(),"cells":cells,
            "declaration_key":digest({key:config.get(key) for key in ("environment","inputs","parameters","execute")})}



class NotebookManager:
    def __init__(self, storage):
        self.storage=storage
        self.db,self.blobs,self.directory=storage.open()
        self.lock=threading.RLock()
        self.sessions={}
        self.maximum=max(1,min(8,int(os.getenv('CAIRN_NOTEBOOK_KERNELS','4'))))
        self.idle_seconds=max(30,int(os.getenv('CAIRN_NOTEBOOK_IDLE_SECONDS','600')))
        self.owner=uuid.uuid4().hex
        from .cache import implementation_hash
        self.implementation_hash=implementation_hash()

    def _record(self, kind, ident, value):
        with self.db.transaction(immediate=True):
            self.db.lock_resource(kind,ident)
            revisions.record(self.db,kind,ident,value)

    def _head(self, kind, ident):
        row=self.db.read_one('SELECT payload FROM resource_heads WHERE kind=? AND id=?',[kind,ident])
        return json.loads(row[0]) if row else None

    @contextmanager
    def _source(self, ident, row=None):
        row=row or drafts._row(self.db,ident)
        with tempfile.TemporaryDirectory(prefix='cairn-cells-') as tmp:
            root=Path(tmp)
            for name,info in row['files'].items():
                path=root/drafts._path(name);path.parent.mkdir(parents=True,exist_ok=True)
                raw=self.blobs.get(info['hash'])
                if hashlib.sha256(raw).hexdigest()!=info['hash']: raise ValueError('Source checksum mismatch')
                path.write_bytes(raw)
            entry=drafts._validate(row['files'])
            view=cells_for(root,entry,ident,'workspace:'+ident+':'+str(row['revision']))
            view['revision']=row['revision']
            yield root,row,view

    def notebook(self, ident):
        with self._source(ident) as (_,row,result):
            latest=self._head('notebook-latest',ident)
            if latest:
                old={cell['id']:cell for cell in latest['cells']}
                stale=latest.get('declaration_key')!=result['declaration_key']
                for cell in result['cells']:
                    saved=old.get(cell['id'])
                    if cell['type']=='code' and (not saved or saved['source_hash']!=cell['source_hash']): stale=True
                    if saved and saved['source_hash']==cell['source_hash']:
                        cell.update({key:saved[key] for key in ('outputs','status','execution_count','cache_key') if key in saved})
                        if stale and cell['outputs']: cell['status']='stale'
            return result

    def _idle(self, ident):
        session=self.sessions.get(ident)
        if session and session.busy: raise drafts.Conflict('A notebook cell is running; wait before editing cells')
        active=self._head('notebook-active',ident)
        job=self._head('notebook-job',active['job_id']) if active else None
        if job and job['state'] in {'queued','running'} and job.get('lease_until',0)>time.time():
            raise drafts.Conflict('A notebook cell is running; wait before editing cells')

    def _write(self, ident, file, content, expected_hash, revision):
        # Validate the whole candidate source, including its included files.
        row=drafts._row(self.db,ident)
        if row['files'].get(file,{}).get('hash')!=expected_hash: raise drafts.Conflict('Source changed since this cell was opened')
        raw=content.encode()
        if len(raw)>drafts.MAX_BYTES: raise ValueError('Source exceeds 32 MiB')
        h,size=self.blobs.put(raw);candidate={**row,'files':{**row['files'],file:{'hash':h,'size':size}}}
        with self._source(ident,candidate): pass
        drafts.update(self.db,self.blobs,ident,files={file:content},expected_revision=revision)
        return self.notebook(ident)

    def edit(self, ident, cell_id, source, expected_hash):
        if not isinstance(source,str) or len(source.encode())>2*1024*1024: raise ValueError('Cell source must be text up to 2 MiB')
        with self.lock,self.db.transaction(immediate=True):
            self.db.lock_resource('report-workspace',ident);self._idle(ident)
            with self._source(ident) as (root,row,view):
                cell=next((c for c in view['cells'] if c['id']==cell_id),None)
                if cell is None: raise drafts.Conflict('Cell no longer exists; reload the notebook')
                lines=(root/cell['file']).read_text().splitlines(keepends=True)
                start,end=cell['line']-1,cell['end_line']
                if cell['type'] in {'code','card','metadata'}: start+=1;end-=1
                content=''.join(lines[:start])+source+('\n' if source and not source.endswith('\n') else '')+''.join(lines[end:])
                return self._write(ident,cell['file'],content,expected_hash,row['revision'])

    def insert(self, ident, kind, source, after_id, expected_hash):
        if kind not in {'code','markdown','card'} or not isinstance(source,str) or len(source.encode())>2*1024*1024: raise ValueError('New cell requires code/markdown/card and source up to 2 MiB')
        with self.lock,self.db.transaction(immediate=True):
            self.db.lock_resource('report-workspace',ident);self._idle(ident)
            with self._source(ident) as (root,row,view):
                anchor=next((c for c in view['cells'] if c['id']==after_id),None)
                if after_id and anchor is None: raise drafts.Conflict('Insertion anchor changed; reload the notebook')
                file=anchor['file'] if anchor else view['entry']
                lines=(root/file).read_text().splitlines(keepends=True);position=anchor['end_line'] if anchor else len(lines)
                body=source.rstrip('\n')+'\n'
                if kind in {'code','card'}: body='```{'+('python' if kind=='code' else 'card')+'}\n'+body+'```\n'
                else: body='<!-- cairn:cell -->\n'+body+'<!-- cairn:cell -->\n'
                content=''.join(lines[:position]).rstrip('\n')+'\n\n'+body+'\n'+''.join(lines[position:])
                return self._write(ident,file,content,expected_hash,row['revision'])

    def delete(self, ident, cell_id, expected_hash):
        with self.lock,self.db.transaction(immediate=True):
            self.db.lock_resource('report-workspace',ident);self._idle(ident)
            with self._source(ident) as (root,row,view):
                cell=next((c for c in view['cells'] if c['id']==cell_id),None)
                if cell is None or cell['type']=='metadata': raise ValueError('Choose an existing content cell to delete')
                lines=(root/cell['file']).read_text().splitlines(keepends=True)
                return self._write(ident,cell['file'],''.join(lines[:cell['line']-1]+lines[cell['end_line']:]),expected_hash,row['revision'])

    def submit(self, ident, cell_id, force=False):
        if type(force) is not bool: raise ValueError('force must be boolean')
        with self.lock:
            self._idle(ident)
            row=drafts._row(self.db,ident)
            with self._source(ident,row) as (root,_,view):
                target=next((c for c in view['cells'] if c['id']==cell_id),None)
                if not target or target['type']!='code': raise ValueError('Choose a Python cell to execute')
                config,_=_read_source(root,view['entry'])
                environment,lock=_resolve_environment(config.get('environment'))
                lock_hash,_=self.blobs.put(lock)
                captured={'environment':environment,'lock_hash':lock_hash,'inputs':{},'files':row['files']}
                destination=load_config(root,repo=self.storage,namespace=row['project_id'])
                for role,ref in config.get('inputs',{}).items():
                    item=materialize(ref,destination);files={}
                    for path in item['path'].rglob('*'):
                        if path.is_file():
                            h,size=self.blobs.put(path.read_bytes());files[path.relative_to(item['path']).as_posix()]={'hash':h,'size':size}
                    captured['inputs'][role]={**{k:v for k,v in item.items() if k!='path'},'files':files}
            session=self.sessions.get(ident)
            if session is None or session.stopped:
                live=[s for s in self.sessions.values() if not s.stopped]
                if len(live)>=self.maximum:
                    idle=[s for s in live if not s.busy]
                    if not idle: raise drafts.Conflict('All notebook kernels are busy; try again shortly')
                    min(idle,key=lambda s:s.activity).close()
                session=KernelSession(self,ident);self.sessions[ident]=session
            job={'id':uuid.uuid4().hex,'state':'queued','draft_id':ident,'cell_id':cell_id,'owner':self.owner,'lease_until':time.time()+60,'revision':row['revision'],'source_ref':view['source_ref'],'captured':captured}
            with self.db.transaction(immediate=True):
                self.db.lock_resource('report-workspace',ident)
                self._idle(ident)
                if drafts._row(self.db,ident)['revision']!=row['revision']: raise drafts.Conflict('Source changed while preparing execution')
                self._record('notebook-job',job['id'],job)
                self._record('notebook-active',ident,{'job_id':job['id']})
            session.busy=True;session.tasks.put((job,view,config,force))
            return {'id':job['id'],'state':'queued'}

    def job(self, ident):
        with self.db.transaction(immediate=True):
            self.db.lock_resource('notebook-job',ident)
            job=self._head('notebook-job',ident)
            if not job: raise LookupError('Notebook execution not found')
            if job['state'] in {'queued','running'} and job.get('lease_until',0)<time.time():
                job={**job,'state':'failed','error':'Notebook worker lease expired; run the cell again'}
                self._record('notebook-job',ident,job)
        return {key:value for key,value in job.items() if key not in {'captured','owner','lease_until'}}

    def close(self):
        for session in list(self.sessions.values()): session.close()
        self.db.close()


class KernelSession:
    def __init__(self, manager, ident):
        self.manager,self.ident=manager,ident
        self.tasks=queue.Queue();self.activity=time.monotonic();self.busy=False;self.stopped=False
        self.client=self.context=None;self.base=None;self.executed=[];self.completed={}
        self.root=Path(tempfile.mkdtemp(prefix='cn-'))
        self.thread=threading.Thread(target=self.worker,name='cairn-notebook',daemon=True);self.thread.start()

    def close_kernel(self):
        if self.context:
            try:self.context.__exit__(None,None,None)
            except Exception:pass
        self.client=self.context=None;self.executed=[];self.completed={}

    def close(self):
        self.stopped=True
        if self.busy and self.client and self.client.km:
            try:self.client.km.interrupt_kernel()
            except Exception:pass
        self.tasks.put(None)
        if threading.current_thread()!=self.thread:self.thread.join(timeout=10)

    def worker(self):
        try:
            while not self.stopped:
                try:task=self.tasks.get(timeout=min(15,self.manager.idle_seconds))
                except queue.Empty:
                    if time.monotonic()-self.activity>self.manager.idle_seconds:break
                    continue
                if task is None:break
                job,view,config,force=task
                heartbeat_stop=threading.Event()
                def heartbeat():
                    while not heartbeat_stop.wait(10):
                        with self.manager.db.transaction(immediate=True):
                            self.manager.db.lock_resource('notebook-job',job['id'])
                            current=self.manager._head('notebook-job',job['id'])
                            if not current or current.get('owner')!=self.manager.owner or current['state'] not in {'queued','running'}:return
                            self.manager._record('notebook-job',job['id'],{**current,'lease_until':time.time()+60})
                heart=threading.Thread(target=heartbeat,name='cairn-notebook-lease',daemon=True);heart.start()
                try:self.execute(job,view,config,force)
                except Exception as error:
                    self.manager._record('notebook-job',job['id'],{**job,'state':'failed','error':f'{type(error).__name__}: {error}'[:20000]})
                    self.close_kernel()
                finally:
                    heartbeat_stop.set();heart.join(timeout=2)
                    self.busy=False;self.activity=time.monotonic()
        finally:
            self.stopped=True;self.close_kernel();shutil.rmtree(self.root,ignore_errors=True)

    @staticmethod
    def merge(cell,saved):
        if saved and saved['source_hash']==cell['source_hash']:
            return {**cell,**{key:saved[key] for key in ('outputs','status','execution_count','cache_key') if key in saved}}
        return cell

    def execute(self, job, view, config, force):
        manager=self.manager;captured=job['captured']
        manager._record('notebook-job',job['id'],{**job,'state':'running'})
        source_files={c['file'] for c in view['cells']}
        base=digest({'implementation':manager.implementation_hash,'environment':captured['environment'],'lock':captured['lock_hash'],'inputs':captured['inputs'],
                     'parameters':config.get('parameters',{}),'execute':config.get('execute',{}),
                     'files':{name:info['hash'] for name,info in captured['files'].items() if name not in source_files}})
        target=next(i for i,c in enumerate(view['cells']) if c['id']==job['cell_id'])
        prefix=[c for c in view['cells'][:target+1] if c['type']=='code']
        keys=[digest([base,c['id'],c['source']]) for c in prefix]
        cache_key=digest([base,keys]);cached=manager._head('notebook-cache',cache_key)
        if cached and not force:
            saved={c['id']:c for c in cached['cells']}
            result={**view,'cells':[self.merge(c,saved.get(c['id'])) for c in view['cells']], 'cache_hit':True,'reused_cells':0,'cached_execution':cached['execution_ref']}
            self.finish(job,result,cache_key);return
        if force or self.base!=base or self.executed!=keys[:len(self.executed)] or len(self.executed)>=len(keys):
            self.close_kernel();self.base=base;shutil.rmtree(self.root,ignore_errors=True);self.root.mkdir()
        def write_files(files,destination):
            for name,info in files.items():
                path=destination/drafts._path(name);path.parent.mkdir(parents=True,exist_ok=True)
                data=manager.blobs.get(info['hash'])
                if hashlib.sha256(data).hexdigest()!=info['hash']:raise ValueError('Notebook captured-file checksum mismatch')
                path.write_bytes(data)
        write_files(captured['files'],self.root)
        input_paths={};input_info={}
        for role,item in captured['inputs'].items():
            destination=self.root/'.cairn-inputs'/role;write_files(item['files'],destination)
            input_paths[role]=str(destination)
            metadata={}
            for name in ('summary','config'):
                path=destination/(name+'.json')
                if path.is_file():metadata[name]=json.loads(path.read_text())
            input_info[role]={'ref':item['resolved'],'metadata':metadata}
        _,mapped=_read_source(self.root,view['entry'])
        notebook,_=_document_notebook(mapped,config,input_paths,input_info,capture_cards=False)
        if self.client is None:
            executable=_provision_environment(captured['environment'],manager.blobs.get(captured['lock_hash']))
            if self.stopped: raise RuntimeError('Notebook execution cancelled')
            directory=self.root/'.cairn-kernels'/'cairn';directory.mkdir(parents=True,exist_ok=True)
            (directory/'kernel.json').write_text(_json({'argv':[str(executable),'-m','ipykernel_launcher','-f','{connection_file}'],'display_name':'Cairn notebook','language':'python'}))
            kernel=KernelManager(kernel_name='cairn',connection_file=str(self.root/'connection.json'),kernel_spec_manager=KernelSpecManager(kernel_dirs=[str(directory.parent)]))
            self.client=NotebookClient(notebook,km=kernel,timeout=min(600,int(config.get('execute',{}).get('timeout',120))),resources={'metadata':{'path':str(self.root)}},record_timing=False)
            self.context=self.client.setup_kernel(cleanup_kc=True);self.context.__enter__();self.client.execute_cell(notebook.cells[0],0)
        else:self.client.nb=notebook
        code_indices=[i for i,c in enumerate(notebook.cells) if c.cell_type=='code' and not c.metadata.get('cairn',{}).get('bootstrap')]
        reused=len(self.executed);error=None
        for position in range(reused,len(prefix)):
            if self.stopped: raise RuntimeError('Notebook execution cancelled')
            index=code_indices[position];cell=notebook.cells[index]
            try:
                if cell.metadata.get('cairn',{}).get('options',{}).get('eval',True) and config.get('execute',{}).get('enabled',True):
                    self.client.execute_cell(cell,index,execution_count=position+1)
            except Exception as failure:error=f'{type(failure).__name__}: {failure}'[:20000]
            result_cell={**prefix[position],'outputs':display_outputs(cell.get('outputs',[])),'status':'failed' if error else 'finished','execution_count':cell.get('execution_count'),'cache_key':cache_key}
            self.completed[result_cell['id']]=result_cell
            if error:break
            self.executed.append(keys[position])
        result={**view,'cells':[self.merge(c,self.completed.get(c['id'])) for c in view['cells']],'cache_hit':False,'reused_cells':reused}
        if error:result['error']=error
        self.finish(job,result,cache_key,failed=bool(error))
        if error:self.close_kernel()

    def finish(self,job,result,cache_key,failed=False):
        result={**result,'execution_ref':'notebook:'+job['id'],'environment_hash':digest(job['captured']['environment']),
                'source_ref':job['source_ref'],'cache_key':cache_key,'hermetic':False}
        with self.manager.db.transaction(immediate=True):
            self.manager.db.lock_resource('notebook-job',job['id'])
            current=self.manager._head('notebook-job',job['id'])
            if not current or current['state']!='running' or current.get('owner')!=self.manager.owner:
                raise drafts.Conflict('Notebook execution lost its lease; outputs were not adopted')
            self.manager._record('notebook-job',job['id'],{**job,**result,'state':'failed' if failed else 'finished'})
        self.manager._record('notebook-latest',self.ident,result)
        if not failed:self.manager._record('notebook-cache',cache_key,result)
