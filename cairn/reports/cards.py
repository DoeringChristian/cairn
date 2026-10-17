"""Report cards capture inputs once and share one HTML representation everywhere.

Custom viewers use the same cairn:sdk runtime and module rewrite convention as
workspace viewers. They receive captured data and files, never live repository URLs.
"""
from __future__ import annotations

import base64
import fnmatch
import html
import json
import math
from pathlib import Path, PurePosixPath
import posixpath
import re
import time

from .engine import ReportError, _json, _safe_path, _file_hash

_TYPES = {'line', 'scatter', 'bar', 'histogram', 'table', 'scalar', 'custom'}
_IMPORT = re.compile(r'''(\bfrom\s*|\bimport\s*|\bimport\s*\(\s*)(["'])([^"'\n\r]+)\2''')
_VIRTUAL = 'cairn-viewer:/'
_TEMPLATE = Path(__file__).with_name('template')


def validate_card(value):
    if not isinstance(value, dict) or not isinstance(value.get('type'),str) or value['type'] not in _TYPES:
        raise ReportError('Card type must be line, scatter, bar, histogram, table, scalar or custom')
    allowed = {'type','title','caption','label','inputs','metric','x','legend','xLog','yLog','height','bins','viewer','settings','view','expression','xExpression','groupBy','smoothing'}
    unknown = set(value) - allowed
    if unknown:
        raise ReportError('Unsupported card options: '+', '.join(sorted(unknown, key=str)))
    if len(_json(value)) > 100_000:
        raise ReportError('Card declaration exceeds 100 KiB')
    for key in ('title','caption','label','metric','x','viewer','expression','xExpression','groupBy'):
        if key in value and not isinstance(value[key], str):
            raise ReportError(f'Card {key} must be text')
    for key in ('legend','xLog','yLog'):
        if key in value and not isinstance(value[key], bool):
            raise ReportError(f'Card {key} must be true or false')
    if not _number(value.get('smoothing',0)) or not 0 <= value.get('smoothing',0) < 1:
        raise ReportError('Card smoothing must be a number from 0 (inclusive) to 1 (exclusive)')
    if type(value.get('height',360)) is not int or not 120 <= value.get('height',360) <= 1200:
        raise ReportError('Card height must be an integer between 120 and 1200')
    if type(value.get('bins',20)) is not int or not 1 <= value.get('bins',20) <= 500:
        raise ReportError('Card bins must be an integer between 1 and 500')
    if not isinstance(value.get('inputs'),list) or not 1 <= len(value['inputs']) <= 20:
        raise ReportError('Card inputs must contain 1–20 declared input roles')
    return value


def _folder(role, paths):
    if not isinstance(role,str) or role not in paths:
        raise ReportError(f'Card input {role!r} must name a declared report input')
    return Path(paths[role])


def _number(value):
    return isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value)


MAX_SCAN_RECORDS = 500_000
MAX_SCAN_BYTES = 64 * 1024 * 1024
MAX_SCAN_SECONDS = 8
MAX_POINTS = 1200


def _field(record, path):
    for key in path.split('.'):
        record = record.get(key) if isinstance(record,dict) else None
    return record


