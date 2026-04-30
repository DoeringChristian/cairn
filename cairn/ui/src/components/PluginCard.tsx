/**
 * Plugin card — renders custom JS or Python viewer plugins in sandboxed iframes.
 * Supports multiple viewports in comparison views (one per run).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useSequence } from "../api/hooks";
import { api } from "../api/client";
import { safeJsonParse } from "../lib/format";
import { useCardSettings, resolveCardHeight, toggleColSpanPatch, type CardSettingsKey } from "../lib/card-settings";
import { shortRunLabel, useRunMetadataVersion } from "../lib/run-label";
import type { SequenceMeta, SequenceResponse, SequencePoint } from "../api/types";
import type { ComparisonSeriesRef } from "../lib/comparisons";
import CardHeader from "./CardHeader";
import CardResizeHandle from "./CardResizeHandle";

interface Props {
  runId: string;
  metric: SequenceMeta;
  extraSeries?: ComparisonSeriesRef[];
  controlledSeries?: boolean;
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
}

interface PluginMeta {
  plugin_hash?: string;
  plugin_lang?: "js" | "py" | "server" | "window";
  plugin_name?: string;
  [key: string]: unknown;
}

interface PluginSettings {
  version: 1;
  title?: string;
  collapsed?: boolean;
  sliderStep?: number;
  height?: number;
  height1?: number;
  height2?: number;
  colSpan?: number;
}

const DEFAULT_SETTINGS: PluginSettings = { version: 1 };
const PYODIDE_CDN = "https://cdn.jsdelivr.net/pyodide/v0.27.0/full/";

const sourceCache = new Map<string, string>();

async function fetchPluginSource(hash: string): Promise<string> {
  const cached = sourceCache.get(hash);
  if (cached) return cached;
  const resp = await fetch(api.artifactUrl(hash));
  if (!resp.ok) throw new Error(`Failed to fetch plugin source: ${resp.status}`);
  const text = await resp.text();
  sourceCache.set(hash, text);
  return text;
}

async function fetchArtifactData(hash: string): Promise<ArrayBuffer> {
  const resp = await fetch(api.artifactUrl(hash));
  if (!resp.ok) throw new Error(`Failed to fetch artifact: ${resp.status}`);
  const buf = await resp.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const PREFIX = new TextEncoder().encode("cairn-plugin:");
  if (bytes.length >= PREFIX.length) {
    let match = true;
    for (let i = 0; i < PREFIX.length; i++) {
      if (bytes[i] !== PREFIX[i]) { match = false; break; }
    }
    if (match) {
      const nl = bytes.indexOf(10);
      if (nl > 0) return buf.slice(nl + 1);
    }
  }
  return buf;
}

function buildJsIframeSrcdoc(pluginSource: string): string {
  return `<!DOCTYPE html><html><head><style>body{margin:0;background:transparent;color:#c9d1d9;font-family:system-ui}canvas{display:block}</style></head><body><script>
window.cairn={};
window.addEventListener("message",function(e){if(e.data&&e.data.type==="cairn:render"&&window.cairn.render){try{window.cairn.render(e.data)}catch(err){document.body.innerHTML='<pre style="color:#f85149;padding:8px">'+err.message+'</pre>'}}});
new ResizeObserver(function(){parent.postMessage({type:"cairn:resize",height:document.documentElement.scrollHeight},"*")}).observe(document.body);
${pluginSource}
</script></body></html>`;
}

function buildPyIframeSrcdoc(pluginSource: string): string {
  const escaped = pluginSource.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
  return `<!DOCTYPE html><html><head><style>body{margin:0;background:transparent;color:#c9d1d9;font-family:system-ui}#status{padding:12px;font-size:12px;color:#8b949e}.spinner{display:inline-block;width:16px;height:16px;border:2px solid #0969da;border-top-color:transparent;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body>
<div id="status"><span class="spinner"></span> Loading Pyodide...</div><div id="output"></div>
<script src="https://cdn.plot.ly/plotly-2.35.2.min.js" charset="utf-8"></script>
<script src="${PYODIDE_CDN}pyodide.js"></script>
<script>
const PLUGIN_SOURCE=\`${escaped}\`;
function parseRequires(src){const m=src.match(/^#\\s*cairn-requires:\\s*(.+)$/m);return m?m[1].split(",").map(s=>s.trim()).filter(Boolean):[];}
let pyodide=null,pendingMsg=null;
async function initPyodide(){const status=document.getElementById("status");try{pyodide=await loadPyodide({indexURL:"${PYODIDE_CDN}"});status.textContent="Installing packages...";await pyodide.loadPackage("micropip");const micropip=pyodide.pyimport("micropip");const reqs=parseRequires(PLUGIN_SOURCE);for(const pkg of reqs){await micropip.install(pkg);}if(reqs.some(r=>r==="matplotlib")){pyodide.runPython("import matplotlib; matplotlib.use('webagg')");}pyodide.runPython(\`
class _TypeWrapper:
 object_type=""
 def __init__(self,obj=None,**kwargs):self.obj=obj;self.kwargs=kwargs
class _PluginBase(_TypeWrapper):
 object_type="plugin";name=""
class JSPlugin(_PluginBase):pass
class PythonPlugin(_PluginBase):
 requires=[]
 def render(self,data,metadata,step):raise NotImplementedError
class ServerPlugin(_PluginBase):
 def render(self,data,metadata,step):raise NotImplementedError
 def on_mouse(self,event):pass
 def on_key(self,event):pass
import types as _t;cairn=_t.ModuleType("cairn");cairn.JSPlugin=JSPlugin;cairn.PythonPlugin=PythonPlugin;cairn.ServerPlugin=ServerPlugin;cairn._PluginBase=_PluginBase;import sys as _sys;_sys.modules["cairn"]=cairn
\`);status.textContent="Running plugin...";pyodide.runPython(PLUGIN_SOURCE);status.style.display="none";if(pendingMsg){handleRender(pendingMsg);pendingMsg=null;}}catch(err){status.innerHTML='<pre style="color:#f85149">Pyodide error: '+err.message+'</pre>';}}
function handleRender(msg){if(!pyodide){pendingMsg=msg;return;}try{document.getElementById("output").innerHTML="";const dataBytes=new Uint8Array(msg.data);var result,cls=null;try{cls=pyodide.runPython(\`
_found=None
for _name,_obj in list(globals().items()):
 if isinstance(_obj,type) and issubclass(_obj,PythonPlugin) and _obj is not PythonPlugin:_found=_obj;break
_found\`);}catch(e){}if(cls){try{var instance=cls.__call__();result=instance.render(pyodide.toPy(dataBytes),pyodide.toPy(msg.metadata),msg.step);}catch(e){cls=null;}}if(!cls){var renderFn=pyodide.globals.get("render");if(!renderFn){document.getElementById("output").innerHTML='<pre style="color:#f85149">No render()</pre>';return;}result=renderFn(pyodide.toPy(dataBytes),pyodide.toPy(msg.metadata),msg.step,msg.runId,msg.metricName);}const html=(typeof result==="string")?result:(result&&result.toString&&result.toString()!=="None")?result.toString():null;if(html){var outEl=document.getElementById("output");outEl.innerHTML="";var range=document.createRange();range.selectNode(outEl);outEl.appendChild(range.createContextualFragment(html));}setTimeout(function(){parent.postMessage({type:"cairn:resize",height:document.documentElement.scrollHeight},"*");},100);}catch(err){document.getElementById("output").innerHTML='<pre style="color:#f85149">Render error: '+err.message+'</pre>';}}
window.addEventListener("message",function(e){if(e.data&&e.data.type==="cairn:render")handleRender(e.data);});
initPyodide();
</script></body></html>`;
}

// ---------------------------------------------------------------------------
// PluginPane — renders ONE plugin for ONE metric entry (one run).
// Self-contained: has its own iframe/WebSocket/state.
// ---------------------------------------------------------------------------

function PluginPane({
  runId,
  m,
  targetStep,
}: {
  runId: string;
  m: { runId?: string; name: string; context_hash: string };
  targetStep: number;
}) {
  const rid = m.runId ?? runId;
  const q = useSequence(rid, m.name, {
    context: m.context_hash || undefined,
    maxPoints: 200,
  });
  const points = useMemo(
    () => (q.data?.points ?? []).filter((p: SequencePoint) => p.artifact_hash),
    [q.data],
  );
  const current = useMemo(() => {
    const exact = points.find((p: SequencePoint) => p.step === targetStep);
    if (exact) return exact;
    let best: SequencePoint | undefined;
    for (const p of points) {
      if (p.step <= targetStep) best = p; else break;
    }
    return best;
  }, [points, targetStep]);

  const pluginMeta = useMemo(
    () => safeJsonParse<PluginMeta>(current?.artifact_metadata ?? null) ?? {},
    [current],
  );

  const lang = pluginMeta.plugin_lang ?? "js";
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [iframeReady, setIframeReady] = useState(false);
  const activeSrcdocHash = useRef("");
  const blobUrlRef = useRef("");
  const wsRef = useRef<WebSocket | null>(null);
  const [serverFrameUrl, setServerFrameUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Cleanup blob URLs.
  useEffect(() => () => { if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current); }, []);

  // Setup iframe (JS/Python).
  useEffect(() => {
    if (lang === "server" || lang === "window") return;
    if (!pluginMeta.plugin_hash) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    const hashKey = `${pluginMeta.plugin_hash}:${lang}`;
    if (activeSrcdocHash.current === hashKey) return;
    activeSrcdocHash.current = hashKey;
    setIframeReady(false);
    setError(null);

    fetchPluginSource(pluginMeta.plugin_hash).then((source) => {
      if (lang === "js") {
        iframe.removeAttribute("src");
        iframe.srcdoc = buildJsIframeSrcdoc(source);
      } else {
        iframe.removeAttribute("srcdoc");
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        const blob = new Blob([buildPyIframeSrcdoc(source)], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        iframe.src = url;
      }
      iframe.onload = () => setIframeReady(true);
    }).catch((err) => setError(String(err)));
  }, [pluginMeta.plugin_hash, lang]);

  // Post data to iframe on step change.
  useEffect(() => {
    if (!iframeReady || !current?.artifact_hash) return;
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    let cancelled = false;
    fetchArtifactData(current.artifact_hash).then((data) => {
      if (cancelled) return;
      const clone = data.slice(0);
      iframe.contentWindow?.postMessage(
        { type: "cairn:render", data: clone, metadata: pluginMeta, step: targetStep, runId: rid, metricName: m.name },
        "*", [clone],
      );
    }).catch((err) => { if (!cancelled) setError(String(err)); });
    return () => { cancelled = true; };
  }, [iframeReady, current, pluginMeta, targetStep, rid, m.name]);

  // Server/Window plugin: WebSocket.
  useEffect(() => {
    if ((lang !== "server" && lang !== "window") || !current?.artifact_hash || !pluginMeta.plugin_hash) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/plugin/${rid}/${encodeURIComponent(m.name)}`);
    ws.binaryType = "blob";
    wsRef.current = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "render", artifact_hash: current.artifact_hash, metadata: pluginMeta, step: targetStep }));
    };
    let pendingMime = "";
    ws.onmessage = (e) => {
      if (typeof e.data === "string") {
        const msg = JSON.parse(e.data);
        if (msg.type === "frame") pendingMime = msg.mime || "image/jpeg";
        else if (msg.type === "error") setError(msg.message);
      } else if (e.data instanceof Blob) {
        const blob = new Blob([e.data], { type: pendingMime });
        const url = URL.createObjectURL(blob);
        setServerFrameUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url; });
      }
    };
    ws.onerror = () => setError("WebSocket connection failed");
    return () => { ws.close(); wsRef.current = null; };
  }, [lang, current, pluginMeta, targetStep, rid, m.name]);

  if (error) {
    return <div className="flex-1 rounded bg-bg p-2 text-xs text-status-failed overflow-auto"><pre>{error}</pre></div>;
  }
  if (!pluginMeta.plugin_hash) {
    return <div className="flex-1 flex items-center justify-center text-xs text-fg-muted p-4">No plugin metadata</div>;
  }
  if (lang === "server" || lang === "window") {
    return serverFrameUrl ? (
      <img src={serverFrameUrl} className="flex-1 w-full rounded object-contain" style={{ minHeight: 100 }} alt="" draggable={false} />
    ) : (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="h-6 w-6 motion-safe:animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }
  return (
    <iframe
      ref={iframeRef}
      {...(lang === "js" ? { sandbox: "allow-scripts" } : {})}
      className="flex-1 w-full rounded border-0"
      style={{ minHeight: 100 }}
      title={`Plugin: ${pluginMeta.plugin_name ?? m.name}`}
    />
  );
}

// ---------------------------------------------------------------------------
// Main PluginCard component
// ---------------------------------------------------------------------------

export default function PluginCard({
  runId,
  metric,
  extraSeries,
  settingsKeyOverride,
  onRemove,
}: Props) {
  useRunMetadataVersion();

  const effectiveMetrics = useMemo(() => {
    const all: Array<{ runId?: string; name: string; context_hash: string }> = [
      { name: metric.name, context_hash: metric.context_hash },
      ...(extraSeries ?? []).map((s) => ({ runId: s.runId, name: s.name, context_hash: s.context_hash })),
    ];
    const seen = new Set<string>();
    return all.filter((m) => {
      const k = `${m.runId ?? ""}::${m.name}::${m.context_hash}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [metric.name, metric.context_hash, extraSeries]);

  const isMulti = effectiveMetrics.length > 1;

  const allRunIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of effectiveMetrics) ids.add(m.runId ?? runId);
    return [...ids];
  }, [effectiveMetrics, runId]);

  const [settings, updateSettings] = useCardSettings(
    settingsKeyOverride ?? { runId, metricName: metric.name, contextHash: metric.context_hash },
    DEFAULT_SETTINGS,
  );

  // Primary run data for step computation.
  const q = useSequence(runId, metric.name, {
    context: metric.context_hash || undefined,
    maxPoints: 200,
  });
  const points = useMemo(
    () => (q.data?.points ?? []).filter((p) => p.artifact_hash),
    [q.data],
  );

  // Multi-run: fetch all to compute global steps.
  const multiQueries = useQueries({
    queries: effectiveMetrics.length > 1
      ? effectiveMetrics.map((m) => ({
          queryKey: ["sequence", m.runId ?? runId, m.name, m.context_hash],
          queryFn: () => api.sequence(m.runId ?? runId, m.name, { context: m.context_hash || undefined, maxPoints: 200 }),
          refetchInterval: 2_000,
          staleTime: 2_000,
        }))
      : [],
  });

  const globalSteps = useMemo(() => {
    const stepSet = new Set<number>();
    for (const p of points) if (p.artifact_hash) stepSet.add(p.step);
    if (effectiveMetrics.length > 1) {
      for (const mq of multiQueries) {
        const pts = (mq.data as SequenceResponse | undefined)?.points ?? [];
        for (const p of pts) if ((p as SequencePoint).artifact_hash) stepSet.add((p as SequencePoint).step);
      }
    }
    return Array.from(stepSet).sort((a, b) => a - b);
  }, [effectiveMetrics.length, points, multiQueries]);

  const [idx, setIdx] = useState(settings.sliderStep ?? 0);
  const safeIdx = Math.min(Math.max(0, idx), Math.max(0, globalSteps.length - 1));
  const currentStep = globalSteps[safeIdx] ?? 0;

  // Read pluginMeta from primary for subtitle/badge.
  const primaryCurrent = useMemo(
    () => points.find((p) => p.step === currentStep) ?? points[0],
    [points, currentStep],
  );
  const pluginMeta = useMemo(
    () => safeJsonParse<PluginMeta>(primaryCurrent?.artifact_metadata ?? null) ?? {},
    [primaryCurrent],
  );
  const lang = pluginMeta.plugin_lang ?? "js";

  const subtitle = globalSteps.length > 0
    ? `step ${currentStep} (${safeIdx + 1}/${globalSteps.length})`
    : pluginMeta.plugin_name ?? "plugin";

  const cardRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={cardRef}
      className="card p-4 flex flex-col"
      style={{
        position: "relative",
        height: resolveCardHeight(settings, 400),
        gridColumn: (settings.colSpan ?? 1) > 1 ? `span ${settings.colSpan}` : undefined,
      }}
    >
      <CardHeader
        title={settings.title ?? metric.name}
        onTitleChange={(t) => updateSettings({ title: t || undefined })}
        subtitle={subtitle}
        collapsed={settings.collapsed}
        onToggleCollapse={() => updateSettings({ collapsed: !settings.collapsed })}
        onToggleFullWidth={() => updateSettings(toggleColSpanPatch(settings, cardRef.current) as Partial<PluginSettings>)}
        isFullWidth={(settings.colSpan ?? 1) > 1}
        onRemove={onRemove}
      >
        <span className="inline-flex items-center rounded bg-bg-hover px-1.5 py-0.5 text-[10px] text-fg-muted">
          {lang === "window" ? "Window" : lang === "server" ? "Server" : lang === "py" ? "Python" : "JS"}
        </span>
      </CardHeader>

      {!settings.collapsed && (
        <>
          {isMulti ? (
            <div className="grid gap-2 flex-1 min-h-0 overflow-auto" style={{ gridTemplateColumns: `repeat(${Math.min(effectiveMetrics.length, 2)}, 1fr)` }}>
              {effectiveMetrics.map((m) => {
                const rid = m.runId ?? runId;
                return (
                  <div key={`${rid}::${m.name}::${m.context_hash}`} className="flex flex-col min-h-0">
                    <span className="text-[10px] text-fg-muted mb-1 truncate">
                      {shortRunLabel(rid, allRunIds)}
                    </span>
                    <PluginPane runId={runId} m={m} targetStep={currentStep} />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex-1 min-h-0">
              <PluginPane runId={runId} m={effectiveMetrics[0]!} targetStep={currentStep} />
            </div>
          )}

          {globalSteps.length > 1 && (
            <input
              type="range"
              min={0}
              max={globalSteps.length - 1}
              value={safeIdx}
              onChange={(e) => {
                const v = Number(e.target.value);
                setIdx(v);
                updateSettings({ sliderStep: v });
              }}
              className="mt-3 w-full accent-accent"
            />
          )}
        </>
      )}

      <CardResizeHandle
        height={settings.height}
        onHeightChange={(h) => updateSettings({ height: h })}
        colSpan={settings.colSpan ?? 1}
        onColSpanChange={(s) => updateSettings({ colSpan: s })}
        onPerColHeightChange={(p) => updateSettings(p as Partial<PluginSettings>)}
      />
    </div>
  );
}
