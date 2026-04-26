import{u as W,b as z,r as a,s as A,l as o,C as G,v as Y,e as T}from"./index-CdeCvAko.js";const K={version:1},$="https://cdn.jsdelivr.net/pyodide/v0.27.0/full/",B=new Map;async function X(r){const s=B.get(r);if(s)return s;const y=await fetch(T.artifactUrl(r));if(!y.ok)throw new Error(`Failed to fetch plugin source: ${y.status}`);const v=await y.text();return B.set(r,v),v}async function Q(r){const s=await fetch(T.artifactUrl(r));if(!s.ok)throw new Error(`Failed to fetch artifact: ${s.status}`);return s.arrayBuffer()}function V(r){return`<!DOCTYPE html>
<html><head>
<style>
  body { margin: 0; background: transparent; color: #c9d1d9; font-family: system-ui; }
  canvas { display: block; }
</style>
</head><body>
<script>
window.cairn = {};
window.addEventListener("message", function(e) {
  if (e.data && e.data.type === "cairn:render" && window.cairn.render) {
    try { window.cairn.render(e.data); }
    catch(err) { document.body.innerHTML = '<pre style="color:#f85149;padding:8px">Plugin error: ' + err.message + '</pre>'; }
  }
});
new ResizeObserver(function() {
  parent.postMessage({ type: "cairn:resize", height: document.documentElement.scrollHeight }, "*");
}).observe(document.body);
${r}
<\/script>
</body></html>`}function Z(r){const s=r.replace(/\\/g,"\\\\").replace(/`/g,"\\`").replace(/\$/g,"\\$");return`<!DOCTYPE html>
<html><head>
<style>
  body { margin: 0; background: transparent; color: #c9d1d9; font-family: system-ui; }
  #status { padding: 12px; font-size: 12px; color: #8b949e; }
  .spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid #0969da;
    border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head><body>
<div id="status"><span class="spinner"></span> Loading Pyodide...</div>
<div id="output"></div>
<script src="https://cdn.plot.ly/plotly-2.35.2.min.js" charset="utf-8"><\/script>
<script src="${$}pyodide.js"><\/script>
<script>
const PLUGIN_SOURCE = \`${s}\`;

// Parse cairn-requires comment.
function parseRequires(src) {
  const m = src.match(/^#\\s*cairn-requires:\\s*(.+)$/m);
  return m ? m[1].split(",").map(s => s.trim()).filter(Boolean) : [];
}

let pyodide = null;
let pendingMsg = null;

async function initPyodide() {
  const status = document.getElementById("status");
  try {
    pyodide = await loadPyodide({ indexURL: "${$}" });
    status.textContent = "Installing packages...";
    await pyodide.loadPackage("micropip");
    const micropip = pyodide.pyimport("micropip");
    const reqs = parseRequires(PLUGIN_SOURCE);
    for (const pkg of reqs) {
      await micropip.install(pkg);
    }
    // Force webagg backend for matplotlib (the default in Pyodide v0.27+
    // still tries matplotlib_pyodide which may fail to import).
    if (reqs.some(r => r === "matplotlib")) {
      pyodide.runPython("import matplotlib; matplotlib.use('webagg')");
    }
    // Define stub base classes so plugin source that imports from cairn works.
    pyodide.runPython(\`
class _TypeWrapper:
    object_type = ""
    def __init__(self, obj=None, **kwargs):
        self.obj = obj
        self.kwargs = kwargs

class _PluginBase(_TypeWrapper):
    object_type = "plugin"
    name = ""

class JSPlugin(_PluginBase): pass
class PythonPlugin(_PluginBase):
    requires = []
    def render(self, data, metadata, step): raise NotImplementedError
class ServerPlugin(_PluginBase):
    def render(self, data, metadata, step): raise NotImplementedError
    def on_mouse(self, event): pass
    def on_key(self, event): pass

# Make stubs importable as if from cairn
import types as _t
cairn = _t.ModuleType("cairn")
cairn.JSPlugin = JSPlugin
cairn.PythonPlugin = PythonPlugin
cairn.ServerPlugin = ServerPlugin
cairn._PluginBase = _PluginBase
import sys as _sys
_sys.modules["cairn"] = cairn
\`);
    status.textContent = "Running plugin...";
    pyodide.runPython(PLUGIN_SOURCE);
    status.style.display = "none";
    // Process any message that arrived while loading.
    if (pendingMsg) { handleRender(pendingMsg); pendingMsg = null; }
  } catch(err) {
    status.innerHTML = '<pre style="color:#f85149">Pyodide error: ' + err.message + '</pre>';
  }
}

function handleRender(msg) {
  if (!pyodide) { pendingMsg = msg; return; }
  try {
    document.getElementById("output").innerHTML = "";
    const dataBytes = new Uint8Array(msg.data);
    var result;

    // Try class-based plugin first (look for a class with a render method).
    // Find plugin class: look for a PythonPlugin subclass in globals.
    var cls = null;
    try {
      cls = pyodide.runPython(\`
_found = None
for _name, _obj in list(globals().items()):
    if isinstance(_obj, type) and issubclass(_obj, PythonPlugin) and _obj is not PythonPlugin:
        _found = _obj
        break
_found
\`);
    } catch(e) { /* ignore */ }

    // Class-based: instantiate and call render().
    if (cls) {
      try {
        var instance = cls.__call__();
        result = instance.render(pyodide.toPy(dataBytes), pyodide.toPy(msg.metadata), msg.step);
      } catch(e) {
        cls = null;
      }
    }
    // Legacy: bare render() function.
    if (!cls) {
      var renderFn = pyodide.globals.get("render");
      if (!renderFn) {
        document.getElementById("output").innerHTML = '<pre style="color:#f85149">Plugin has no render() function or class</pre>';
        return;
      }
      result = renderFn(
        pyodide.toPy(dataBytes),
        pyodide.toPy(msg.metadata),
        msg.step,
        msg.runId,
        msg.metricName,
      );
    }
    // If render() returns a string, inject as HTML with script execution.
    const html = (typeof result === "string") ? result :
                 (result && result.toString && result.toString() !== "None") ? result.toString() : null;
    if (html) {
      var outEl = document.getElementById("output");
      outEl.innerHTML = "";
      // Use Range.createContextualFragment to execute inline/CDN scripts.
      var range = document.createRange();
      range.selectNode(outEl);
      outEl.appendChild(range.createContextualFragment(html));
    }
    // Notify parent of new size after a short delay (matplotlib canvas may
    // need a frame to render).
    setTimeout(function() {
      parent.postMessage({ type: "cairn:resize", height: document.documentElement.scrollHeight }, "*");
    }, 100);
  } catch(err) {
    document.getElementById("output").innerHTML = '<pre style="color:#f85149">Render error: ' + err.message + '</pre>';
  }
}

window.addEventListener("message", function(e) {
  if (e.data && e.data.type === "cairn:render") handleRender(e.data);
});

initPyodide();
<\/script>
</body></html>`}function te({runId:r,metric:s,settingsKeyOverride:y,onRemove:v}){const[c,f]=W(y??{runId:r,metricName:s.name,contextHash:s.context_hash},K),E=z(r,s.name,{context:s.context_hash||void 0,maxPoints:200}),b=a.useMemo(()=>{var e;return(((e=E.data)==null?void 0:e.points)??[]).filter(t=>t.artifact_hash)},[E.data]),h=a.useMemo(()=>{const e=new Set;for(const t of b)e.add(t.step);return Array.from(e).sort((t,n)=>t-n)},[b]),[H,I]=a.useState(c.sliderStep??0),_=Math.min(Math.max(0,H),Math.max(0,h.length-1)),m=h[_]??0,i=a.useMemo(()=>b.find(e=>e.step===m)??b[0],[b,m]),l=a.useMemo(()=>A((i==null?void 0:i.artifact_metadata)??null)??{},[i]),S=a.useRef(null),[O,F]=a.useState(300),[M,x]=a.useState(null),[R,N]=a.useState(!1),C=a.useRef("");a.useEffect(()=>()=>{w.current&&URL.revokeObjectURL(w.current)},[]),a.useEffect(()=>{const e=t=>{var n;((n=t.data)==null?void 0:n.type)==="cairn:resize"&&typeof t.data.height=="number"&&F(Math.max(100,Math.min(2e3,t.data.height)))};return window.addEventListener("message",e),()=>window.removeEventListener("message",e)},[]);const u=l.plugin_lang??"js",j=a.useRef(null),[k,D]=a.useState(null);a.useEffect(()=>{if(u!=="server"||!(i!=null&&i.artifact_hash)||!l.plugin_hash)return;const t=`${window.location.protocol==="https:"?"wss:":"ws:"}//${window.location.host}/ws/plugin/${r}/${encodeURIComponent(s.name)}`,n=new WebSocket(t);j.current=n,n.onopen=()=>{n.send(JSON.stringify({type:"render",artifact_hash:i.artifact_hash,metadata:l,step:m}))};let d="";return n.onmessage=p=>{if(typeof p.data=="string"){const g=JSON.parse(p.data);g.type==="frame"?d=g.mime||"image/png":g.type==="error"&&x(g.message)}else if(p.data instanceof Blob){const g=new Blob([p.data],{type:d}),J=URL.createObjectURL(g);D(U=>(U&&URL.revokeObjectURL(U),J))}},n.onerror=()=>x("WebSocket connection failed"),()=>{n.close(),j.current=null}},[u,i,l,m,r,s.name]);const P=a.useCallback((e,t)=>{const n=j.current;if(!n||n.readyState!==WebSocket.OPEN)return;const d=t.target.getBoundingClientRect();n.send(JSON.stringify({type:"mouse",x:Math.round(t.clientX-d.left),y:Math.round(t.clientY-d.top),button:t.button,action:e}))},[]),w=a.useRef(""),L=a.useCallback(async()=>{if(u!=="server"&&l.plugin_hash){x(null);try{const e=await X(l.plugin_hash),t=S.current;if(!t)return;const n=`${l.plugin_hash}:${u}`;if(C.current!==n){if(C.current=n,N(!1),u==="js")t.removeAttribute("src"),t.srcdoc=V(e);else{t.removeAttribute("srcdoc"),w.current&&URL.revokeObjectURL(w.current);const d=Z(e),p=new Blob([d],{type:"text/html"}),g=URL.createObjectURL(p);w.current=g,t.src=g}await new Promise(d=>{t.onload=()=>d()}),N(!0)}}catch(e){x(e instanceof Error?e.message:String(e))}}},[l.plugin_hash,u]);a.useEffect(()=>{L()},[L]),a.useEffect(()=>{if(!R||!(i!=null&&i.artifact_hash))return;const e=S.current;if(!(e!=null&&e.contentWindow))return;let t=!1;return Q(i.artifact_hash).then(n=>{var p;if(t)return;const d=n.slice(0);(p=e.contentWindow)==null||p.postMessage({type:"cairn:render",data:d,metadata:l,step:m,runId:r,metricName:s.name},"*",[d])}).catch(n=>{t||x(n instanceof Error?n.message:String(n))}),()=>{t=!0}},[R,i,l,m,r,s.name]);const q=h.length>0?`step ${m} (${_+1}/${h.length})`:l.plugin_name??"plugin";return o.jsxs("div",{className:"card p-4 flex flex-col",style:{position:"relative",height:c.collapsed?void 0:c.height??400,gridColumn:(c.colSpan??1)>1?`span ${c.colSpan}`:void 0},children:[o.jsx(G,{title:c.title??s.name,onTitleChange:e=>f({title:e||void 0}),subtitle:q,collapsed:c.collapsed,onToggleCollapse:()=>f({collapsed:!c.collapsed}),onToggleFullWidth:()=>f({colSpan:(c.colSpan??1)>1?1:2}),isFullWidth:(c.colSpan??1)>1,onRemove:v,children:o.jsx("span",{className:"inline-flex items-center rounded bg-bg-hover px-1.5 py-0.5 text-[10px] text-fg-muted",children:u==="server"?"Server":u==="py"?"Python":"JS"})}),!c.collapsed&&o.jsxs(o.Fragment,{children:[M?o.jsx("div",{className:"flex-1 rounded bg-bg p-3 text-xs text-status-failed overflow-auto",children:o.jsx("pre",{children:M})}):l.plugin_hash?u==="server"?k?o.jsx("img",{src:k,alt:`Server plugin: ${l.plugin_name??s.name}`,className:"flex-1 w-full rounded object-contain cursor-grab active:cursor-grabbing",style:{minHeight:200,userSelect:"none"},draggable:!1,onMouseDown:e=>{e.preventDefault(),P("down",e)},onMouseMove:e=>P("move",e),onMouseUp:e=>P("up",e),onMouseLeave:e=>P("up",e)}):o.jsxs("div",{className:"flex-1 flex items-center justify-center",children:[o.jsx("div",{className:"h-8 w-8 motion-safe:animate-spin rounded-full border-2 border-accent border-t-transparent"}),o.jsx("span",{className:"ml-2 text-xs text-fg-muted",children:"Connecting to server..."})]}):o.jsx("iframe",{ref:S,...u==="js"?{sandbox:"allow-scripts"}:{},className:"flex-1 w-full rounded border-0",style:{height:O,minHeight:200},title:`Plugin: ${l.plugin_name??s.name}`}):o.jsx("div",{className:"flex-1 flex items-center justify-center text-sm text-fg-muted",children:"No plugin metadata found"}),h.length>1&&o.jsx("input",{type:"range",min:0,max:h.length-1,value:_,onChange:e=>{const t=Number(e.target.value);I(t),f({sliderStep:t})},className:"mt-3 w-full accent-accent"})]}),o.jsx(Y,{height:c.height,onHeightChange:e=>f({height:e}),colSpan:c.colSpan??1,onColSpanChange:e=>f({colSpan:e})})]})}export{te as default};
