import{u as k,b as U,r,s as F,l as o,C as O,v as q,e as j}from"./index-DkDmawKF.js";const B={version:1},R="https://cdn.jsdelivr.net/pyodide/v0.27.0/full/",N=new Map;async function D(s){const n=N.get(s);if(n)return n;const u=await fetch(j.artifactUrl(s));if(!u.ok)throw new Error(`Failed to fetch plugin source: ${u.status}`);const h=await u.text();return N.set(s,h),h}async function z(s){const n=await fetch(j.artifactUrl(s));if(!n.ok)throw new Error(`Failed to fetch artifact: ${n.status}`);return n.arrayBuffer()}function A(s){return`<!DOCTYPE html>
<html><head>
<style>
  body { margin: 0; overflow: hidden; background: transparent; color: #c9d1d9; font-family: system-ui; }
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
${s}
<\/script>
</body></html>`}function G(s){const n=s.replace(/\\/g,"\\\\").replace(/`/g,"\\`").replace(/\$/g,"\\$");return`<!DOCTYPE html>
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
<script src="${R}pyodide.js"><\/script>
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
    pyodide = await loadPyodide({ indexURL: "${R}" });
    status.textContent = "Installing packages...";
    await pyodide.loadPackage("micropip");
    const micropip = pyodide.pyimport("micropip");
    const reqs = parseRequires(PLUGIN_SOURCE);
    for (const pkg of reqs) {
      await micropip.install(pkg);
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
    // If render() returns a string, inject as HTML. Otherwise matplotlib
    // renders directly to the DOM via the wasm_backend (no return needed).
    const html = (typeof result === "string") ? result :
                 (result && result.toString && result.toString() !== "None") ? result.toString() : null;
    if (html) {
      document.getElementById("output").innerHTML = html;
    }
    // Notify parent of new size.
    parent.postMessage({ type: "cairn:resize", height: document.documentElement.scrollHeight }, "*");
  } catch(err) {
    document.getElementById("output").innerHTML = '<pre style="color:#f85149">Render error: ' + err.message + '</pre>';
  }
}

window.addEventListener("message", function(e) {
  if (e.data && e.data.type === "cairn:render") handleRender(e.data);
});

initPyodide();
<\/script>
</body></html>`}function J({runId:s,metric:n,settingsKeyOverride:u,onRemove:h}){const[a,c]=k(u??{runId:s,metricName:n.name,contextHash:n.context_hash},B),b=U(s,n.name,{context:n.context_hash||void 0,maxPoints:200}),g=r.useMemo(()=>{var e;return(((e=b.data)==null?void 0:e.points)??[]).filter(t=>t.artifact_hash)},[b.data]),p=r.useMemo(()=>{const e=new Set;for(const t of g)e.add(t.step);return Array.from(e).sort((t,i)=>t-i)},[g]),[H,I]=r.useState(a.sliderStep??0),x=Math.min(Math.max(0,H),Math.max(0,p.length-1)),m=p[x]??0,l=r.useMemo(()=>g.find(e=>e.step===m)??g[0],[g,m]),d=r.useMemo(()=>F((l==null?void 0:l.artifact_metadata)??null)??{},[l]),w=r.useRef(null),[L,$]=r.useState(300),[v,S]=r.useState(null),[E,P]=r.useState(!1),M=r.useRef("");r.useEffect(()=>{const e=t=>{var i;((i=t.data)==null?void 0:i.type)==="cairn:resize"&&typeof t.data.height=="number"&&$(Math.max(100,Math.min(2e3,t.data.height)))};return window.addEventListener("message",e),()=>window.removeEventListener("message",e)},[]);const f=d.plugin_lang??"js",C=r.useCallback(async()=>{if(d.plugin_hash){S(null);try{const e=await D(d.plugin_hash),t=w.current;if(!t)return;const i=`${d.plugin_hash}:${f}`;M.current!==i&&(M.current=i,P(!1),t.srcdoc=f==="js"?A(e):G(e),await new Promise(y=>{t.onload=()=>y()}),P(!0))}catch(e){S(e instanceof Error?e.message:String(e))}}},[d.plugin_hash,f]);r.useEffect(()=>{C()},[C]),r.useEffect(()=>{if(!E||!(l!=null&&l.artifact_hash))return;const e=w.current;if(!(e!=null&&e.contentWindow))return;let t=!1;return z(l.artifact_hash).then(i=>{var _;if(t)return;const y=i.slice(0);(_=e.contentWindow)==null||_.postMessage({type:"cairn:render",data:y,metadata:d,step:m,runId:s,metricName:n.name},"*",[y])}).catch(i=>{t||S(i instanceof Error?i.message:String(i))}),()=>{t=!0}},[E,l,d,m,s,n.name]);const T=p.length>0?`step ${m} (${x+1}/${p.length})`:d.plugin_name??"plugin";return o.jsxs("div",{className:"card p-4 flex flex-col",style:{position:"relative",height:a.collapsed?void 0:a.height??void 0,gridColumn:(a.colSpan??1)>1?`span ${a.colSpan}`:void 0},children:[o.jsx(O,{title:a.title??n.name,onTitleChange:e=>c({title:e||void 0}),subtitle:T,collapsed:a.collapsed,onToggleCollapse:()=>c({collapsed:!a.collapsed}),onToggleFullWidth:()=>c({colSpan:(a.colSpan??1)>1?1:2}),isFullWidth:(a.colSpan??1)>1,onRemove:h,children:o.jsx("span",{className:"inline-flex items-center rounded bg-bg-hover px-1.5 py-0.5 text-[10px] text-fg-muted",children:f==="py"?"Python":"JS"})}),!a.collapsed&&o.jsxs(o.Fragment,{children:[v?o.jsx("div",{className:"flex-1 rounded bg-bg p-3 text-xs text-status-failed overflow-auto",children:o.jsx("pre",{children:v})}):d.plugin_hash?o.jsx("iframe",{ref:w,sandbox:"allow-scripts",className:"flex-1 w-full rounded border-0",style:{height:a.height?void 0:L,minHeight:100},title:`Plugin: ${d.plugin_name??n.name}`}):o.jsx("div",{className:"flex-1 flex items-center justify-center text-sm text-fg-muted",children:"No plugin metadata found"}),p.length>1&&o.jsx("input",{type:"range",min:0,max:p.length-1,value:x,onChange:e=>{const t=Number(e.target.value);I(t),c({sliderStep:t})},className:"mt-3 w-full accent-accent"})]}),o.jsx(q,{height:a.height,onHeightChange:e=>c({height:e}),colSpan:a.colSpan??1,onColSpanChange:e=>c({colSpan:e})})]})}export{J as default};
