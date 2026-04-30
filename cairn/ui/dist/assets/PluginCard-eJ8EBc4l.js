import{r,u as de,b as ue,s as pe,y as K,l,C as fe,v as ge,e as Z}from"./index-Nz0RLATp.js";const me={version:1},Q="https://cdn.jsdelivr.net/pyodide/v0.27.0/full/",V=new Map;async function he(d){const a=V.get(d);if(a)return a;const m=await fetch(Z.artifactUrl(d));if(!m.ok)throw new Error(`Failed to fetch plugin source: ${m.status}`);const y=await m.text();return V.set(d,y),y}async function ye(d){const a=await fetch(Z.artifactUrl(d));if(!a.ok)throw new Error(`Failed to fetch artifact: ${a.status}`);const m=await a.arrayBuffer(),y=new Uint8Array(m),_=new TextEncoder().encode("cairn-plugin:");if(y.length>=_.length){let k=!0;for(let o=0;o<_.length;o++)if(y[o]!==_[o]){k=!1;break}if(k){const o=y.indexOf(10);if(o>0)return m.slice(o+1)}}return m}function be(d){return`<!DOCTYPE html>
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
${d}
<\/script>
</body></html>`}function we(d){const a=d.replace(/\\/g,"\\\\").replace(/`/g,"\\`").replace(/\$/g,"\\$");return`<!DOCTYPE html>
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
<script src="${Q}pyodide.js"><\/script>
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
    pyodide = await loadPyodide({ indexURL: "${Q}" });
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
</body></html>`}function ve({runId:d,metric:a,extraSeries:m,controlledSeries:y,settingsKeyOverride:_,onRemove:k}){r.useMemo(()=>{const e=[{name:a.name,context_hash:a.context_hash},...(m??[]).map(t=>({runId:t.runId,name:t.name,context_hash:t.context_hash}))],n=new Set;return e.filter(t=>{const c=`${t.runId??""}::${t.name}::${t.context_hash}`;return n.has(c)?!1:(n.add(c),!0)})},[a.name,a.context_hash,m]);const[o,v]=de(_??{runId:d,metricName:a.name,contextHash:a.context_hash},me),O=ue(d,a.name,{context:a.context_hash||void 0,maxPoints:200}),R=r.useMemo(()=>{var e;return(((e=O.data)==null?void 0:e.points)??[]).filter(n=>n.artifact_hash)},[O.data]),S=r.useMemo(()=>{const e=new Set;for(const n of R)e.add(n.step);return Array.from(e).sort((n,t)=>n-t)},[R]),[ee,te]=r.useState(o.sliderStep??0),N=Math.min(Math.max(0,ee),Math.max(0,S.length-1)),b=S[N]??0,f=r.useMemo(()=>R.find(e=>e.step===b)??R[0],[R,b]),g=r.useMemo(()=>pe((f==null?void 0:f.artifact_metadata)??null)??{},[f]),T=r.useRef(null),[ne,se]=r.useState(300),[B,j]=r.useState(null),[D,F]=r.useState(!1),J=r.useRef("");r.useEffect(()=>()=>{C.current&&URL.revokeObjectURL(C.current)},[]),r.useEffect(()=>{const e=n=>{var t;((t=n.data)==null?void 0:t.type)==="cairn:resize"&&typeof n.data.height=="number"&&se(Math.max(100,Math.min(2e3,n.data.height)))};return window.addEventListener("message",e),()=>window.removeEventListener("message",e)},[]);const u=g.plugin_lang??"js",L=r.useRef(null),[q,re]=r.useState(null),ae=r.useRef(null),P=r.useRef(null),U=r.useRef(null),[A,z]=r.useState(!1),G=r.useRef(0),oe=r.useCallback(e=>{ae.current=e,e&&U.current&&(console.log("[PluginCard] Assigning WebRTC stream to <video>"),e.srcObject=U.current)},[]);r.useEffect(()=>{if(u!=="server"&&u!=="window"||!(f!=null&&f.artifact_hash)||!g.plugin_hash)return;const n=`${window.location.protocol==="https:"?"wss:":"ws:"}//${window.location.host}/ws/plugin/${d}/${encodeURIComponent(a.name)}`,t=new WebSocket(n);t.binaryType="blob",L.current=t,t.onopen=()=>{t.send(JSON.stringify({type:"render",artifact_hash:f.artifact_hash,metadata:g,step:b}));const p=K();if(u==="window"&&p!=="jpeg"){const s=new RTCPeerConnection({iceServers:[]});P.current=s,s.addTransceiver("video",{direction:"recvonly"}),s.ontrack=i=>{console.log("[PluginCard] WebRTC ontrack fired, track:",i.track.kind,i.track.readyState),U.current=i.streams[0]??new MediaStream([i.track]),z(!0)},s.createOffer().then(async i=>{var w;await s.setLocalDescription(i),await new Promise(x=>{if(s.iceGatheringState==="complete"){x();return}s.onicegatheringstatechange=()=>{s.iceGatheringState==="complete"&&x()},setTimeout(x,2e3)}),t.readyState===WebSocket.OPEN&&t.send(JSON.stringify({type:"webrtc_offer",sdp:(w=s.localDescription)==null?void 0:w.sdp}))}).catch(i=>{console.warn("[PluginCard] WebRTC offer failed:",i)})}};let c="";return t.onmessage=p=>{if(typeof p.data=="string"){const s=JSON.parse(p.data);s.type==="frame"?c=s.mime||"image/jpeg":s.type==="error"?j(s.message):s.type==="webrtc_answer"&&P.current?P.current.setRemoteDescription(new RTCSessionDescription({type:"answer",sdp:s.sdp})):s.type==="webrtc_failed"&&console.warn("[PluginCard] WebRTC failed:",s.message,"— using JPEG fallback")}else if(p.data instanceof Blob&&!A){const s=new Blob([p.data],{type:c}),i=URL.createObjectURL(s);re(w=>(w&&URL.revokeObjectURL(w),i))}},t.onerror=()=>j("WebSocket connection failed"),()=>{t.close(),L.current=null,P.current&&(P.current.close(),P.current=null),z(!1)}},[u,f,g,b,d,a.name]);const h=r.useCallback((e,n)=>{const t=L.current;if(!t||t.readyState!==WebSocket.OPEN)return;if(e==="move"){const X=performance.now();if(X-G.current<16)return;G.current=X}const c=n.currentTarget,p=c.naturalWidth||c.videoWidth||0,s=c.naturalHeight||c.videoHeight||0;if(!p||!s)return;const i=c.getBoundingClientRect(),w=i.width/i.height,x=p/s;let M,E,$,H;x>w?(M=i.width,E=i.width/x,$=0,H=(i.height-E)/2):(E=i.height,M=i.height*x,$=(i.width-M)/2,H=0);const I=n.clientX-i.left-$,W=n.clientY-i.top-H;if(I<0||W<0||I>M||W>E)return;const le=Math.round(I/M*p),ce=Math.round(W/E*s);t.send(JSON.stringify({type:"mouse",x:le,y:ce,button:n.button,action:e}))},[]),C=r.useRef(""),Y=r.useCallback(async()=>{if(!(u==="server"||u==="window")&&g.plugin_hash){j(null);try{const e=await he(g.plugin_hash),n=T.current;if(!n)return;const t=`${g.plugin_hash}:${u}`;if(J.current!==t){if(J.current=t,F(!1),u==="js")n.removeAttribute("src"),n.srcdoc=be(e);else{n.removeAttribute("srcdoc"),C.current&&URL.revokeObjectURL(C.current);const c=we(e),p=new Blob([c],{type:"text/html"}),s=URL.createObjectURL(p);C.current=s,n.src=s}await new Promise(c=>{n.onload=()=>c()}),F(!0)}}catch(e){j(e instanceof Error?e.message:String(e))}}},[g.plugin_hash,u]);r.useEffect(()=>{Y()},[Y]),r.useEffect(()=>{if(!D||!(f!=null&&f.artifact_hash))return;const e=T.current;if(!(e!=null&&e.contentWindow))return;let n=!1;return ye(f.artifact_hash).then(t=>{var p;if(n)return;const c=t.slice(0);(p=e.contentWindow)==null||p.postMessage({type:"cairn:render",data:c,metadata:g,step:b,runId:d,metricName:a.name},"*",[c])}).catch(t=>{n||j(t instanceof Error?t.message:String(t))}),()=>{n=!0}},[D,f,g,b,d,a.name]);const ie=S.length>0?`step ${b} (${N+1}/${S.length})`:g.plugin_name??"plugin";return l.jsxs("div",{className:"card p-4 flex flex-col",style:{position:"relative",height:o.collapsed?void 0:o.height??400,gridColumn:(o.colSpan??1)>1?`span ${o.colSpan}`:void 0},children:[l.jsx(fe,{title:o.title??a.name,onTitleChange:e=>v({title:e||void 0}),subtitle:ie,collapsed:o.collapsed,onToggleCollapse:()=>v({collapsed:!o.collapsed}),onToggleFullWidth:()=>v({colSpan:(o.colSpan??1)>1?1:2}),isFullWidth:(o.colSpan??1)>1,onRemove:k,children:l.jsx("span",{className:"inline-flex items-center rounded bg-bg-hover px-1.5 py-0.5 text-[10px] text-fg-muted",children:u==="window"?"Window":u==="server"?"Server":u==="py"?"Python":"JS"})}),!o.collapsed&&l.jsxs(l.Fragment,{children:[B?l.jsx("div",{className:"flex-1 rounded bg-bg p-3 text-xs text-status-failed overflow-auto",children:l.jsx("pre",{children:B})}):g.plugin_hash?u==="server"||u==="window"?A?l.jsx("video",{ref:oe,autoPlay:!0,playsInline:!0,muted:!0,className:"flex-1 w-full rounded object-contain cursor-grab active:cursor-grabbing",style:{minHeight:200,userSelect:"none"},onMouseDown:e=>{e.preventDefault(),h("down",e)},onMouseMove:e=>h("move",e),onMouseUp:e=>h("up",e),onMouseLeave:e=>h("up",e)}):K()!=="jpeg"&&u==="window"?l.jsxs("div",{className:"flex-1 flex items-center justify-center",children:[l.jsx("div",{className:"h-8 w-8 motion-safe:animate-spin rounded-full border-2 border-accent border-t-transparent"}),l.jsx("span",{className:"ml-2 text-xs text-fg-muted",children:"Starting WebRTC stream..."})]}):q?l.jsx("img",{src:q,alt:`Server plugin: ${g.plugin_name??a.name}`,className:"flex-1 w-full rounded object-contain cursor-grab active:cursor-grabbing",style:{minHeight:200,userSelect:"none"},draggable:!1,onMouseDown:e=>{e.preventDefault(),h("down",e)},onMouseMove:e=>h("move",e),onMouseUp:e=>h("up",e),onMouseLeave:e=>h("up",e)}):l.jsxs("div",{className:"flex-1 flex items-center justify-center",children:[l.jsx("div",{className:"h-8 w-8 motion-safe:animate-spin rounded-full border-2 border-accent border-t-transparent"}),l.jsx("span",{className:"ml-2 text-xs text-fg-muted",children:"Connecting to server..."})]}):l.jsx("iframe",{ref:T,...u==="js"?{sandbox:"allow-scripts"}:{},className:"flex-1 w-full rounded border-0",style:{height:ne,minHeight:200},title:`Plugin: ${g.plugin_name??a.name}`}):l.jsx("div",{className:"flex-1 flex items-center justify-center text-sm text-fg-muted",children:"No plugin metadata found"}),S.length>1&&l.jsx("input",{type:"range",min:0,max:S.length-1,value:N,onChange:e=>{const n=Number(e.target.value);te(n),v({sliderStep:n})},className:"mt-3 w-full accent-accent"})]}),l.jsx(ge,{height:o.height,onHeightChange:e=>v({height:e}),colSpan:o.colSpan??1,onColSpanChange:e=>v({colSpan:e})})]})}export{ve as default};
