import{u as F,b as B,r as s,s as O,l as i,C as q,v as D,e as _}from"./index-9sQ2n-qa.js";const z={version:1},N="https://cdn.jsdelivr.net/pyodide/v0.28.0/full/",U=new Map;async function A(r){const n=U.get(r);if(n)return n;const g=await fetch(_.artifactUrl(r));if(!g.ok)throw new Error(`Failed to fetch plugin source: ${g.status}`);const x=await g.text();return U.set(r,x),x}async function G(r){const n=await fetch(_.artifactUrl(r));if(!n.ok)throw new Error(`Failed to fetch artifact: ${n.status}`);return n.arrayBuffer()}function W(r){return`<!DOCTYPE html>
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
${r}
<\/script>
</body></html>`}function J(r){const n=r.replace(/\\/g,"\\\\").replace(/`/g,"\\`").replace(/\$/g,"\\$");return`<!DOCTYPE html>
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
</body></html>`}function K({runId:r,metric:n,settingsKeyOverride:g,onRemove:x}){const[a,d]=F(g??{runId:r,metricName:n.name,contextHash:n.context_hash},z),E=B(r,n.name,{context:n.context_hash||void 0,maxPoints:200}),m=s.useMemo(()=>{var e;return(((e=E.data)==null?void 0:e.points)??[]).filter(t=>t.artifact_hash)},[E.data]),u=s.useMemo(()=>{const e=new Set;for(const t of m)e.add(t.step);return Array.from(e).sort((t,o)=>t-o)},[m]),[H,I]=s.useState(a.sliderStep??0),w=Math.min(Math.max(0,H),Math.max(0,u.length-1)),f=u[w]??0,l=s.useMemo(()=>m.find(e=>e.step===f)??m[0],[m,f]),c=s.useMemo(()=>O((l==null?void 0:l.artifact_metadata)??null)??{},[l]),v=s.useRef(null),[T,$]=s.useState(300),[R,S]=s.useState(null),[P,C]=s.useState(!1),M=s.useRef("");s.useEffect(()=>()=>{y.current&&URL.revokeObjectURL(y.current)},[]),s.useEffect(()=>{const e=t=>{var o;((o=t.data)==null?void 0:o.type)==="cairn:resize"&&typeof t.data.height=="number"&&$(Math.max(100,Math.min(2e3,t.data.height)))};return window.addEventListener("message",e),()=>window.removeEventListener("message",e)},[]);const h=c.plugin_lang??"js",y=s.useRef(""),L=s.useCallback(async()=>{if(c.plugin_hash){S(null);try{const e=await A(c.plugin_hash),t=v.current;if(!t)return;const o=`${c.plugin_hash}:${h}`;if(M.current!==o){if(M.current=o,C(!1),h==="js")t.removeAttribute("src"),t.srcdoc=W(e);else{t.removeAttribute("srcdoc"),y.current&&URL.revokeObjectURL(y.current);const p=J(e),b=new Blob([p],{type:"text/html"}),j=URL.createObjectURL(b);y.current=j,t.src=j}await new Promise(p=>{t.onload=()=>p()}),C(!0)}}catch(e){S(e instanceof Error?e.message:String(e))}}},[c.plugin_hash,h]);s.useEffect(()=>{L()},[L]),s.useEffect(()=>{if(!P||!(l!=null&&l.artifact_hash))return;const e=v.current;if(!(e!=null&&e.contentWindow))return;let t=!1;return G(l.artifact_hash).then(o=>{var b;if(t)return;const p=o.slice(0);(b=e.contentWindow)==null||b.postMessage({type:"cairn:render",data:p,metadata:c,step:f,runId:r,metricName:n.name},"*",[p])}).catch(o=>{t||S(o instanceof Error?o.message:String(o))}),()=>{t=!0}},[P,l,c,f,r,n.name]);const k=u.length>0?`step ${f} (${w+1}/${u.length})`:c.plugin_name??"plugin";return i.jsxs("div",{className:"card p-4 flex flex-col",style:{position:"relative",height:a.collapsed?void 0:a.height??400,gridColumn:(a.colSpan??1)>1?`span ${a.colSpan}`:void 0},children:[i.jsx(q,{title:a.title??n.name,onTitleChange:e=>d({title:e||void 0}),subtitle:k,collapsed:a.collapsed,onToggleCollapse:()=>d({collapsed:!a.collapsed}),onToggleFullWidth:()=>d({colSpan:(a.colSpan??1)>1?1:2}),isFullWidth:(a.colSpan??1)>1,onRemove:x,children:i.jsx("span",{className:"inline-flex items-center rounded bg-bg-hover px-1.5 py-0.5 text-[10px] text-fg-muted",children:h==="py"?"Python":"JS"})}),!a.collapsed&&i.jsxs(i.Fragment,{children:[R?i.jsx("div",{className:"flex-1 rounded bg-bg p-3 text-xs text-status-failed overflow-auto",children:i.jsx("pre",{children:R})}):c.plugin_hash?i.jsx("iframe",{ref:v,...h==="js"?{sandbox:"allow-scripts"}:{},className:"flex-1 w-full rounded border-0",style:{height:T,minHeight:200},title:`Plugin: ${c.plugin_name??n.name}`}):i.jsx("div",{className:"flex-1 flex items-center justify-center text-sm text-fg-muted",children:"No plugin metadata found"}),u.length>1&&i.jsx("input",{type:"range",min:0,max:u.length-1,value:w,onChange:e=>{const t=Number(e.target.value);I(t),d({sliderStep:t})},className:"mt-3 w-full accent-accent"})]}),i.jsx(D,{height:a.height,onHeightChange:e=>d({height:e}),colSpan:a.colSpan??1,onColSpanChange:e=>d({colSpan:e})})]})}export{K as default};