def _metric_rows(value, paths):
    from .expressions import Expression
    metric=value.get('metric',value.get('expression'))
    if not isinstance(metric,str) or not metric:
        raise ReportError('Numeric cards require a metric or expression')
    expression=Expression(value['expression']) if value.get('expression') else None
    x_expression=Expression(value['xExpression']) if value.get('xExpression') else None
    rows=[];scanned=0;scanned_bytes=0;started=time.monotonic()
    for role in value['inputs']:
        folder=_folder(role,paths)
        def document(name):
            path=folder/name
            if not path.is_file(): return {}
            if path.stat().st_size > MAX_SCAN_BYTES: raise ReportError('Card metadata exceeds scan limit')
            return json.loads(path.read_text())
        run=document('run.json');run=run.get('run',run)
        summary=document('summary.json');config=document('config.json')
        points=[]
        if metric.startswith('summary.') and expression is None and x_expression is None:
            observation=_field(summary,metric.removeprefix('summary.'))
            if _number(observation): points=[{'x':0,'y':observation}]
        else:
            records={}
            path=folder/'metrics.jsonl'
            if path.stat().st_size + scanned_bytes > MAX_SCAN_BYTES:
                raise ReportError('Card metric scan exceeds 64 MiB')
            with path.open('rb') as stream:
                for line in stream:
                    scanned+=1;scanned_bytes+=len(line)
                    if scanned > MAX_SCAN_RECORDS or scanned_bytes > MAX_SCAN_BYTES or time.monotonic()-started > MAX_SCAN_SECONDS:
                        raise ReportError('Card metric scan limit exceeded; reduce captured inputs')
                    event=json.loads(line)
                    step=event.get('step')
                    if not _number(step): continue
                    record=records.setdefault(step,{'step':step})
                    record[event['name']]=event.get('value')
            for step,record in sorted(records.items()):
                context={**record,'record':record,'metrics':record,'config':config,'summary':summary,'run':run}
                x=x_expression(context) if x_expression else record.get(value.get('x','step'))
                y=expression(context) if expression else record.get(metric)
                if _number(x) and _number(y): points.append({'x':x,'y':y})
        group=value.get('groupBy')
        metadata={'config':config,'summary':summary,'run':run,**run}
        group_value=_field(metadata,group) if group else None
        name=run.get('display_name') or run.get('name') or role
        rows.append({'role':role,'name':name,'group':group_value,'points':points})
    for row in rows:
        last=None;weight=value.get('smoothing',0)
        for point in row['points']:
            last=point['y'] if last is None else weight*last+(1-weight)*point['y']
            point['y']=last
    # Grouping pools observations at equal x coordinates (no interpolation).
    if value.get('groupBy'):
        grouped={}
        for row in rows:
            key=_json(row['group'])
            group=grouped.setdefault(key,{'role':row['role'],'name':str(row['group']) if row['group'] is not None else '(missing)','group':row['group'],'members':[],'values':{}})
            group['members'].append(row['role'])
            for p in row['points']: group['values'].setdefault(p['x'],[]).append(p['y'])
        rows=[]
        for group in grouped.values():
            values=group.pop('values')
            group['points']=[]
            for x,ys in sorted(values.items()):
                mean=sum(ys)/len(ys);std=math.sqrt(sum((y-mean)**2 for y in ys)/len(ys))
                group['points'].append({'x':x,'y':mean,'low':mean-std,'high':mean+std})
            rows.append(group)
    for row in rows:
        points=row['points']
        row['observations']=len(points)
        row['downsampled']=len(points)>MAX_POINTS
        if row['downsampled']:
            row['points']=[points[round(i*(len(points)-1)/(MAX_POINTS-1))] for i in range(MAX_POINTS)]
    return rows


def _bundle(folder):
    from cairn.backend.viewer_manifest import validate_manifest, mime_for
    files={p.relative_to(folder).as_posix():p for p in folder.rglob('*') if p.is_file()}
    manifest=validate_manifest(json.loads((folder/'cairn-viewer.json').read_text()),files)
    imports={_VIRTUAL+name:name for name in files}
    imports['cairn:sdk']='__cairn/sdk.js'
    for name,target in manifest['imports'].items():
        if name.endswith('/'):
            imports.update({name+p[len(target):]:p for p in files if p.startswith(target)})
        else: imports[name]=target
    bundled=[]
    for name,path in files.items():
        data=path.read_bytes()
        if name.startswith('__cairn/'):
            raise ReportError('Viewer files cannot use reserved __cairn/ paths')
        if path.suffix in ('.js','.mjs','.cjs'):
            def rewrite(match):
                prefix,quote,spec=match.groups()
                if spec.startswith(('./','../','/')) and not spec.startswith('//'):
                    target=posixpath.normpath((PurePosixPath(name).parent / spec).as_posix()) if not spec.startswith('/') else spec.lstrip('/')
                    target=re.split('[?#]',target)[0]
                    if target not in files:
                        raise ReportError(f'Viewer {name} imports missing file {spec}')
                    spec=_VIRTUAL+target
                if spec not in imports:
                    raise ReportError(f'Viewer {name} imports unbundled dependency {spec}; vendor it in the viewer folder')
                return prefix+quote+spec+quote
            data=_IMPORT.sub(rewrite,data.decode()).encode()
        bundled.append({'path':name,'mime':mime_for(name),'base64':base64.b64encode(data).decode(),'hash':_file_hash(path)})
    sdk=(_TEMPLATE/'custom-sdk.js').read_bytes()
    bundled.append({'path':'__cairn/sdk.js','mime':'text/javascript','base64':base64.b64encode(sdk).decode(),'hash':_file_hash(_TEMPLATE/'custom-sdk.js')})
    return manifest,{'files':bundled,'imports':imports,'entry':_VIRTUAL+manifest['entry']}


