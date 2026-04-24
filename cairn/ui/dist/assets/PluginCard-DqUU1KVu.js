import{u as O,b as I,r as o,s as W,l as r,C as z,v as B,e as $}from"./index-Csjib-1v.js";const L="https://cdn.jsdelivr.net/pyodide/v0.27.0/full/",A=`
importScripts("${L}pyodide.js");

let pyodide = null;
const installedPackages = new Set();

async function ensurePyodide() {
  if (pyodide) return pyodide;
  pyodide = await loadPyodide({ indexURL: "${L}" });
  await pyodide.loadPackage("micropip");
  return pyodide;
}

function parseRequires(source) {
  const match = source.match(/^#\\s*cairn-requires:\\s*(.+)$/m);
  if (!match) return [];
  return match[1].split(",").map(s => s.trim()).filter(Boolean);
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === "init") {
    try {
      await ensurePyodide();
      self.postMessage({ type: "ready" });
    } catch (err) {
      self.postMessage({ type: "error", message: String(err) });
    }
    return;
  }
  if (msg.type === "render") {
    try {
      const py = await ensurePyodide();
      // Install required packages
      const reqs = parseRequires(msg.source);
      const micropip = py.pyimport("micropip");
      for (const pkg of reqs) {
        if (!installedPackages.has(pkg)) {
          await micropip.install(pkg);
          installedPackages.add(pkg);
        }
      }
      // Load the plugin source
      py.runPython(msg.source);
      // Call render() with the data
      const renderFn = py.globals.get("render");
      if (!renderFn) {
        self.postMessage({ type: "error", message: "Plugin has no render() function" });
        return;
      }
      const dataBytes = new Uint8Array(msg.data);
      const result = renderFn(
        py.toPy(dataBytes),
        py.toPy(msg.metadata),
        msg.step,
        msg.runId,
        msg.metricName,
      );
      const html = typeof result === "string" ? result : result.toString();
      self.postMessage({ type: "result", html });
    } catch (err) {
      self.postMessage({ type: "error", message: String(err) });
    }
  }
};
`;let m=null,H=!1,v=null;function Y(){if(m)return m;const a=new Blob([A],{type:"application/javascript"});return m=new Worker(URL.createObjectURL(a)),v=new Promise((e,c)=>{const l=t=>{t.data.type==="ready"?(H=!0,m.removeEventListener("message",l),e()):t.data.type==="error"&&(m.removeEventListener("message",l),c(new Error(t.data.message)))};m.addEventListener("message",l)}),m.postMessage({type:"init"}),m}async function J(a){const e=Y();return!H&&v&&await v,new Promise((c,l)=>{const t=u=>{u.data.type==="result"?(e.removeEventListener("message",t),c(u.data.html)):u.data.type==="error"&&(e.removeEventListener("message",t),l(new Error(u.data.message)))};e.addEventListener("message",t);const d=a.data.slice(0);e.postMessage({type:"render",source:a.source,data:d,metadata:a.metadata,step:a.step,runId:a.runId,metricName:a.metricName},[d])})}const G={version:1},R=new Map;async function K(a){const e=R.get(a);if(e)return e;const c=await fetch($.artifactUrl(a));if(!c.ok)throw new Error(`Failed to fetch plugin source: ${c.status}`);const l=await c.text();return R.set(a,l),l}async function Q(a){const e=await fetch($.artifactUrl(a));if(!e.ok)throw new Error(`Failed to fetch artifact: ${e.status}`);return e.arrayBuffer()}function V(a){return`<!DOCTYPE html>
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
// Notify parent when content resizes.
new ResizeObserver(function() {
  var h = document.documentElement.scrollHeight;
  parent.postMessage({ type: "cairn:resize", height: h }, "*");
}).observe(document.body);
${a}
<\/script>
</body></html>`}function ee({runId:a,metric:e,settingsKeyOverride:c,onRemove:l}){const[t,d]=O(c??{runId:a,metricName:e.name,contextHash:e.context_hash},G),u=I(a,e.name,{context:e.context_hash||void 0,maxPoints:200}),x=o.useMemo(()=>{var s;return(((s=u.data)==null?void 0:s.points)??[]).filter(n=>n.artifact_hash)},[u.data]),f=o.useMemo(()=>{const s=new Set;for(const n of x)s.add(n.step);return Array.from(s).sort((n,g)=>n-g)},[x]),[F,T]=o.useState(t.sliderStep??0),w=Math.min(Math.max(0,F),Math.max(0,f.length-1)),y=f[w]??0,p=o.useMemo(()=>x.find(s=>s.step===y)??x[0],[x,y]),i=o.useMemo(()=>W((p==null?void 0:p.artifact_metadata)??null)??{},[p]),b=o.useRef(null),[S,q]=o.useState(300),[P,E]=o.useState(null),[j,M]=o.useState(null);o.useEffect(()=>{const s=n=>{var g;((g=n.data)==null?void 0:g.type)==="cairn:resize"&&typeof n.data.height=="number"&&q(Math.max(100,Math.min(2e3,n.data.height)))};return window.addEventListener("message",s),()=>window.removeEventListener("message",s)},[]);const N=o.useCallback(async()=>{var s;if(!(!(p!=null&&p.artifact_hash)||!i.plugin_hash)){E(null);try{const[n,g]=await Promise.all([K(i.plugin_hash),Q(p.artifact_hash)]);if((i.plugin_lang??"js")==="js"){const h=b.current;if(!h)return;const C=V(n);h.srcdoc!==C&&(h.srcdoc=C,await new Promise(U=>{h.onload=()=>U()}));const _=g.slice(0);(s=h.contentWindow)==null||s.postMessage({type:"cairn:render",data:_,metadata:i,step:y,runId:a,metricName:e.name},"*",[_]),M(null)}else{const h=await J({source:n,data:g,metadata:i,step:y,runId:a,metricName:e.name});M(h)}}catch(n){E(n instanceof Error?n.message:String(n))}}},[p,i,y,a,e.name]);o.useEffect(()=>{N()},[N]);const D=f.length>0?`step ${y} (${w+1}/${f.length})`:i.plugin_name??"plugin",k=i.plugin_lang??"js";return r.jsxs("div",{className:"card p-4 flex flex-col",style:{position:"relative",height:t.collapsed?void 0:t.height??void 0,gridColumn:(t.colSpan??1)>1?`span ${t.colSpan}`:void 0},children:[r.jsx(z,{title:t.title??e.name,onTitleChange:s=>d({title:s||void 0}),subtitle:D,collapsed:t.collapsed,onToggleCollapse:()=>d({collapsed:!t.collapsed}),onToggleFullWidth:()=>d({colSpan:(t.colSpan??1)>1?1:2}),isFullWidth:(t.colSpan??1)>1,onRemove:l,children:r.jsx("span",{className:"inline-flex items-center rounded bg-bg-hover px-1.5 py-0.5 text-[10px] text-fg-muted",children:k==="py"?"Python":"JS"})}),!t.collapsed&&r.jsxs(r.Fragment,{children:[P?r.jsx("div",{className:"flex-1 rounded bg-bg p-3 text-xs text-status-failed overflow-auto",children:r.jsx("pre",{children:P})}):i.plugin_hash?k==="js"?r.jsx("iframe",{ref:b,sandbox:"allow-scripts",className:"flex-1 w-full rounded border-0",style:{height:t.height?void 0:S,minHeight:100},title:`Plugin: ${i.plugin_name??e.name}`}):j?r.jsx("iframe",{sandbox:"allow-scripts",srcDoc:`<!DOCTYPE html><html><head><style>body{margin:0;background:transparent;color:#c9d1d9;font-family:system-ui}</style></head><body>${j}</body></html>`,className:"flex-1 w-full rounded border-0",style:{height:t.height?void 0:S,minHeight:100},title:`Plugin: ${i.plugin_name??e.name}`}):r.jsxs("div",{className:"flex-1 flex items-center justify-center",children:[r.jsx("div",{className:"h-8 w-8 motion-safe:animate-spin rounded-full border-2 border-accent border-t-transparent"}),r.jsx("span",{className:"ml-2 text-xs text-fg-muted",children:"Loading Pyodide..."})]}):r.jsx("div",{className:"flex-1 flex items-center justify-center text-sm text-fg-muted",children:"No plugin metadata found"}),f.length>1&&r.jsx("input",{type:"range",min:0,max:f.length-1,value:w,onChange:s=>{const n=Number(s.target.value);T(n),d({sliderStep:n})},className:"mt-3 w-full accent-accent"})]}),r.jsx(B,{height:t.height,onHeightChange:s=>d({height:s}),colSpan:t.colSpan??1,onColSpanChange:s=>d({colSpan:s})})]})}export{ee as default};
