import{u as J,b as z,r as a,s as A,l as i,C as G,v as Y,e as B}from"./index-CLcQhKu-.js";const X={version:1},T="https://cdn.jsdelivr.net/pyodide/v0.27.0/full/",$=new Map;async function K(o){const s=$.get(o);if(s)return s;const g=await fetch(B.artifactUrl(o));if(!g.ok)throw new Error(`Failed to fetch plugin source: ${g.status}`);const y=await g.text();return $.set(o,y),y}async function Q(o){const s=await fetch(B.artifactUrl(o));if(!s.ok)throw new Error(`Failed to fetch artifact: ${s.status}`);const g=await s.arrayBuffer(),y=new Uint8Array(g),r=new TextEncoder().encode("cairn-plugin:");if(y.length>=r.length){let f=!0;for(let p=0;p<r.length;p++)if(y[p]!==r[p]){f=!1;break}if(f){const p=y.indexOf(10);if(p>0)return g.slice(p+1)}}return g}function V(o){return`<!DOCTYPE html>
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
</body></html>`}function Z(o){const s=o.replace(/\\/g,"\\\\").replace(/`/g,"\\`").replace(/\$/g,"\\$");return`<!DOCTYPE html>
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
<script src="${T}pyodide.js"><\/script>
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
    pyodide = await loadPyodide({ indexURL: "${T}" });
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
</body></html>`}function te({runId:o,metric:s,settingsKeyOverride:g,onRemove:y}){const[r,f]=J(g??{runId:o,metricName:s.name,contextHash:s.context_hash},X),p=z(o,s.name,{context:s.context_hash||void 0,maxPoints:200}),x=a.useMemo(()=>{var e;return(((e=p.data)==null?void 0:e.points)??[]).filter(t=>t.artifact_hash)},[p.data]),w=a.useMemo(()=>{const e=new Set;for(const t of x)e.add(t.step);return Array.from(e).sort((t,n)=>t-n)},[x]),[I,H]=a.useState(r.sliderStep??0),S=Math.min(Math.max(0,I),Math.max(0,w.length-1)),b=w[S]??0,l=a.useMemo(()=>x.find(e=>e.step===b)??x[0],[x,b]),c=a.useMemo(()=>A((l==null?void 0:l.artifact_metadata)??null)??{},[l]),E=a.useRef(null),[O,F]=a.useState(300),[R,v]=a.useState(null),[M,N]=a.useState(!1),C=a.useRef("");a.useEffect(()=>()=>{P.current&&URL.revokeObjectURL(P.current)},[]),a.useEffect(()=>{const e=t=>{var n;((n=t.data)==null?void 0:n.type)==="cairn:resize"&&typeof t.data.height=="number"&&F(Math.max(100,Math.min(2e3,t.data.height)))};return window.addEventListener("message",e),()=>window.removeEventListener("message",e)},[]);const d=c.plugin_lang??"js",j=a.useRef(null),[k,D]=a.useState(null);a.useEffect(()=>{if(d!=="server"&&d!=="window"||!(l!=null&&l.artifact_hash)||!c.plugin_hash)return;const t=`${window.location.protocol==="https:"?"wss:":"ws:"}//${window.location.host}/ws/plugin/${o}/${encodeURIComponent(s.name)}`,n=new WebSocket(t);j.current=n,n.onopen=()=>{n.send(JSON.stringify({type:"render",artifact_hash:l.artifact_hash,metadata:c,step:b}))};let u="";return n.onmessage=m=>{if(typeof m.data=="string"){const h=JSON.parse(m.data);h.type==="frame"?u=h.mime||"image/png":h.type==="error"&&v(h.message)}else if(m.data instanceof Blob){const h=new Blob([m.data],{type:u}),W=URL.createObjectURL(h);D(U=>(U&&URL.revokeObjectURL(U),W))}},n.onerror=()=>v("WebSocket connection failed"),()=>{n.close(),j.current=null}},[d,l,c,b,o,s.name]);const _=a.useCallback((e,t)=>{const n=j.current;if(!n||n.readyState!==WebSocket.OPEN)return;const u=t.target.getBoundingClientRect();n.send(JSON.stringify({type:"mouse",x:Math.round(t.clientX-u.left),y:Math.round(t.clientY-u.top),button:t.button,action:e}))},[]),P=a.useRef(""),L=a.useCallback(async()=>{if(!(d==="server"||d==="window")&&c.plugin_hash){v(null);try{const e=await K(c.plugin_hash),t=E.current;if(!t)return;const n=`${c.plugin_hash}:${d}`;if(C.current!==n){if(C.current=n,N(!1),d==="js")t.removeAttribute("src"),t.srcdoc=V(e);else{t.removeAttribute("srcdoc"),P.current&&URL.revokeObjectURL(P.current);const u=Z(e),m=new Blob([u],{type:"text/html"}),h=URL.createObjectURL(m);P.current=h,t.src=h}await new Promise(u=>{t.onload=()=>u()}),N(!0)}}catch(e){v(e instanceof Error?e.message:String(e))}}},[c.plugin_hash,d]);a.useEffect(()=>{L()},[L]),a.useEffect(()=>{if(!M||!(l!=null&&l.artifact_hash))return;const e=E.current;if(!(e!=null&&e.contentWindow))return;let t=!1;return Q(l.artifact_hash).then(n=>{var m;if(t)return;const u=n.slice(0);(m=e.contentWindow)==null||m.postMessage({type:"cairn:render",data:u,metadata:c,step:b,runId:o,metricName:s.name},"*",[u])}).catch(n=>{t||v(n instanceof Error?n.message:String(n))}),()=>{t=!0}},[M,l,c,b,o,s.name]);const q=w.length>0?`step ${b} (${S+1}/${w.length})`:c.plugin_name??"plugin";return i.jsxs("div",{className:"card p-4 flex flex-col",style:{position:"relative",height:r.collapsed?void 0:r.height??400,gridColumn:(r.colSpan??1)>1?`span ${r.colSpan}`:void 0},children:[i.jsx(G,{title:r.title??s.name,onTitleChange:e=>f({title:e||void 0}),subtitle:q,collapsed:r.collapsed,onToggleCollapse:()=>f({collapsed:!r.collapsed}),onToggleFullWidth:()=>f({colSpan:(r.colSpan??1)>1?1:2}),isFullWidth:(r.colSpan??1)>1,onRemove:y,children:i.jsx("span",{className:"inline-flex items-center rounded bg-bg-hover px-1.5 py-0.5 text-[10px] text-fg-muted",children:d==="window"?"Window":d==="server"?"Server":d==="py"?"Python":"JS"})}),!r.collapsed&&i.jsxs(i.Fragment,{children:[R?i.jsx("div",{className:"flex-1 rounded bg-bg p-3 text-xs text-status-failed overflow-auto",children:i.jsx("pre",{children:R})}):c.plugin_hash?d==="server"||d==="window"?k?i.jsx("img",{src:k,alt:`Server plugin: ${c.plugin_name??s.name}`,className:"flex-1 w-full rounded object-contain cursor-grab active:cursor-grabbing",style:{minHeight:200,userSelect:"none"},draggable:!1,onMouseDown:e=>{e.preventDefault(),_("down",e)},onMouseMove:e=>_("move",e),onMouseUp:e=>_("up",e),onMouseLeave:e=>_("up",e)}):i.jsxs("div",{className:"flex-1 flex items-center justify-center",children:[i.jsx("div",{className:"h-8 w-8 motion-safe:animate-spin rounded-full border-2 border-accent border-t-transparent"}),i.jsx("span",{className:"ml-2 text-xs text-fg-muted",children:"Connecting to server..."})]}):i.jsx("iframe",{ref:E,...d==="js"?{sandbox:"allow-scripts"}:{},className:"flex-1 w-full rounded border-0",style:{height:O,minHeight:200},title:`Plugin: ${c.plugin_name??s.name}`}):i.jsx("div",{className:"flex-1 flex items-center justify-center text-sm text-fg-muted",children:"No plugin metadata found"}),w.length>1&&i.jsx("input",{type:"range",min:0,max:w.length-1,value:S,onChange:e=>{const t=Number(e.target.value);H(t),f({sliderStep:t})},className:"mt-3 w-full accent-accent"})]}),i.jsx(Y,{height:r.height,onHeightChange:e=>f({height:e}),colSpan:r.colSpan??1,onColSpanChange:e=>f({colSpan:e})})]})}export{te as default};