def _custom(value, paths):
    viewer=_folder(value.get('viewer'),paths)
    manifest,bundle=_bundle(viewer)
    inputs=[]
    for binding in value['inputs']:
        if not isinstance(binding,dict) or set(binding)-{'input','path','kind','format','label','meta','step'}:
            raise ReportError('Custom card inputs require input, path, kind and format bindings')
        folder=_folder(binding.get('input'),paths)
        path=_safe_path(folder,binding.get('path',''))
        kind=binding.get('kind')
        if not isinstance(kind,str) or not any(fnmatch.fnmatchcase('custom:'+kind,accepted) or fnmatch.fnmatchcase(kind,accepted) for accepted in manifest['accepts']):
            raise ReportError(f'Viewer does not accept input kind {kind!r}')
        fmt=binding.get('format','json')
        if path.stat().st_size > 16*1024*1024:
            raise ReportError('Custom card input exceeds 16 MiB')
        if fmt=='json': data=json.loads(path.read_text())
        elif fmt=='npz':
            import numpy as np
            with np.load(path,allow_pickle=False) as arrays:
                data={key:{'data':array.ravel().tolist(),'shape':list(array.shape),'dtype':str(array.dtype)} for key in arrays.files for array in [arrays[key]]}
        else: raise ReportError('Custom report cards currently accept json or npz files')
        inputs.append({'data':data,'kind':kind,'meta':binding.get('meta',{}),'step':binding.get('step',0),
                       'label':binding.get('label',binding['input']),'path':binding['path'],'hash':_file_hash(path)})
    if manifest['inputs']=='single' and len(inputs)!=1:
        raise ReportError('This custom viewer accepts one input')
    settings={setting['key']:setting.get('default') for setting in manifest['settings']}
    supplied=value.get('settings',{})
    if not isinstance(supplied,dict) or set(supplied)-set(settings):
        raise ReportError('Custom card settings must name declared viewer settings')
    settings.update(supplied)
    return {'manifest':manifest,'bundle':bundle,'inputs':inputs,'settings':settings,'view':value.get('view')}


