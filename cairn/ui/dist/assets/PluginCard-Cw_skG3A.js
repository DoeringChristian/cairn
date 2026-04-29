import{u as Z,b as ee,r,s as te,l as c,C as ne,v as se,e as A}from"./index-0bqYQ9C6.js";const ae={version:1},D="https://cdn.jsdelivr.net/pyodide/v0.27.0/full/",q=new Map;async function re(i){const s=q.get(i);if(s)return s;const m=await fetch(A.artifactUrl(i));if(!m.ok)throw new Error(`Failed to fetch plugin source: ${m.status}`);const y=await m.text();return q.set(i,y),y}async function oe(i){const s=await fetch(A.artifactUrl(i));if(!s.ok)throw new Error(`Failed to fetch artifact: ${s.status}`);const m=await s.arrayBuffer(),y=new Uint8Array(m),o=new TextEncoder().encode("cairn-plugin:");if(y.length>=o.length){let h=!0;for(let f=0;f<o.length;f++)if(y[f]!==o[f]){h=!1;break}if(h){const f=y.indexOf(10);if(f>0)return m.slice(f+1)}}return m}function ie(i){return`<!DOCTYPE html>
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
${i}
<\/script>
</body></html>`}function le(i){const s=i.replace(/\\/g,"\\\\").replace(/`/g,"\\`").replace(/\$/g,"\\$");return`<!DOCTYPE html>
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
<script src="${D}pyodide.js"><\/script>
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
    pyodide = await loadPyodide({ indexURL: "${D}" });
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
</body></html>`}function de({runId:i,metric:s,settingsKeyOverride:m,onRemove:y}){const[o,h]=Z(m??{runId:i,metricName:s.name,contextHash:s.context_hash},ae),f=ee(i,s.name,{context:s.context_hash||void 0,maxPoints:200}),x=r.useMemo(()=>{var e;return(((e=f.data)==null?void 0:e.points)??[]).filter(t=>t.artifact_hash)},[f.data]),w=r.useMemo(()=>{const e=new Set;for(const t of x)e.add(t.step);return Array.from(e).sort((t,n)=>t-n)},[x]),[J,z]=r.useState(o.sliderStep??0),M=Math.min(Math.max(0,J),Math.max(0,w.length-1)),b=w[M]??0,d=r.useMemo(()=>x.find(e=>e.step===b)??x[0],[x,b]),u=r.useMemo(()=>te((d==null?void 0:d.artifact_metadata)??null)??{},[d]),N=r.useRef(null),[Y,G]=r.useState(300),[$,v]=r.useState(null),[B,I]=r.useState(!1),O=r.useRef("");r.useEffect(()=>()=>{P.current&&URL.revokeObjectURL(P.current)},[]),r.useEffect(()=>{const e=t=>{var n;((n=t.data)==null?void 0:n.type)==="cairn:resize"&&typeof t.data.height=="number"&&G(Math.max(100,Math.min(2e3,t.data.height)))};return window.addEventListener("message",e),()=>window.removeEventListener("message",e)},[]);const p=u.plugin_lang??"js",C=r.useRef(null),[F,X]=r.useState(null);r.useEffect(()=>{if(p!=="server"&&p!=="window"||!(d!=null&&d.artifact_hash)||!u.plugin_hash)return;const t=`${window.location.protocol==="https:"?"wss:":"ws:"}//${window.location.host}/ws/plugin/${i}/${encodeURIComponent(s.name)}`,n=new WebSocket(t);n.binaryType="blob",C.current=n,n.onopen=()=>{n.send(JSON.stringify({type:"render",artifact_hash:d.artifact_hash,metadata:u,step:b}))};let l="";return n.onmessage=a=>{if(typeof a.data=="string"){const g=JSON.parse(a.data);g.type==="frame"?l=g.mime||"image/png":g.type==="error"&&v(g.message)}else if(a.data instanceof Blob){const g=new Blob([a.data],{type:l}),j=URL.createObjectURL(g);X(R=>(R&&URL.revokeObjectURL(R),j))}},n.onerror=()=>v("WebSocket connection failed"),()=>{n.close(),C.current=null}},[p,d,u,b,i,s.name]);const E=r.useCallback((e,t)=>{const n=C.current;if(!n||n.readyState!==WebSocket.OPEN)return;const l=t.currentTarget;if(!l.naturalWidth||!l.naturalHeight)return;const a=l.getBoundingClientRect(),g=l.naturalWidth,j=l.naturalHeight,R=a.width/a.height,k=g/j;let _,S,L,U;k>R?(_=a.width,S=a.width/k,L=0,U=(a.height-S)/2):(S=a.height,_=a.height*k,L=(a.width-_)/2,U=0);const T=t.clientX-a.left-L,H=t.clientY-a.top-U;if(T<0||H<0||T>_||H>S)return;const Q=Math.round(T/_*g),V=Math.round(H/S*j);n.send(JSON.stringify({type:"mouse",x:Q,y:V,button:t.button,action:e}))},[]),P=r.useRef(""),W=r.useCallback(async()=>{if(!(p==="server"||p==="window")&&u.plugin_hash){v(null);try{const e=await re(u.plugin_hash),t=N.current;if(!t)return;const n=`${u.plugin_hash}:${p}`;if(O.current!==n){if(O.current=n,I(!1),p==="js")t.removeAttribute("src"),t.srcdoc=ie(e);else{t.removeAttribute("srcdoc"),P.current&&URL.revokeObjectURL(P.current);const l=le(e),a=new Blob([l],{type:"text/html"}),g=URL.createObjectURL(a);P.current=g,t.src=g}await new Promise(l=>{t.onload=()=>l()}),I(!0)}}catch(e){v(e instanceof Error?e.message:String(e))}}},[u.plugin_hash,p]);r.useEffect(()=>{W()},[W]),r.useEffect(()=>{if(!B||!(d!=null&&d.artifact_hash))return;const e=N.current;if(!(e!=null&&e.contentWindow))return;let t=!1;return oe(d.artifact_hash).then(n=>{var a;if(t)return;const l=n.slice(0);(a=e.contentWindow)==null||a.postMessage({type:"cairn:render",data:l,metadata:u,step:b,runId:i,metricName:s.name},"*",[l])}).catch(n=>{t||v(n instanceof Error?n.message:String(n))}),()=>{t=!0}},[B,d,u,b,i,s.name]);const K=w.length>0?`step ${b} (${M+1}/${w.length})`:u.plugin_name??"plugin";return c.jsxs("div",{className:"card p-4 flex flex-col",style:{position:"relative",height:o.collapsed?void 0:o.height??400,gridColumn:(o.colSpan??1)>1?`span ${o.colSpan}`:void 0},children:[c.jsx(ne,{title:o.title??s.name,onTitleChange:e=>h({title:e||void 0}),subtitle:K,collapsed:o.collapsed,onToggleCollapse:()=>h({collapsed:!o.collapsed}),onToggleFullWidth:()=>h({colSpan:(o.colSpan??1)>1?1:2}),isFullWidth:(o.colSpan??1)>1,onRemove:y,children:c.jsx("span",{className:"inline-flex items-center rounded bg-bg-hover px-1.5 py-0.5 text-[10px] text-fg-muted",children:p==="window"?"Window":p==="server"?"Server":p==="py"?"Python":"JS"})}),!o.collapsed&&c.jsxs(c.Fragment,{children:[$?c.jsx("div",{className:"flex-1 rounded bg-bg p-3 text-xs text-status-failed overflow-auto",children:c.jsx("pre",{children:$})}):u.plugin_hash?p==="server"||p==="window"?F?c.jsx("img",{src:F,alt:`Server plugin: ${u.plugin_name??s.name}`,className:"flex-1 w-full rounded object-contain cursor-grab active:cursor-grabbing",style:{minHeight:200,userSelect:"none"},draggable:!1,onMouseDown:e=>{e.preventDefault(),E("down",e)},onMouseMove:e=>E("move",e),onMouseUp:e=>E("up",e),onMouseLeave:e=>E("up",e)}):c.jsxs("div",{className:"flex-1 flex items-center justify-center",children:[c.jsx("div",{className:"h-8 w-8 motion-safe:animate-spin rounded-full border-2 border-accent border-t-transparent"}),c.jsx("span",{className:"ml-2 text-xs text-fg-muted",children:"Connecting to server..."})]}):c.jsx("iframe",{ref:N,...p==="js"?{sandbox:"allow-scripts"}:{},className:"flex-1 w-full rounded border-0",style:{height:Y,minHeight:200},title:`Plugin: ${u.plugin_name??s.name}`}):c.jsx("div",{className:"flex-1 flex items-center justify-center text-sm text-fg-muted",children:"No plugin metadata found"}),w.length>1&&c.jsx("input",{type:"range",min:0,max:w.length-1,value:M,onChange:e=>{const t=Number(e.target.value);z(t),h({sliderStep:t})},className:"mt-3 w-full accent-accent"})]}),c.jsx(se,{height:o.height,onHeightChange:e=>h({height:e}),colSpan:o.colSpan??1,onColSpanChange:e=>h({colSpan:e})})]})}export{de as default};
