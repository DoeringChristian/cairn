import{u as A,b as Y,r as a,s as G,l,C as X,v as K,e as H}from"./index-vsAl3Jcq.js";const Q={version:1},$="https://cdn.jsdelivr.net/pyodide/v0.27.0/full/",B=new Map;async function V(o){const s=B.get(o);if(s)return s;const m=await fetch(H.artifactUrl(o));if(!m.ok)throw new Error(`Failed to fetch plugin source: ${m.status}`);const y=await m.text();return B.set(o,y),y}async function Z(o){const s=await fetch(H.artifactUrl(o));if(!s.ok)throw new Error(`Failed to fetch artifact: ${s.status}`);const m=await s.arrayBuffer(),y=new Uint8Array(m),r=new TextEncoder().encode("cairn-plugin:");if(y.length>=r.length){let h=!0;for(let f=0;f<r.length;f++)if(y[f]!==r[f]){h=!1;break}if(h){const f=y.indexOf(10);if(f>0)return m.slice(f+1)}}return m}function ee(o){return`<!DOCTYPE html>
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
${o}
<\/script>
</body></html>`}function te(o){const s=o.replace(/\\/g,"\\\\").replace(/`/g,"\\`").replace(/\$/g,"\\$");return`<!DOCTYPE html>
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
</body></html>`}function se({runId:o,metric:s,settingsKeyOverride:m,onRemove:y}){const[r,h]=A(m??{runId:o,metricName:s.name,contextHash:s.context_hash},Q),f=Y(o,s.name,{context:s.context_hash||void 0,maxPoints:200}),x=a.useMemo(()=>{var e;return(((e=f.data)==null?void 0:e.points)??[]).filter(t=>t.artifact_hash)},[f.data]),w=a.useMemo(()=>{const e=new Set;for(const t of x)e.add(t.step);return Array.from(e).sort((t,n)=>t-n)},[x]),[I,O]=a.useState(r.sliderStep??0),E=Math.min(Math.max(0,I),Math.max(0,w.length-1)),b=w[E]??0,c=a.useMemo(()=>x.find(e=>e.step===b)??x[0],[x,b]),d=a.useMemo(()=>G((c==null?void 0:c.artifact_metadata)??null)??{},[c]),j=a.useRef(null),[F,W]=a.useState(300),[N,v]=a.useState(null),[C,k]=a.useState(!1),L=a.useRef("");a.useEffect(()=>()=>{P.current&&URL.revokeObjectURL(P.current)},[]),a.useEffect(()=>{const e=t=>{var n;((n=t.data)==null?void 0:n.type)==="cairn:resize"&&typeof t.data.height=="number"&&W(Math.max(100,Math.min(2e3,t.data.height)))};return window.addEventListener("message",e),()=>window.removeEventListener("message",e)},[]);const u=d.plugin_lang??"js",R=a.useRef(null),[U,D]=a.useState(null);a.useEffect(()=>{if(u!=="server"&&u!=="window"||!(c!=null&&c.artifact_hash)||!d.plugin_hash)return;const t=`${window.location.protocol==="https:"?"wss:":"ws:"}//${window.location.host}/ws/plugin/${o}/${encodeURIComponent(s.name)}`,n=new WebSocket(t);n.binaryType="blob",R.current=n,n.onopen=()=>{n.send(JSON.stringify({type:"render",artifact_hash:c.artifact_hash,metadata:d,step:b}))};let p="";return n.onmessage=i=>{if(typeof i.data=="string"){const g=JSON.parse(i.data);g.type==="frame"?p=g.mime||"image/png":g.type==="error"&&v(g.message)}else if(i.data instanceof Blob){const g=new Blob([i.data],{type:p}),M=URL.createObjectURL(g);D(S=>(S&&URL.revokeObjectURL(S),M))}},n.onerror=()=>v("WebSocket connection failed"),()=>{n.close(),R.current=null}},[u,c,d,b,o,s.name]);const _=a.useCallback((e,t)=>{const n=R.current;if(!n||n.readyState!==WebSocket.OPEN)return;const p=t.target,i=p.getBoundingClientRect(),g=p,M=g.naturalWidth||i.width,S=g.naturalHeight||i.height,J=M/i.width,z=S/i.height;n.send(JSON.stringify({type:"mouse",x:Math.round((t.clientX-i.left)*J),y:Math.round((t.clientY-i.top)*z),button:t.button,action:e}))},[]),P=a.useRef(""),T=a.useCallback(async()=>{if(!(u==="server"||u==="window")&&d.plugin_hash){v(null);try{const e=await V(d.plugin_hash),t=j.current;if(!t)return;const n=`${d.plugin_hash}:${u}`;if(L.current!==n){if(L.current=n,k(!1),u==="js")t.removeAttribute("src"),t.srcdoc=ee(e);else{t.removeAttribute("srcdoc"),P.current&&URL.revokeObjectURL(P.current);const p=te(e),i=new Blob([p],{type:"text/html"}),g=URL.createObjectURL(i);P.current=g,t.src=g}await new Promise(p=>{t.onload=()=>p()}),k(!0)}}catch(e){v(e instanceof Error?e.message:String(e))}}},[d.plugin_hash,u]);a.useEffect(()=>{T()},[T]),a.useEffect(()=>{if(!C||!(c!=null&&c.artifact_hash))return;const e=j.current;if(!(e!=null&&e.contentWindow))return;let t=!1;return Z(c.artifact_hash).then(n=>{var i;if(t)return;const p=n.slice(0);(i=e.contentWindow)==null||i.postMessage({type:"cairn:render",data:p,metadata:d,step:b,runId:o,metricName:s.name},"*",[p])}).catch(n=>{t||v(n instanceof Error?n.message:String(n))}),()=>{t=!0}},[C,c,d,b,o,s.name]);const q=w.length>0?`step ${b} (${E+1}/${w.length})`:d.plugin_name??"plugin";return l.jsxs("div",{className:"card p-4 flex flex-col",style:{position:"relative",height:r.collapsed?void 0:r.height??400,gridColumn:(r.colSpan??1)>1?`span ${r.colSpan}`:void 0},children:[l.jsx(X,{title:r.title??s.name,onTitleChange:e=>h({title:e||void 0}),subtitle:q,collapsed:r.collapsed,onToggleCollapse:()=>h({collapsed:!r.collapsed}),onToggleFullWidth:()=>h({colSpan:(r.colSpan??1)>1?1:2}),isFullWidth:(r.colSpan??1)>1,onRemove:y,children:l.jsx("span",{className:"inline-flex items-center rounded bg-bg-hover px-1.5 py-0.5 text-[10px] text-fg-muted",children:u==="window"?"Window":u==="server"?"Server":u==="py"?"Python":"JS"})}),!r.collapsed&&l.jsxs(l.Fragment,{children:[N?l.jsx("div",{className:"flex-1 rounded bg-bg p-3 text-xs text-status-failed overflow-auto",children:l.jsx("pre",{children:N})}):d.plugin_hash?u==="server"||u==="window"?U?l.jsx("img",{src:U,alt:`Server plugin: ${d.plugin_name??s.name}`,className:"flex-1 w-full rounded object-contain cursor-grab active:cursor-grabbing",style:{minHeight:200,userSelect:"none"},draggable:!1,onMouseDown:e=>{e.preventDefault(),_("down",e)},onMouseMove:e=>_("move",e),onMouseUp:e=>_("up",e),onMouseLeave:e=>_("up",e)}):l.jsxs("div",{className:"flex-1 flex items-center justify-center",children:[l.jsx("div",{className:"h-8 w-8 motion-safe:animate-spin rounded-full border-2 border-accent border-t-transparent"}),l.jsx("span",{className:"ml-2 text-xs text-fg-muted",children:"Connecting to server..."})]}):l.jsx("iframe",{ref:j,...u==="js"?{sandbox:"allow-scripts"}:{},className:"flex-1 w-full rounded border-0",style:{height:F,minHeight:200},title:`Plugin: ${d.plugin_name??s.name}`}):l.jsx("div",{className:"flex-1 flex items-center justify-center text-sm text-fg-muted",children:"No plugin metadata found"}),w.length>1&&l.jsx("input",{type:"range",min:0,max:w.length-1,value:E,onChange:e=>{const t=Number(e.target.value);O(t),h({sliderStep:t})},className:"mt-3 w-full accent-accent"})]}),l.jsx(K,{height:r.height,onHeightChange:e=>h({height:e}),colSpan:r.colSpan??1,onColSpanChange:e=>h({colSpan:e})})]})}export{se as default};