def _custom_html(spec):
    captured=spec['custom']
    boot=(_TEMPLATE/'custom-boot.js').read_text()
    csp="default-src 'none'; script-src blob: 'unsafe-inline'; style-src blob: 'unsafe-inline'; img-src blob: data:; font-src blob: data:; media-src blob: data:; connect-src 'none'; worker-src blob:; base-uri 'none'; form-action 'none'"
    frame='<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'+csp+'"><style>html,body{margin:0;height:100%;overflow:hidden;font:12px system-ui}canvas{display:block}</style></head><body><script>'+boot+'</script></body></html>'
    payload=_json(captured).replace('<','\\u003c')
    # The host speaks the same ready/boot/loaded/render protocol as workspace cards.
    script='''const captured=PAYLOAD;
const frame=document.querySelector('iframe'); const error=document.querySelector('.error');
const theme={mode:'light',bg:'#f5f2e9',fg:'#202621',muted:'#737b70',border:'#d9ded4',accent:'#176b5b',font:'system-ui',monoFont:'monospace'};
let loaded=false; let settings={...captured.settings};
function post(data){frame.contentWindow.postMessage({...data,v:1},'*')}
function render(){if(loaded)post({type:'cairn:render',inputs:captured.inputs,step:captured.inputs[0]?.step,settings,view:captured.view,seq:1,theme,size:{width:frame.clientWidth,height:frame.clientHeight,dpr:devicePixelRatio||1}})}
addEventListener('message',event=>{if(event.source!==frame.contentWindow)return; const d=event.data||{};
if(d.type==='cairn:ready'){post({type:'cairn:boot',...captured.bundle,files:captured.bundle.files.map(f=>({...f,data:Uint8Array.from(atob(f.base64),c=>c.charCodeAt(0)).buffer}))})}
else if(d.type==='cairn:loaded'){loaded=true;render()}
else if(d.type==='cairn:error'){error.textContent=d.message;error.hidden=false}
else if(d.type==='cairn:settings'){for(const key of Object.keys(d.patch||{})){if(key in settings)settings[key]=d.patch[key]}render()}
else if(d.type==='cairn:snapshot'){parent.postMessage({type:'cairn:card-screenshot',requestId:d.id,dataUrl:d.url,error:d.url?undefined:'Viewer did not provide a screenshot'},'*')}
});new ResizeObserver(render).observe(frame);
addEventListener('message',event=>{if(event.source!==parent)return;const d=event.data||{};
 if(d.type==='cairn:card-settings'){for(const key of Object.keys(d.patch||{})){if(key in settings)settings[key]=d.patch[key]}render()}
 if(d.type==='cairn:card-screenshot'){if(loaded)post({type:'cairn:snapshot',id:d.requestId});else parent.postMessage({type:'cairn:card-screenshot',requestId:d.requestId,error:'Viewer is still loading'},'*')}
});
'''.replace('PAYLOAD',payload)
    return '<iframe title="'+html.escape(spec['title'],quote=True)+'" sandbox="allow-scripts" style="width:100%;height:'+str(spec['height'])+'px;border:0" srcdoc="'+html.escape(frame,quote=True)+'"></iframe><pre class="error" hidden></pre><script>'+script+'</script>'


def _numeric_html(spec):
    rows=spec['data'];kind=spec['type']
    if kind in ('scalar','table'):
        body=''
        for row in rows:
            for point in row['points'][-1:] if kind=='scalar' else row['points']:
                body+=f'<tr><td>{html.escape(row["name"])}</td><td>{point["x"]:g}</td><td>{point["y"]:.6g}</td></tr>'
        return '<table><thead><tr><th>Input</th><th>Step</th><th>Value</th></tr></thead><tbody>'+body+'</tbody></table>'
    import plotly.graph_objects as go
    figure=go.Figure()
    for row in rows:
        xs=[point['x'] for point in row['points']];ys=[point['y'] for point in row['points']]
        if kind=='histogram': trace=go.Histogram(x=ys,name=row['name'],nbinsx=spec.get('bins',20))
        elif kind=='bar': trace=go.Bar(x=[row['name']],y=ys[-1:],name=row['name'])
        else: trace=go.Scatter(x=xs,y=ys,name=row['name'],mode='lines' if kind=='line' else 'markers')
        if value := row['points']:
            if 'low' in value[0] and kind in ('line','scatter'):
                trace.update(error_y={'type':'data','array':[p['high']-p['y'] for p in value],'visible':True})
        figure.add_trace(trace)
    figure.update_layout(height=spec['height'],paper_bgcolor='#f5f2e9',plot_bgcolor='#f5f2e9',font_color='#202621',
                         margin=dict(l=55,r=15,t=15,b=45),showlegend=spec.get('legend',True),colorway=['#176b5b','#9a6c43','#677a61'],
                         xaxis_title=spec.get('x','step'),yaxis_title=spec['metric'])
    if spec.get('xLog'):figure.update_xaxes(type='log')
    if spec.get('yLog'):figure.update_yaxes(type='log')
    spec['figure'] = figure.to_plotly_json()
    return figure.to_html(full_html=False,include_plotlyjs=True,config={'displayModeBar':True,'responsive':True})


