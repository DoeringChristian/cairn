import{u as $,b as F,r as s,s as q,l as o,C as O,v as D,e as N}from"./index-Di-kfydo.js";const z={version:1},k="https://cdn.jsdelivr.net/pyodide/v0.27.0/full/",L=new Map;async function A(a){const n=L.get(a);if(n)return n;const g=await fetch(N.artifactUrl(a));if(!g.ok)throw new Error(`Failed to fetch plugin source: ${g.status}`);const b=await g.text();return L.set(a,b),b}async function J(a){const n=await fetch(N.artifactUrl(a));if(!n.ok)throw new Error(`Failed to fetch artifact: ${n.status}`);return n.arrayBuffer()}function W(a){return`<!DOCTYPE html>
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
${a}
<\/script>
</body></html>`}function G(a){const n=a.replace(/\\/g,"\\\\").replace(/`/g,"\\`").replace(/\$/g,"\\$");return`<!DOCTYPE html>
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
<script src="${k}pyodide.js"><\/script>
<script>
const PLUGIN_SOURCE = \`${n}\`;

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
    pyodide = await loadPyodide({ indexURL: "${k}" });
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
</body></html>`}function K({runId:a,metric:n,settingsKeyOverride:g,onRemove:b}){const[r,d]=$(g??{runId:a,metricName:n.name,contextHash:n.context_hash},z),v=F(a,n.name,{context:n.context_hash||void 0,maxPoints:200}),m=s.useMemo(()=>{var e;return(((e=v.data)==null?void 0:e.points)??[]).filter(t=>t.artifact_hash)},[v.data]),u=s.useMemo(()=>{const e=new Set;for(const t of m)e.add(t.step);return Array.from(e).sort((t,i)=>t-i)},[m]),[T,I]=s.useState(r.sliderStep??0),P=Math.min(Math.max(0,T),Math.max(0,u.length-1)),f=u[P]??0,c=s.useMemo(()=>m.find(e=>e.step===f)??m[0],[m,f]),l=s.useMemo(()=>q((c==null?void 0:c.artifact_metadata)??null)??{},[c]),_=s.useRef(null),[U,B]=s.useState(300),[S,w]=s.useState(null),[E,j]=s.useState(!1),R=s.useRef("");s.useEffect(()=>()=>{y.current&&URL.revokeObjectURL(y.current)},[]),s.useEffect(()=>{const e=t=>{var i;((i=t.data)==null?void 0:i.type)==="cairn:resize"&&typeof t.data.height=="number"&&B(Math.max(100,Math.min(2e3,t.data.height)))};return window.addEventListener("message",e),()=>window.removeEventListener("message",e)},[]);const h=l.plugin_lang??"js",y=s.useRef(""),M=s.useCallback(async()=>{if(l.plugin_hash){w(null);try{const e=await A(l.plugin_hash),t=_.current;if(!t)return;const i=`${l.plugin_hash}:${h}`;if(R.current!==i){if(R.current=i,j(!1),h==="js")t.removeAttribute("src"),t.srcdoc=W(e);else{t.removeAttribute("srcdoc"),y.current&&URL.revokeObjectURL(y.current);const p=G(e),x=new Blob([p],{type:"text/html"}),C=URL.createObjectURL(x);y.current=C,t.src=C}await new Promise(p=>{t.onload=()=>p()}),j(!0)}}catch(e){w(e instanceof Error?e.message:String(e))}}},[l.plugin_hash,h]);s.useEffect(()=>{M()},[M]),s.useEffect(()=>{if(!E||!(c!=null&&c.artifact_hash))return;const e=_.current;if(!(e!=null&&e.contentWindow))return;let t=!1;return J(c.artifact_hash).then(i=>{var x;if(t)return;const p=i.slice(0);(x=e.contentWindow)==null||x.postMessage({type:"cairn:render",data:p,metadata:l,step:f,runId:a,metricName:n.name},"*",[p])}).catch(i=>{t||w(i instanceof Error?i.message:String(i))}),()=>{t=!0}},[E,c,l,f,a,n.name]);const H=u.length>0?`step ${f} (${P+1}/${u.length})`:l.plugin_name??"plugin";return o.jsxs("div",{className:"card p-4 flex flex-col",style:{position:"relative",height:r.collapsed?void 0:r.height??400,gridColumn:(r.colSpan??1)>1?`span ${r.colSpan}`:void 0},children:[o.jsx(O,{title:r.title??n.name,onTitleChange:e=>d({title:e||void 0}),subtitle:H,collapsed:r.collapsed,onToggleCollapse:()=>d({collapsed:!r.collapsed}),onToggleFullWidth:()=>d({colSpan:(r.colSpan??1)>1?1:2}),isFullWidth:(r.colSpan??1)>1,onRemove:b,children:o.jsx("span",{className:"inline-flex items-center rounded bg-bg-hover px-1.5 py-0.5 text-[10px] text-fg-muted",children:h==="py"?"Python":"JS"})}),!r.collapsed&&o.jsxs(o.Fragment,{children:[S?o.jsx("div",{className:"flex-1 rounded bg-bg p-3 text-xs text-status-failed overflow-auto",children:o.jsx("pre",{children:S})}):l.plugin_hash?o.jsx("iframe",{ref:_,...h==="js"?{sandbox:"allow-scripts"}:{},className:"flex-1 w-full rounded border-0",style:{height:U,minHeight:200},title:`Plugin: ${l.plugin_name??n.name}`}):o.jsx("div",{className:"flex-1 flex items-center justify-center text-sm text-fg-muted",children:"No plugin metadata found"}),u.length>1&&o.jsx("input",{type:"range",min:0,max:u.length-1,value:P,onChange:e=>{const t=Number(e.target.value);I(t),d({sliderStep:t})},className:"mt-3 w-full accent-accent"})]}),o.jsx(D,{height:r.height,onHeightChange:e=>d({height:e}),colSpan:r.colSpan??1,onColSpanChange:e=>d({colSpan:e})})]})}export{K as default};
