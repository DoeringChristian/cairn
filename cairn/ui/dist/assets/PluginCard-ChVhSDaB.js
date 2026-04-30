import{r,u as ue,b as pe,s as fe,y as Q,l as i,C as ge,v as me,e as ee}from"./index-C1vMgGDO.js";const he={version:1},V="https://cdn.jsdelivr.net/pyodide/v0.27.0/full/",Z=new Map;async function ye(l){const a=Z.get(l);if(a)return a;const m=await fetch(ee.artifactUrl(l));if(!m.ok)throw new Error(`Failed to fetch plugin source: ${m.status}`);const b=await m.text();return Z.set(l,b),b}async function be(l){const a=await fetch(ee.artifactUrl(l));if(!a.ok)throw new Error(`Failed to fetch artifact: ${a.status}`);const m=await a.arrayBuffer(),b=new Uint8Array(m),R=new TextEncoder().encode("cairn-plugin:");if(b.length>=R.length){let N=!0;for(let h=0;h<R.length;h++)if(b[h]!==R[h]){N=!1;break}if(N){const h=b.indexOf(10);if(h>0)return m.slice(h+1)}}return m}function we(l){return`<!DOCTYPE html>
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
</body></html>`}function xe(l){const a=l.replace(/\\/g,"\\\\").replace(/`/g,"\\`").replace(/\$/g,"\\$");return`<!DOCTYPE html>
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
<script src="${V}pyodide.js"><\/script>
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
    pyodide = await loadPyodide({ indexURL: "${V}" });
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
</body></html>`}function Se({runId:l,metric:a,extraSeries:m,controlledSeries:b,settingsKeyOverride:R,onRemove:N}){r.useMemo(()=>{const e=[{name:a.name,context_hash:a.context_hash},...(m??[]).map(t=>({runId:t.runId,name:t.name,context_hash:t.context_hash}))],n=new Set;return e.filter(t=>{const c=`${t.runId??""}::${t.name}::${t.context_hash}`;return n.has(c)?!1:(n.add(c),!0)})},[a.name,a.context_hash,m]).length>1;const[g,S]=ue(R??{runId:l,metricName:a.name,contextHash:a.context_hash},he),B=pe(l,a.name,{context:a.context_hash||void 0,maxPoints:200}),j=r.useMemo(()=>{var e;return(((e=B.data)==null?void 0:e.points)??[]).filter(n=>n.artifact_hash)},[B.data]),P=r.useMemo(()=>{const e=new Set;for(const n of j)e.add(n.step);return Array.from(e).sort((n,t)=>n-t)},[j]),[te,ne]=r.useState(g.sliderStep??0),T=Math.min(Math.max(0,te),Math.max(0,P.length-1)),w=P[T]??0,p=r.useMemo(()=>j.find(e=>e.step===w)??j[0],[j,w]),f=r.useMemo(()=>fe((p==null?void 0:p.artifact_metadata)??null)??{},[p]),L=r.useRef(null),[se,re]=r.useState(300),[D,M]=r.useState(null),[F,J]=r.useState(!1),q=r.useRef("");r.useEffect(()=>()=>{C.current&&URL.revokeObjectURL(C.current)},[]),r.useEffect(()=>{const e=n=>{var t;((t=n.data)==null?void 0:t.type)==="cairn:resize"&&typeof n.data.height=="number"&&re(Math.max(100,Math.min(2e3,n.data.height)))};return window.addEventListener("message",e),()=>window.removeEventListener("message",e)},[]);const d=f.plugin_lang??"js",U=r.useRef(null),[A,ae]=r.useState(null),oe=r.useRef(null),_=r.useRef(null),$=r.useRef(null),[z,G]=r.useState(!1),Y=r.useRef(0),ie=r.useCallback(e=>{oe.current=e,e&&$.current&&(console.log("[PluginCard] Assigning WebRTC stream to <video>"),e.srcObject=$.current)},[]);r.useEffect(()=>{if(d!=="server"&&d!=="window"||!(p!=null&&p.artifact_hash)||!f.plugin_hash)return;const n=`${window.location.protocol==="https:"?"wss:":"ws:"}//${window.location.host}/ws/plugin/${l}/${encodeURIComponent(a.name)}`,t=new WebSocket(n);t.binaryType="blob",U.current=t,t.onopen=()=>{t.send(JSON.stringify({type:"render",artifact_hash:p.artifact_hash,metadata:f,step:w}));const u=Q();if(d==="window"&&u!=="jpeg"){const s=new RTCPeerConnection({iceServers:[]});_.current=s,s.addTransceiver("video",{direction:"recvonly"}),s.ontrack=o=>{console.log("[PluginCard] WebRTC ontrack fired, track:",o.track.kind,o.track.readyState),$.current=o.streams[0]??new MediaStream([o.track]),G(!0)},s.createOffer().then(async o=>{var x;await s.setLocalDescription(o),await new Promise(v=>{if(s.iceGatheringState==="complete"){v();return}s.onicegatheringstatechange=()=>{s.iceGatheringState==="complete"&&v()},setTimeout(v,2e3)}),t.readyState===WebSocket.OPEN&&t.send(JSON.stringify({type:"webrtc_offer",sdp:(x=s.localDescription)==null?void 0:x.sdp}))}).catch(o=>{console.warn("[PluginCard] WebRTC offer failed:",o)})}};let c="";return t.onmessage=u=>{if(typeof u.data=="string"){const s=JSON.parse(u.data);s.type==="frame"?c=s.mime||"image/jpeg":s.type==="error"?M(s.message):s.type==="webrtc_answer"&&_.current?_.current.setRemoteDescription(new RTCSessionDescription({type:"answer",sdp:s.sdp})):s.type==="webrtc_failed"&&console.warn("[PluginCard] WebRTC failed:",s.message,"— using JPEG fallback")}else if(u.data instanceof Blob&&!z){const s=new Blob([u.data],{type:c}),o=URL.createObjectURL(s);ae(x=>(x&&URL.revokeObjectURL(x),o))}},t.onerror=()=>M("WebSocket connection failed"),()=>{t.close(),U.current=null,_.current&&(_.current.close(),_.current=null),G(!1)}},[d,p,f,w,l,a.name]);const y=r.useCallback((e,n)=>{const t=U.current;if(!t||t.readyState!==WebSocket.OPEN)return;if(e==="move"){const K=performance.now();if(K-Y.current<16)return;Y.current=K}const c=n.currentTarget,u=c.naturalWidth||c.videoWidth||0,s=c.naturalHeight||c.videoHeight||0;if(!u||!s)return;const o=c.getBoundingClientRect(),x=o.width/o.height,v=u/s;let E,k,H,I;v>x?(E=o.width,k=o.width/v,H=0,I=(o.height-k)/2):(k=o.height,E=o.height*v,H=(o.width-E)/2,I=0);const W=n.clientX-o.left-H,O=n.clientY-o.top-I;if(W<0||O<0||W>E||O>k)return;const le=Math.round(W/E*u),de=Math.round(O/k*s);t.send(JSON.stringify({type:"mouse",x:le,y:de,button:n.button,action:e}))},[]),C=r.useRef(""),X=r.useCallback(async()=>{if(!(d==="server"||d==="window")&&f.plugin_hash){M(null);try{const e=await ye(f.plugin_hash),n=L.current;if(!n)return;const t=`${f.plugin_hash}:${d}`;if(q.current!==t){if(q.current=t,J(!1),d==="js")n.removeAttribute("src"),n.srcdoc=we(e);else{n.removeAttribute("srcdoc"),C.current&&URL.revokeObjectURL(C.current);const c=xe(e),u=new Blob([c],{type:"text/html"}),s=URL.createObjectURL(u);C.current=s,n.src=s}await new Promise(c=>{n.onload=()=>c()}),J(!0)}}catch(e){M(e instanceof Error?e.message:String(e))}}},[f.plugin_hash,d]);r.useEffect(()=>{X()},[X]),r.useEffect(()=>{if(!F||!(p!=null&&p.artifact_hash))return;const e=L.current;if(!(e!=null&&e.contentWindow))return;let n=!1;return be(p.artifact_hash).then(t=>{var u;if(n)return;const c=t.slice(0);(u=e.contentWindow)==null||u.postMessage({type:"cairn:render",data:c,metadata:f,step:w,runId:l,metricName:a.name},"*",[c])}).catch(t=>{n||M(t instanceof Error?t.message:String(t))}),()=>{n=!0}},[F,p,f,w,l,a.name]);const ce=P.length>0?`step ${w} (${T+1}/${P.length})`:f.plugin_name??"plugin";return i.jsxs("div",{className:"card p-4 flex flex-col",style:{position:"relative",height:g.collapsed?void 0:g.height??400,gridColumn:(g.colSpan??1)>1?`span ${g.colSpan}`:void 0},children:[i.jsx(ge,{title:g.title??a.name,onTitleChange:e=>S({title:e||void 0}),subtitle:ce,collapsed:g.collapsed,onToggleCollapse:()=>S({collapsed:!g.collapsed}),onToggleFullWidth:()=>S({colSpan:(g.colSpan??1)>1?1:2}),isFullWidth:(g.colSpan??1)>1,onRemove:N,children:i.jsx("span",{className:"inline-flex items-center rounded bg-bg-hover px-1.5 py-0.5 text-[10px] text-fg-muted",children:d==="window"?"Window":d==="server"?"Server":d==="py"?"Python":"JS"})}),!g.collapsed&&i.jsxs(i.Fragment,{children:[D?i.jsx("div",{className:"flex-1 rounded bg-bg p-3 text-xs text-status-failed overflow-auto",children:i.jsx("pre",{children:D})}):f.plugin_hash?d==="server"||d==="window"?z?i.jsx("video",{ref:ie,autoPlay:!0,playsInline:!0,muted:!0,className:"flex-1 w-full rounded object-contain cursor-grab active:cursor-grabbing",style:{minHeight:200,userSelect:"none"},onMouseDown:e=>{e.preventDefault(),y("down",e)},onMouseMove:e=>y("move",e),onMouseUp:e=>y("up",e),onMouseLeave:e=>y("up",e)}):Q()!=="jpeg"&&d==="window"?i.jsxs("div",{className:"flex-1 flex items-center justify-center",children:[i.jsx("div",{className:"h-8 w-8 motion-safe:animate-spin rounded-full border-2 border-accent border-t-transparent"}),i.jsx("span",{className:"ml-2 text-xs text-fg-muted",children:"Starting WebRTC stream..."})]}):A?i.jsx("img",{src:A,alt:`Server plugin: ${f.plugin_name??a.name}`,className:"flex-1 w-full rounded object-contain cursor-grab active:cursor-grabbing",style:{minHeight:200,userSelect:"none"},draggable:!1,onMouseDown:e=>{e.preventDefault(),y("down",e)},onMouseMove:e=>y("move",e),onMouseUp:e=>y("up",e),onMouseLeave:e=>y("up",e)}):i.jsxs("div",{className:"flex-1 flex items-center justify-center",children:[i.jsx("div",{className:"h-8 w-8 motion-safe:animate-spin rounded-full border-2 border-accent border-t-transparent"}),i.jsx("span",{className:"ml-2 text-xs text-fg-muted",children:"Connecting to server..."})]}):i.jsx("iframe",{ref:L,...d==="js"?{sandbox:"allow-scripts"}:{},className:"flex-1 w-full rounded border-0",style:{height:se,minHeight:200},title:`Plugin: ${f.plugin_name??a.name}`}):i.jsx("div",{className:"flex-1 flex items-center justify-center text-sm text-fg-muted",children:"No plugin metadata found"}),P.length>1&&i.jsx("input",{type:"range",min:0,max:P.length-1,value:T,onChange:e=>{const n=Number(e.target.value);ne(n),S({sliderStep:n})},className:"mt-3 w-full accent-accent"})]}),i.jsx(me,{height:g.height,onHeightChange:e=>S({height:e}),colSpan:g.colSpan??1,onColSpanChange:e=>S({colSpan:e})})]})}export{Se as default};
