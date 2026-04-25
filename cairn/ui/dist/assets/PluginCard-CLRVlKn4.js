import{u as F,b as B,r,s as O,l as i,C as q,v as D,e as U}from"./index-BKH2j0_Y.js";const z={version:1},N="https://cdn.jsdelivr.net/pyodide/v0.27.0/full/",_=new Map;async function A(a){const n=_.get(a);if(n)return n;const m=await fetch(U.artifactUrl(a));if(!m.ok)throw new Error(`Failed to fetch plugin source: ${m.status}`);const x=await m.text();return _.set(a,x),x}async function G(a){const n=await fetch(U.artifactUrl(a));if(!n.ok)throw new Error(`Failed to fetch artifact: ${n.status}`);return n.arrayBuffer()}function W(a){return`<!DOCTYPE html>
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
</body></html>`}function J(a){const n=a.replace(/\\/g,"\\\\").replace(/`/g,"\\`").replace(/\$/g,"\\$");return`<!DOCTYPE html>
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
<script src="${N}pyodide.js"><\/script>
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
    pyodide = await loadPyodide({ indexURL: "${N}" });
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
    const renderFn = pyodide.globals.get("render");
    if (!renderFn) {
      document.getElementById("output").innerHTML = '<pre style="color:#f85149">Plugin has no render() function</pre>';
      return;
    }
    const dataBytes = new Uint8Array(msg.data);
    const result = renderFn(
      pyodide.toPy(dataBytes),
      pyodide.toPy(msg.metadata),
      msg.step,
      msg.runId,
      msg.metricName,
    );
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
</body></html>`}function K({runId:a,metric:n,settingsKeyOverride:m,onRemove:x}){const[s,d]=F(m??{runId:a,metricName:n.name,contextHash:n.context_hash},z),E=B(a,n.name,{context:n.context_hash||void 0,maxPoints:200}),g=r.useMemo(()=>{var e;return(((e=E.data)==null?void 0:e.points)??[]).filter(t=>t.artifact_hash)},[E.data]),u=r.useMemo(()=>{const e=new Set;for(const t of g)e.add(t.step);return Array.from(e).sort((t,o)=>t-o)},[g]),[H,I]=r.useState(s.sliderStep??0),w=Math.min(Math.max(0,H),Math.max(0,u.length-1)),f=u[w]??0,c=r.useMemo(()=>g.find(e=>e.step===f)??g[0],[g,f]),l=r.useMemo(()=>O((c==null?void 0:c.artifact_metadata)??null)??{},[c]),v=r.useRef(null),[T,$]=r.useState(300),[P,S]=r.useState(null),[R,C]=r.useState(!1),M=r.useRef("");r.useEffect(()=>()=>{y.current&&URL.revokeObjectURL(y.current)},[]),r.useEffect(()=>{const e=t=>{var o;((o=t.data)==null?void 0:o.type)==="cairn:resize"&&typeof t.data.height=="number"&&$(Math.max(100,Math.min(2e3,t.data.height)))};return window.addEventListener("message",e),()=>window.removeEventListener("message",e)},[]);const h=l.plugin_lang??"js",y=r.useRef(""),L=r.useCallback(async()=>{if(l.plugin_hash){S(null);try{const e=await A(l.plugin_hash),t=v.current;if(!t)return;const o=`${l.plugin_hash}:${h}`;if(M.current!==o){if(M.current=o,C(!1),h==="js")t.removeAttribute("src"),t.srcdoc=W(e);else{t.removeAttribute("srcdoc"),y.current&&URL.revokeObjectURL(y.current);const p=J(e),b=new Blob([p],{type:"text/html"}),j=URL.createObjectURL(b);y.current=j,t.src=j}await new Promise(p=>{t.onload=()=>p()}),C(!0)}}catch(e){S(e instanceof Error?e.message:String(e))}}},[l.plugin_hash,h]);r.useEffect(()=>{L()},[L]),r.useEffect(()=>{if(!R||!(c!=null&&c.artifact_hash))return;const e=v.current;if(!(e!=null&&e.contentWindow))return;let t=!1;return G(c.artifact_hash).then(o=>{var b;if(t)return;const p=o.slice(0);(b=e.contentWindow)==null||b.postMessage({type:"cairn:render",data:p,metadata:l,step:f,runId:a,metricName:n.name},"*",[p])}).catch(o=>{t||S(o instanceof Error?o.message:String(o))}),()=>{t=!0}},[R,c,l,f,a,n.name]);const k=u.length>0?`step ${f} (${w+1}/${u.length})`:l.plugin_name??"plugin";return i.jsxs("div",{className:"card p-4 flex flex-col",style:{position:"relative",height:s.collapsed?void 0:s.height??400,gridColumn:(s.colSpan??1)>1?`span ${s.colSpan}`:void 0},children:[i.jsx(q,{title:s.title??n.name,onTitleChange:e=>d({title:e||void 0}),subtitle:k,collapsed:s.collapsed,onToggleCollapse:()=>d({collapsed:!s.collapsed}),onToggleFullWidth:()=>d({colSpan:(s.colSpan??1)>1?1:2}),isFullWidth:(s.colSpan??1)>1,onRemove:x,children:i.jsx("span",{className:"inline-flex items-center rounded bg-bg-hover px-1.5 py-0.5 text-[10px] text-fg-muted",children:h==="py"?"Python":"JS"})}),!s.collapsed&&i.jsxs(i.Fragment,{children:[P?i.jsx("div",{className:"flex-1 rounded bg-bg p-3 text-xs text-status-failed overflow-auto",children:i.jsx("pre",{children:P})}):l.plugin_hash?i.jsx("iframe",{ref:v,...h==="js"?{sandbox:"allow-scripts"}:{},className:"flex-1 w-full rounded border-0",style:{height:T,minHeight:200},title:`Plugin: ${l.plugin_name??n.name}`}):i.jsx("div",{className:"flex-1 flex items-center justify-center text-sm text-fg-muted",children:"No plugin metadata found"}),u.length>1&&i.jsx("input",{type:"range",min:0,max:u.length-1,value:w,onChange:e=>{const t=Number(e.target.value);I(t),d({sliderStep:t})},className:"mt-3 w-full accent-accent"})]}),i.jsx(D,{height:s.height,onHeightChange:e=>d({height:e}),colSpan:s.colSpan??1,onColSpanChange:e=>d({colSpan:e})})]})}export{K as default};
