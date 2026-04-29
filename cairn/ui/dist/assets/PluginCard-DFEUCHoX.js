import{u as ae,b as oe,r,s as ie,l as c,C as le,v as ce,e as K}from"./index-BrkLoX0q.js";const de={version:1},Y="https://cdn.jsdelivr.net/pyodide/v0.27.0/full/",X=new Map;async function ue(l){const o=X.get(l);if(o)return o;const h=await fetch(K.artifactUrl(l));if(!h.ok)throw new Error(`Failed to fetch plugin source: ${h.status}`);const b=await h.text();return X.set(l,b),b}async function pe(l){const o=await fetch(K.artifactUrl(l));if(!o.ok)throw new Error(`Failed to fetch artifact: ${o.status}`);const h=await o.arrayBuffer(),b=new Uint8Array(h),i=new TextEncoder().encode("cairn-plugin:");if(b.length>=i.length){let y=!0;for(let m=0;m<i.length;m++)if(b[m]!==i[m]){y=!1;break}if(y){const m=b.indexOf(10);if(m>0)return h.slice(m+1)}}return h}function fe(l){return`<!DOCTYPE html>
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
</body></html>`}function ge(l){const o=l.replace(/\\/g,"\\\\").replace(/`/g,"\\`").replace(/\$/g,"\\$");return`<!DOCTYPE html>
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
const PLUGIN_SOURCE = \`${o}\`;

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
</body></html>`}function he({runId:l,metric:o,settingsKeyOverride:h,onRemove:b}){const[i,y]=ae(h??{runId:l,metricName:o.name,contextHash:o.context_hash},de),m=oe(l,o.name,{context:o.context_hash||void 0,maxPoints:200}),_=r.useMemo(()=>{var e;return(((e=m.data)==null?void 0:e.points)??[]).filter(t=>t.artifact_hash)},[m.data]),P=r.useMemo(()=>{const e=new Set;for(const t of _)e.add(t.step);return Array.from(e).sort((t,n)=>t-n)},[_]),[Q,V]=r.useState(i.sliderStep??0),C=Math.min(Math.max(0,Q),Math.max(0,P.length-1)),x=P[C]??0,f=r.useMemo(()=>_.find(e=>e.step===x)??_[0],[_,x]),g=r.useMemo(()=>ie((f==null?void 0:f.artifact_metadata)??null)??{},[f]),k=r.useRef(null),[Z,ee]=r.useState(300),[B,R]=r.useState(null),[I,W]=r.useState(!1),D=r.useRef("");r.useEffect(()=>()=>{j.current&&URL.revokeObjectURL(j.current)},[]),r.useEffect(()=>{const e=t=>{var n;((n=t.data)==null?void 0:n.type)==="cairn:resize"&&typeof t.data.height=="number"&&ee(Math.max(100,Math.min(2e3,t.data.height)))};return window.addEventListener("message",e),()=>window.removeEventListener("message",e)},[]);const d=g.plugin_lang??"js",N=r.useRef(null),[F,te]=r.useState(null),L=r.useRef(null),S=r.useRef(null),[J,q]=r.useState(!1),A=r.useRef(0);r.useEffect(()=>{if(d!=="server"&&d!=="window"||!(f!=null&&f.artifact_hash)||!g.plugin_hash)return;const t=`${window.location.protocol==="https:"?"wss:":"ws:"}//${window.location.host}/ws/plugin/${l}/${encodeURIComponent(o.name)}`,n=new WebSocket(t);n.binaryType="blob",N.current=n,n.onopen=()=>{if(n.send(JSON.stringify({type:"render",artifact_hash:f.artifact_hash,metadata:g,step:x})),d==="window"){const a=new RTCPeerConnection({iceServers:[]});S.current=a,a.addTransceiver("video",{direction:"recvonly"}),a.ontrack=s=>{L.current&&(L.current.srcObject=s.streams[0]??new MediaStream([s.track])),q(!0)},a.createOffer().then(async s=>{var p;await a.setLocalDescription(s),await new Promise(v=>{if(a.iceGatheringState==="complete"){v();return}a.onicegatheringstatechange=()=>{a.iceGatheringState==="complete"&&v()},setTimeout(v,2e3)}),n.readyState===WebSocket.OPEN&&n.send(JSON.stringify({type:"webrtc_offer",sdp:(p=a.localDescription)==null?void 0:p.sdp}))}).catch(s=>{console.warn("[PluginCard] WebRTC offer failed:",s)})}};let u="";return n.onmessage=a=>{if(typeof a.data=="string"){const s=JSON.parse(a.data);s.type==="frame"?u=s.mime||"image/jpeg":s.type==="error"?R(s.message):s.type==="webrtc_answer"&&S.current?S.current.setRemoteDescription(new RTCSessionDescription({type:"answer",sdp:s.sdp})):s.type==="webrtc_failed"&&console.warn("[PluginCard] WebRTC failed:",s.message,"— using JPEG fallback")}else if(a.data instanceof Blob&&!J){const s=new Blob([a.data],{type:u}),p=URL.createObjectURL(s);te(v=>(v&&URL.revokeObjectURL(v),p))}},n.onerror=()=>R("WebSocket connection failed"),()=>{n.close(),N.current=null,S.current&&(S.current.close(),S.current=null),q(!1)}},[d,f,g,x,l,o.name]);const w=r.useCallback((e,t)=>{const n=N.current;if(!n||n.readyState!==WebSocket.OPEN)return;if(e==="move"){const G=performance.now();if(G-A.current<16)return;A.current=G}const u=t.currentTarget,a=u.naturalWidth||u.videoWidth||0,s=u.naturalHeight||u.videoHeight||0;if(!a||!s)return;const p=u.getBoundingClientRect(),v=p.width/p.height,T=a/s;let M,E,U,H;T>v?(M=p.width,E=p.width/T,U=0,H=(p.height-E)/2):(E=p.height,M=p.height*T,U=(p.width-M)/2,H=0);const O=t.clientX-p.left-U,$=t.clientY-p.top-H;if(O<0||$<0||O>M||$>E)return;const se=Math.round(O/M*a),re=Math.round($/E*s);n.send(JSON.stringify({type:"mouse",x:se,y:re,button:t.button,action:e}))},[]),j=r.useRef(""),z=r.useCallback(async()=>{if(!(d==="server"||d==="window")&&g.plugin_hash){R(null);try{const e=await ue(g.plugin_hash),t=k.current;if(!t)return;const n=`${g.plugin_hash}:${d}`;if(D.current!==n){if(D.current=n,W(!1),d==="js")t.removeAttribute("src"),t.srcdoc=fe(e);else{t.removeAttribute("srcdoc"),j.current&&URL.revokeObjectURL(j.current);const u=ge(e),a=new Blob([u],{type:"text/html"}),s=URL.createObjectURL(a);j.current=s,t.src=s}await new Promise(u=>{t.onload=()=>u()}),W(!0)}}catch(e){R(e instanceof Error?e.message:String(e))}}},[g.plugin_hash,d]);r.useEffect(()=>{z()},[z]),r.useEffect(()=>{if(!I||!(f!=null&&f.artifact_hash))return;const e=k.current;if(!(e!=null&&e.contentWindow))return;let t=!1;return pe(f.artifact_hash).then(n=>{var a;if(t)return;const u=n.slice(0);(a=e.contentWindow)==null||a.postMessage({type:"cairn:render",data:u,metadata:g,step:x,runId:l,metricName:o.name},"*",[u])}).catch(n=>{t||R(n instanceof Error?n.message:String(n))}),()=>{t=!0}},[I,f,g,x,l,o.name]);const ne=P.length>0?`step ${x} (${C+1}/${P.length})`:g.plugin_name??"plugin";return c.jsxs("div",{className:"card p-4 flex flex-col",style:{position:"relative",height:i.collapsed?void 0:i.height??400,gridColumn:(i.colSpan??1)>1?`span ${i.colSpan}`:void 0},children:[c.jsx(le,{title:i.title??o.name,onTitleChange:e=>y({title:e||void 0}),subtitle:ne,collapsed:i.collapsed,onToggleCollapse:()=>y({collapsed:!i.collapsed}),onToggleFullWidth:()=>y({colSpan:(i.colSpan??1)>1?1:2}),isFullWidth:(i.colSpan??1)>1,onRemove:b,children:c.jsx("span",{className:"inline-flex items-center rounded bg-bg-hover px-1.5 py-0.5 text-[10px] text-fg-muted",children:d==="window"?"Window":d==="server"?"Server":d==="py"?"Python":"JS"})}),!i.collapsed&&c.jsxs(c.Fragment,{children:[B?c.jsx("div",{className:"flex-1 rounded bg-bg p-3 text-xs text-status-failed overflow-auto",children:c.jsx("pre",{children:B})}):g.plugin_hash?d==="server"||d==="window"?J?c.jsx("video",{ref:L,autoPlay:!0,playsInline:!0,muted:!0,className:"flex-1 w-full rounded object-contain cursor-grab active:cursor-grabbing",style:{minHeight:200,userSelect:"none",background:"#161b22"},onMouseDown:e=>{e.preventDefault(),w("down",e)},onMouseMove:e=>w("move",e),onMouseUp:e=>w("up",e),onMouseLeave:e=>w("up",e)}):F?c.jsx("img",{src:F,alt:`Server plugin: ${g.plugin_name??o.name}`,className:"flex-1 w-full rounded object-contain cursor-grab active:cursor-grabbing",style:{minHeight:200,userSelect:"none"},draggable:!1,onMouseDown:e=>{e.preventDefault(),w("down",e)},onMouseMove:e=>w("move",e),onMouseUp:e=>w("up",e),onMouseLeave:e=>w("up",e)}):c.jsxs("div",{className:"flex-1 flex items-center justify-center",children:[c.jsx("div",{className:"h-8 w-8 motion-safe:animate-spin rounded-full border-2 border-accent border-t-transparent"}),c.jsx("span",{className:"ml-2 text-xs text-fg-muted",children:"Connecting to server..."})]}):c.jsx("iframe",{ref:k,...d==="js"?{sandbox:"allow-scripts"}:{},className:"flex-1 w-full rounded border-0",style:{height:Z,minHeight:200},title:`Plugin: ${g.plugin_name??o.name}`}):c.jsx("div",{className:"flex-1 flex items-center justify-center text-sm text-fg-muted",children:"No plugin metadata found"}),P.length>1&&c.jsx("input",{type:"range",min:0,max:P.length-1,value:C,onChange:e=>{const t=Number(e.target.value);V(t),y({sliderStep:t})},className:"mt-3 w-full accent-accent"})]}),c.jsx(ce,{height:i.height,onHeightChange:e=>y({height:e}),colSpan:i.colSpan??1,onColSpanChange:e=>y({colSpan:e})})]})}export{he as default};
