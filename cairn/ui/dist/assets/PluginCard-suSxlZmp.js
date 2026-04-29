import{u as ae,b as oe,r as s,s as ie,l as c,C as le,v as ce,e as K}from"./index-DlmLXuvV.js";const de={version:1},Y="https://cdn.jsdelivr.net/pyodide/v0.27.0/full/",X=new Map;async function ue(l){const a=X.get(l);if(a)return a;const h=await fetch(K.artifactUrl(l));if(!h.ok)throw new Error(`Failed to fetch plugin source: ${h.status}`);const b=await h.text();return X.set(l,b),b}async function pe(l){const a=await fetch(K.artifactUrl(l));if(!a.ok)throw new Error(`Failed to fetch artifact: ${a.status}`);const h=await a.arrayBuffer(),b=new Uint8Array(h),i=new TextEncoder().encode("cairn-plugin:");if(b.length>=i.length){let y=!0;for(let m=0;m<i.length;m++)if(b[m]!==i[m]){y=!1;break}if(y){const m=b.indexOf(10);if(m>0)return h.slice(m+1)}}return h}function fe(l){return`<!DOCTYPE html>
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
${l}
<\/script>
</body></html>`}function ge(l){const a=l.replace(/\\/g,"\\\\").replace(/`/g,"\\`").replace(/\$/g,"\\$");return`<!DOCTYPE html>
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
<script src="${Y}pyodide.js"><\/script>
<script>
const PLUGIN_SOURCE = \`${a}\`;

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
    pyodide = await loadPyodide({ indexURL: "${Y}" });
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
</body></html>`}function he({runId:l,metric:a,settingsKeyOverride:h,onRemove:b}){const[i,y]=ae(h??{runId:l,metricName:a.name,contextHash:a.context_hash},de),m=oe(l,a.name,{context:a.context_hash||void 0,maxPoints:200}),_=s.useMemo(()=>{var e;return(((e=m.data)==null?void 0:e.points)??[]).filter(t=>t.artifact_hash)},[m.data]),x=s.useMemo(()=>{const e=new Set;for(const t of _)e.add(t.step);return Array.from(e).sort((t,n)=>t-n)},[_]),[Q,V]=s.useState(i.sliderStep??0),C=Math.min(Math.max(0,Q),Math.max(0,x.length-1)),v=x[C]??0,p=s.useMemo(()=>_.find(e=>e.step===v)??_[0],[_,v]),f=s.useMemo(()=>ie((p==null?void 0:p.artifact_metadata)??null)??{},[p]),k=s.useRef(null),[Z,ee]=s.useState(300),[I,S]=s.useState(null),[O,W]=s.useState(!1),F=s.useRef("");s.useEffect(()=>()=>{R.current&&URL.revokeObjectURL(R.current)},[]),s.useEffect(()=>{const e=t=>{var n;((n=t.data)==null?void 0:n.type)==="cairn:resize"&&typeof t.data.height=="number"&&ee(Math.max(100,Math.min(2e3,t.data.height)))};return window.addEventListener("message",e),()=>window.removeEventListener("message",e)},[]);const d=f.plugin_lang??"js",N=s.useRef(null),[D,te]=s.useState(null),L=s.useRef(null),P=s.useRef(null),[J,q]=s.useState(!1),A=s.useRef(0);s.useEffect(()=>{if(d!=="server"&&d!=="window"||!(p!=null&&p.artifact_hash)||!f.plugin_hash)return;const t=`${window.location.protocol==="https:"?"wss:":"ws:"}//${window.location.host}/ws/plugin/${l}/${encodeURIComponent(a.name)}`,n=new WebSocket(t);n.binaryType="blob",N.current=n,n.onopen=()=>{if(n.send(JSON.stringify({type:"render",artifact_hash:p.artifact_hash,metadata:f,step:v})),d==="window"){const o=new RTCPeerConnection;P.current=o,o.addTransceiver("video",{direction:"recvonly"}),o.ontrack=r=>{L.current&&(L.current.srcObject=r.streams[0]??new MediaStream([r.track])),q(!0)},o.createOffer().then(r=>{o.setLocalDescription(r),n.send(JSON.stringify({type:"webrtc_offer",sdp:r.sdp}))}).catch(()=>{console.warn("[PluginCard] WebRTC offer failed, using JPEG fallback")})}};let u="";return n.onmessage=o=>{if(typeof o.data=="string"){const r=JSON.parse(o.data);r.type==="frame"?u=r.mime||"image/jpeg":r.type==="error"?S(r.message):r.type==="webrtc_answer"&&P.current?P.current.setRemoteDescription({type:"answer",sdp:r.sdp}):r.type==="webrtc_failed"&&console.warn("[PluginCard] WebRTC failed:",r.message,"— using JPEG fallback")}else if(o.data instanceof Blob&&!J){const r=new Blob([o.data],{type:u}),g=URL.createObjectURL(r);te(E=>(E&&URL.revokeObjectURL(E),g))}},n.onerror=()=>S("WebSocket connection failed"),()=>{n.close(),N.current=null,P.current&&(P.current.close(),P.current=null),q(!1)}},[d,p,f,v,l,a.name]);const w=s.useCallback((e,t)=>{const n=N.current;if(!n||n.readyState!==WebSocket.OPEN)return;if(e==="move"){const G=performance.now();if(G-A.current<16)return;A.current=G}const u=t.currentTarget,o=u.naturalWidth||u.videoWidth||0,r=u.naturalHeight||u.videoHeight||0;if(!o||!r)return;const g=u.getBoundingClientRect(),E=g.width/g.height,U=o/r;let j,M,T,H;U>E?(j=g.width,M=g.width/U,T=0,H=(g.height-M)/2):(M=g.height,j=g.height*U,T=(g.width-j)/2,H=0);const $=t.clientX-g.left-T,B=t.clientY-g.top-H;if($<0||B<0||$>j||B>M)return;const se=Math.round($/j*o),re=Math.round(B/M*r);n.send(JSON.stringify({type:"mouse",x:se,y:re,button:t.button,action:e}))},[]),R=s.useRef(""),z=s.useCallback(async()=>{if(!(d==="server"||d==="window")&&f.plugin_hash){S(null);try{const e=await ue(f.plugin_hash),t=k.current;if(!t)return;const n=`${f.plugin_hash}:${d}`;if(F.current!==n){if(F.current=n,W(!1),d==="js")t.removeAttribute("src"),t.srcdoc=fe(e);else{t.removeAttribute("srcdoc"),R.current&&URL.revokeObjectURL(R.current);const u=ge(e),o=new Blob([u],{type:"text/html"}),r=URL.createObjectURL(o);R.current=r,t.src=r}await new Promise(u=>{t.onload=()=>u()}),W(!0)}}catch(e){S(e instanceof Error?e.message:String(e))}}},[f.plugin_hash,d]);s.useEffect(()=>{z()},[z]),s.useEffect(()=>{if(!O||!(p!=null&&p.artifact_hash))return;const e=k.current;if(!(e!=null&&e.contentWindow))return;let t=!1;return pe(p.artifact_hash).then(n=>{var o;if(t)return;const u=n.slice(0);(o=e.contentWindow)==null||o.postMessage({type:"cairn:render",data:u,metadata:f,step:v,runId:l,metricName:a.name},"*",[u])}).catch(n=>{t||S(n instanceof Error?n.message:String(n))}),()=>{t=!0}},[O,p,f,v,l,a.name]);const ne=x.length>0?`step ${v} (${C+1}/${x.length})`:f.plugin_name??"plugin";return c.jsxs("div",{className:"card p-4 flex flex-col",style:{position:"relative",height:i.collapsed?void 0:i.height??400,gridColumn:(i.colSpan??1)>1?`span ${i.colSpan}`:void 0},children:[c.jsx(le,{title:i.title??a.name,onTitleChange:e=>y({title:e||void 0}),subtitle:ne,collapsed:i.collapsed,onToggleCollapse:()=>y({collapsed:!i.collapsed}),onToggleFullWidth:()=>y({colSpan:(i.colSpan??1)>1?1:2}),isFullWidth:(i.colSpan??1)>1,onRemove:b,children:c.jsx("span",{className:"inline-flex items-center rounded bg-bg-hover px-1.5 py-0.5 text-[10px] text-fg-muted",children:d==="window"?"Window":d==="server"?"Server":d==="py"?"Python":"JS"})}),!i.collapsed&&c.jsxs(c.Fragment,{children:[I?c.jsx("div",{className:"flex-1 rounded bg-bg p-3 text-xs text-status-failed overflow-auto",children:c.jsx("pre",{children:I})}):f.plugin_hash?d==="server"||d==="window"?J?c.jsx("video",{ref:L,autoPlay:!0,playsInline:!0,muted:!0,className:"flex-1 w-full rounded object-contain cursor-grab active:cursor-grabbing",style:{minHeight:200,userSelect:"none",background:"#161b22"},onMouseDown:e=>{e.preventDefault(),w("down",e)},onMouseMove:e=>w("move",e),onMouseUp:e=>w("up",e),onMouseLeave:e=>w("up",e)}):D?c.jsx("img",{src:D,alt:`Server plugin: ${f.plugin_name??a.name}`,className:"flex-1 w-full rounded object-contain cursor-grab active:cursor-grabbing",style:{minHeight:200,userSelect:"none"},draggable:!1,onMouseDown:e=>{e.preventDefault(),w("down",e)},onMouseMove:e=>w("move",e),onMouseUp:e=>w("up",e),onMouseLeave:e=>w("up",e)}):c.jsxs("div",{className:"flex-1 flex items-center justify-center",children:[c.jsx("div",{className:"h-8 w-8 motion-safe:animate-spin rounded-full border-2 border-accent border-t-transparent"}),c.jsx("span",{className:"ml-2 text-xs text-fg-muted",children:"Connecting to server..."})]}):c.jsx("iframe",{ref:k,...d==="js"?{sandbox:"allow-scripts"}:{},className:"flex-1 w-full rounded border-0",style:{height:Z,minHeight:200},title:`Plugin: ${f.plugin_name??a.name}`}):c.jsx("div",{className:"flex-1 flex items-center justify-center text-sm text-fg-muted",children:"No plugin metadata found"}),x.length>1&&c.jsx("input",{type:"range",min:0,max:x.length-1,value:C,onChange:e=>{const t=Number(e.target.value);V(t),y({sliderStep:t})},className:"mt-3 w-full accent-accent"})]}),c.jsx(ce,{height:i.height,onHeightChange:e=>y({height:e}),colSpan:i.colSpan??1,onColSpanChange:e=>y({colSpan:e})})]})}export{he as default};