_NUMERIC_CONTROLS = '''<script>
const plot=document.querySelector('.js-plotly-plot');
const original=plot?JSON.parse(JSON.stringify(plot.data)):[];
let options={};
addEventListener('message',async event=>{if(event.source!==parent)return;const d=event.data||{};
if(d.type==='cairn:card-settings'&&plot){options={...options,...d.patch};
const layout={...plot.layout}; const config={displayModeBar:options.displayModeBar??true,scrollZoom:options.scrollZoom??false,responsive:true};
if(options.showLegend!==undefined)layout.showlegend=options.showLegend;
if(options.hoverMode!==undefined)layout.hovermode=options.hoverMode;
if(options.dragMode!==undefined)layout.dragmode=options.dragMode;
if(options.xLog!==undefined)layout.xaxis={...layout.xaxis,type:options.xLog?'log':'linear'};
if(options.yLog!==undefined)layout.yaxis={...layout.yaxis,type:options.yLog?'log':'linear'};
const data=JSON.parse(JSON.stringify(original));
for(const trace of data){if(['scatter','scattergl'].includes(trace.type)&&options.webgl!==undefined)trace.type=options.webgl?'scattergl':'scatter';
if(trace.y&&Number(options.smoothing)>0){const weight=Math.max(0,Math.min(.999,Number(options.smoothing)));let last;trace.y=trace.y.map(y=>{if(typeof y!=='number')return y;last=last===undefined?y:weight*last+(1-weight)*y;return last})}}
await Plotly.react(plot,data,layout,config);
}
if(d.type==='cairn:card-screenshot'){try{let dataUrl;
if(plot)dataUrl=await Plotly.toImage(plot,{format:'png',scale:2});
else{const rows=[...document.querySelectorAll('tr')];const canvas=document.createElement('canvas');canvas.width=900;canvas.height=Math.max(60,rows.length*32+20);const ctx=canvas.getContext('2d');ctx.fillStyle='#f5f2e9';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#202621';ctx.font='14px system-ui';rows.forEach((row,i)=>[...row.children].filter(c=>!c.hidden).forEach((cell,j)=>ctx.fillText(cell.textContent,12+j*290,30+i*32,280)));dataUrl=canvas.toDataURL('image/png')}
parent.postMessage({type:'cairn:card-screenshot',requestId:d.requestId,dataUrl},'*')
}catch(error){parent.postMessage({type:'cairn:card-screenshot',requestId:d.requestId,error:String(error)},'*')}}});
</script>'''


def capture_card(declaration, input_paths):
    value=validate_card(declaration)
    spec={key:item for key,item in value.items() if key not in {'inputs','viewer','settings','view'}}
    spec.setdefault('title',value.get('metric',value.get('expression','Report card')));spec.setdefault('height',360)
    if value['type']!='custom': spec.setdefault('metric',value.get('expression'))
    if value['type']=='custom':spec['custom']=_custom(value,input_paths)
    else:spec['data']=_metric_rows(value,input_paths)
    body=_custom_html(spec) if spec['type']=='custom' else _numeric_html(spec)+_NUMERIC_CONTROLS
    spec['html']='<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#f5f2e9;color:#202621;font:14px system-ui}table{border-collapse:collapse;width:100%}td,th{padding:8px;text-align:left;border-bottom:1px solid #d9ded4}p{color:#737b70}.error{white-space:pre-wrap}.settings{padding:12px;background:#e7eee9}.settings label{display:inline-flex;gap:6px;margin-right:16px;align-items:center}</style></head><body>'+body+'</body></html>'
    return spec


def export_card(spec):
    return '<figure class="report-card"><h3>'+html.escape(spec['title'])+'</h3><iframe title="'+html.escape(spec['title'],quote=True)+'" sandbox="allow-scripts" style="width:100%;height:'+str(spec['height']+60)+'px;border:0" srcdoc="'+html.escape(spec['html'],quote=True)+'"></iframe>'+('<figcaption>'+html.escape(spec['caption'])+'</figcaption>' if spec.get('caption') else '')+'</figure>'
