import{u as ce,b as le,r,s as de,y as Y,l as i,C as ue,v as pe,e as Q}from"./index-BJXxtOkU.js";const fe={version:1},X="https://cdn.jsdelivr.net/pyodide/v0.27.0/full/",K=new Map;async function ge(l){const o=K.get(l);if(o)return o;const h=await fetch(Q.artifactUrl(l));if(!h.ok)throw new Error(`Failed to fetch plugin source: ${h.status}`);const b=await h.text();return K.set(l,b),b}async function me(l){const o=await fetch(Q.artifactUrl(l));if(!o.ok)throw new Error(`Failed to fetch artifact: ${o.status}`);const h=await o.arrayBuffer(),b=new Uint8Array(h),c=new TextEncoder().encode("cairn-plugin:");if(b.length>=c.length){let y=!0;for(let m=0;m<c.length;m++)if(b[m]!==c[m]){y=!1;break}if(y){const m=b.indexOf(10);if(m>0)return h.slice(m+1)}}return h}function he(l){return`<!DOCTYPE html>
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
</body></html>`}function ye(l){const o=l.replace(/\\/g,"\\\\").replace(/`/g,"\\`").replace(/\$/g,"\\$");return`<!DOCTYPE html>
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
<script src="${X}pyodide.js"><\/script>
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
    pyodide = await loadPyodide({ indexURL: "${X}" });
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
</body></html>`}function we({runId:l,metric:o,settingsKeyOverride:h,onRemove:b}){const[c,y]=ce(h??{runId:l,metricName:o.name,contextHash:o.context_hash},fe),m=le(l,o.name,{context:o.context_hash||void 0,maxPoints:200}),R=r.useMemo(()=>{var e;return(((e=m.data)==null?void 0:e.points)??[]).filter(t=>t.artifact_hash)},[m.data]),P=r.useMemo(()=>{const e=new Set;for(const t of R)e.add(t.step);return Array.from(e).sort((t,n)=>t-n)},[R]),[V,Z]=r.useState(c.sliderStep??0),k=Math.min(Math.max(0,V),Math.max(0,P.length-1)),x=P[k]??0,f=r.useMemo(()=>R.find(e=>e.step===x)??R[0],[R,x]),g=r.useMemo(()=>de((f==null?void 0:f.artifact_metadata)??null)??{},[f]),N=r.useRef(null),[ee,te]=r.useState(300),[$,j]=r.useState(null),[B,I]=r.useState(!1),D=r.useRef("");r.useEffect(()=>()=>{C.current&&URL.revokeObjectURL(C.current)},[]),r.useEffect(()=>{const e=t=>{var n;((n=t.data)==null?void 0:n.type)==="cairn:resize"&&typeof t.data.height=="number"&&te(Math.max(100,Math.min(2e3,t.data.height)))};return window.addEventListener("message",e),()=>window.removeEventListener("message",e)},[]);const d=g.plugin_lang??"js",T=r.useRef(null),[F,ne]=r.useState(null),se=r.useRef(null),_=r.useRef(null),L=r.useRef(null),[J,q]=r.useState(!1),A=r.useRef(0),re=r.useCallback(e=>{se.current=e,e&&L.current&&(console.log("[PluginCard] Assigning WebRTC stream to <video>"),e.srcObject=L.current)},[]);r.useEffect(()=>{if(d!=="server"&&d!=="window"||!(f!=null&&f.artifact_hash)||!g.plugin_hash)return;const t=`${window.location.protocol==="https:"?"wss:":"ws:"}//${window.location.host}/ws/plugin/${l}/${encodeURIComponent(o.name)}`,n=new WebSocket(t);n.binaryType="blob",T.current=n,n.onopen=()=>{n.send(JSON.stringify({type:"render",artifact_hash:f.artifact_hash,metadata:g,step:x}));const p=Y();if(d==="window"&&p!=="jpeg"){const s=new RTCPeerConnection({iceServers:[]});_.current=s,s.addTransceiver("video",{direction:"recvonly"}),s.ontrack=a=>{console.log("[PluginCard] WebRTC ontrack fired, track:",a.track.kind,a.track.readyState),L.current=a.streams[0]??new MediaStream([a.track]),q(!0)},s.createOffer().then(async a=>{var v;await s.setLocalDescription(a),await new Promise(S=>{if(s.iceGatheringState==="complete"){S();return}s.onicegatheringstatechange=()=>{s.iceGatheringState==="complete"&&S()},setTimeout(S,2e3)}),n.readyState===WebSocket.OPEN&&n.send(JSON.stringify({type:"webrtc_offer",sdp:(v=s.localDescription)==null?void 0:v.sdp}))}).catch(a=>{console.warn("[PluginCard] WebRTC offer failed:",a)})}};let u="";return n.onmessage=p=>{if(typeof p.data=="string"){const s=JSON.parse(p.data);s.type==="frame"?u=s.mime||"image/jpeg":s.type==="error"?j(s.message):s.type==="webrtc_answer"&&_.current?_.current.setRemoteDescription(new RTCSessionDescription({type:"answer",sdp:s.sdp})):s.type==="webrtc_failed"&&console.warn("[PluginCard] WebRTC failed:",s.message,"— using JPEG fallback")}else if(p.data instanceof Blob&&!J){const s=new Blob([p.data],{type:u}),a=URL.createObjectURL(s);ne(v=>(v&&URL.revokeObjectURL(v),a))}},n.onerror=()=>j("WebSocket connection failed"),()=>{n.close(),T.current=null,_.current&&(_.current.close(),_.current=null),q(!1)}},[d,f,g,x,l,o.name]);const w=r.useCallback((e,t)=>{const n=T.current;if(!n||n.readyState!==WebSocket.OPEN)return;if(e==="move"){const G=performance.now();if(G-A.current<16)return;A.current=G}const u=t.currentTarget,p=u.naturalWidth||u.videoWidth||0,s=u.naturalHeight||u.videoHeight||0;if(!p||!s)return;const a=u.getBoundingClientRect(),v=a.width/a.height,S=p/s;let M,E,U,H;S>v?(M=a.width,E=a.width/S,U=0,H=(a.height-E)/2):(E=a.height,M=a.height*S,U=(a.width-M)/2,H=0);const W=t.clientX-a.left-U,O=t.clientY-a.top-H;if(W<0||O<0||W>M||O>E)return;const oe=Math.round(W/M*p),ie=Math.round(O/E*s);n.send(JSON.stringify({type:"mouse",x:oe,y:ie,button:t.button,action:e}))},[]),C=r.useRef(""),z=r.useCallback(async()=>{if(!(d==="server"||d==="window")&&g.plugin_hash){j(null);try{const e=await ge(g.plugin_hash),t=N.current;if(!t)return;const n=`${g.plugin_hash}:${d}`;if(D.current!==n){if(D.current=n,I(!1),d==="js")t.removeAttribute("src"),t.srcdoc=he(e);else{t.removeAttribute("srcdoc"),C.current&&URL.revokeObjectURL(C.current);const u=ye(e),p=new Blob([u],{type:"text/html"}),s=URL.createObjectURL(p);C.current=s,t.src=s}await new Promise(u=>{t.onload=()=>u()}),I(!0)}}catch(e){j(e instanceof Error?e.message:String(e))}}},[g.plugin_hash,d]);r.useEffect(()=>{z()},[z]),r.useEffect(()=>{if(!B||!(f!=null&&f.artifact_hash))return;const e=N.current;if(!(e!=null&&e.contentWindow))return;let t=!1;return me(f.artifact_hash).then(n=>{var p;if(t)return;const u=n.slice(0);(p=e.contentWindow)==null||p.postMessage({type:"cairn:render",data:u,metadata:g,step:x,runId:l,metricName:o.name},"*",[u])}).catch(n=>{t||j(n instanceof Error?n.message:String(n))}),()=>{t=!0}},[B,f,g,x,l,o.name]);const ae=P.length>0?`step ${x} (${k+1}/${P.length})`:g.plugin_name??"plugin";return i.jsxs("div",{className:"card p-4 flex flex-col",style:{position:"relative",height:c.collapsed?void 0:c.height??400,gridColumn:(c.colSpan??1)>1?`span ${c.colSpan}`:void 0},children:[i.jsx(ue,{title:c.title??o.name,onTitleChange:e=>y({title:e||void 0}),subtitle:ae,collapsed:c.collapsed,onToggleCollapse:()=>y({collapsed:!c.collapsed}),onToggleFullWidth:()=>y({colSpan:(c.colSpan??1)>1?1:2}),isFullWidth:(c.colSpan??1)>1,onRemove:b,children:i.jsx("span",{className:"inline-flex items-center rounded bg-bg-hover px-1.5 py-0.5 text-[10px] text-fg-muted",children:d==="window"?"Window":d==="server"?"Server":d==="py"?"Python":"JS"})}),!c.collapsed&&i.jsxs(i.Fragment,{children:[$?i.jsx("div",{className:"flex-1 rounded bg-bg p-3 text-xs text-status-failed overflow-auto",children:i.jsx("pre",{children:$})}):g.plugin_hash?d==="server"||d==="window"?J?i.jsx("video",{ref:re,autoPlay:!0,playsInline:!0,muted:!0,className:"flex-1 w-full rounded object-contain cursor-grab active:cursor-grabbing",style:{minHeight:200,userSelect:"none"},onMouseDown:e=>{e.preventDefault(),w("down",e)},onMouseMove:e=>w("move",e),onMouseUp:e=>w("up",e),onMouseLeave:e=>w("up",e)}):Y()!=="jpeg"&&d==="window"?i.jsxs("div",{className:"flex-1 flex items-center justify-center",children:[i.jsx("div",{className:"h-8 w-8 motion-safe:animate-spin rounded-full border-2 border-accent border-t-transparent"}),i.jsx("span",{className:"ml-2 text-xs text-fg-muted",children:"Starting WebRTC stream..."})]}):F?i.jsx("img",{src:F,alt:`Server plugin: ${g.plugin_name??o.name}`,className:"flex-1 w-full rounded object-contain cursor-grab active:cursor-grabbing",style:{minHeight:200,userSelect:"none"},draggable:!1,onMouseDown:e=>{e.preventDefault(),w("down",e)},onMouseMove:e=>w("move",e),onMouseUp:e=>w("up",e),onMouseLeave:e=>w("up",e)}):i.jsxs("div",{className:"flex-1 flex items-center justify-center",children:[i.jsx("div",{className:"h-8 w-8 motion-safe:animate-spin rounded-full border-2 border-accent border-t-transparent"}),i.jsx("span",{className:"ml-2 text-xs text-fg-muted",children:"Connecting to server..."})]}):i.jsx("iframe",{ref:N,...d==="js"?{sandbox:"allow-scripts"}:{},className:"flex-1 w-full rounded border-0",style:{height:ee,minHeight:200},title:`Plugin: ${g.plugin_name??o.name}`}):i.jsx("div",{className:"flex-1 flex items-center justify-center text-sm text-fg-muted",children:"No plugin metadata found"}),P.length>1&&i.jsx("input",{type:"range",min:0,max:P.length-1,value:k,onChange:e=>{const t=Number(e.target.value);Z(t),y({sliderStep:t})},className:"mt-3 w-full accent-accent"})]}),i.jsx(pe,{height:c.height,onHeightChange:e=>y({height:e}),colSpan:c.colSpan??1,onColSpanChange:e=>y({colSpan:e})})]})}export{we as default};
