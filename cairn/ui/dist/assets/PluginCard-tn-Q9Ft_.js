import{u as k,b as U,r as s,s as F,l as o,C as B,v as q,e as j}from"./index-BBwqp7p1.js";const D={version:1},N="https://cdn.jsdelivr.net/pyodide/v0.27.0/full/",_=new Map;async function z(a){const n=_.get(a);if(n)return n;const p=await fetch(j.artifactUrl(a));if(!p.ok)throw new Error(`Failed to fetch plugin source: ${p.status}`);const h=await p.text();return _.set(a,h),h}async function O(a){const n=await fetch(j.artifactUrl(a));if(!n.ok)throw new Error(`Failed to fetch artifact: ${n.status}`);return n.arrayBuffer()}function A(a){return`<!DOCTYPE html>
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
</body></html>`}function J({runId:a,metric:n,settingsKeyOverride:p,onRemove:h}){const[r,d]=k(p??{runId:a,metricName:n.name,contextHash:n.context_hash},D),b=U(a,n.name,{context:n.context_hash||void 0,maxPoints:200}),g=s.useMemo(()=>{var e;return(((e=b.data)==null?void 0:e.points)??[]).filter(t=>t.artifact_hash)},[b.data]),u=s.useMemo(()=>{const e=new Set;for(const t of g)e.add(t.step);return Array.from(e).sort((t,i)=>t-i)},[g]),[H,I]=s.useState(r.sliderStep??0),x=Math.min(Math.max(0,H),Math.max(0,u.length-1)),m=u[x]??0,c=s.useMemo(()=>g.find(e=>e.step===m)??g[0],[g,m]),l=s.useMemo(()=>F((c==null?void 0:c.artifact_metadata)??null)??{},[c]),w=s.useRef(null),[L,T]=s.useState(300),[v,S]=s.useState(null),[E,P]=s.useState(!1),C=s.useRef("");s.useEffect(()=>{const e=t=>{var i;((i=t.data)==null?void 0:i.type)==="cairn:resize"&&typeof t.data.height=="number"&&T(Math.max(100,Math.min(2e3,t.data.height)))};return window.addEventListener("message",e),()=>window.removeEventListener("message",e)},[]);const f=l.plugin_lang??"js",M=s.useCallback(async()=>{if(l.plugin_hash){S(null);try{const e=await z(l.plugin_hash),t=w.current;if(!t)return;const i=`${l.plugin_hash}:${f}`;C.current!==i&&(C.current=i,P(!1),t.srcdoc=f==="js"?A(e):G(e),await new Promise(y=>{t.onload=()=>y()}),P(!0))}catch(e){S(e instanceof Error?e.message:String(e))}}},[l.plugin_hash,f]);s.useEffect(()=>{M()},[M]),s.useEffect(()=>{if(!E||!(c!=null&&c.artifact_hash))return;const e=w.current;if(!(e!=null&&e.contentWindow))return;let t=!1;return O(c.artifact_hash).then(i=>{var R;if(t)return;const y=i.slice(0);(R=e.contentWindow)==null||R.postMessage({type:"cairn:render",data:y,metadata:l,step:m,runId:a,metricName:n.name},"*",[y])}).catch(i=>{t||S(i instanceof Error?i.message:String(i))}),()=>{t=!0}},[E,c,l,m,a,n.name]);const $=u.length>0?`step ${m} (${x+1}/${u.length})`:l.plugin_name??"plugin";return o.jsxs("div",{className:"card p-4 flex flex-col",style:{position:"relative",height:r.collapsed?void 0:r.height??400,gridColumn:(r.colSpan??1)>1?`span ${r.colSpan}`:void 0},children:[o.jsx(B,{title:r.title??n.name,onTitleChange:e=>d({title:e||void 0}),subtitle:$,collapsed:r.collapsed,onToggleCollapse:()=>d({collapsed:!r.collapsed}),onToggleFullWidth:()=>d({colSpan:(r.colSpan??1)>1?1:2}),isFullWidth:(r.colSpan??1)>1,onRemove:h,children:o.jsx("span",{className:"inline-flex items-center rounded bg-bg-hover px-1.5 py-0.5 text-[10px] text-fg-muted",children:f==="py"?"Python":"JS"})}),!r.collapsed&&o.jsxs(o.Fragment,{children:[v?o.jsx("div",{className:"flex-1 rounded bg-bg p-3 text-xs text-status-failed overflow-auto",children:o.jsx("pre",{children:v})}):l.plugin_hash?o.jsx("iframe",{ref:w,sandbox:f==="py"?"allow-scripts allow-same-origin":"allow-scripts",className:"flex-1 w-full rounded border-0",style:{height:L,minHeight:200},title:`Plugin: ${l.plugin_name??n.name}`}):o.jsx("div",{className:"flex-1 flex items-center justify-center text-sm text-fg-muted",children:"No plugin metadata found"}),u.length>1&&o.jsx("input",{type:"range",min:0,max:u.length-1,value:x,onChange:e=>{const t=Number(e.target.value);I(t),d({sliderStep:t})},className:"mt-3 w-full accent-accent"})]}),o.jsx(q,{height:r.height,onHeightChange:e=>d({height:e}),colSpan:r.colSpan??1,onColSpanChange:e=>d({colSpan:e})})]})}export{J as default};
