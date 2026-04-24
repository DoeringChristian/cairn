/**
 * Plugin card — renders custom JS or Python viewer plugins in sandboxed iframes.
 *
 * JS plugins run directly in a sandboxed iframe with access to WebGL/WebGPU.
 * Python plugins load Pyodide inside the iframe so matplotlib's wasm_backend
 * has DOM access for interactive figures (pan, zoom, resize).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSequence } from "../api/hooks";
import { api } from "../api/client";
import { safeJsonParse } from "../lib/format";
import { useCardSettings, type CardSettingsKey } from "../lib/card-settings";
import type { SequenceMeta } from "../api/types";
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
  plugin_lang?: "js" | "py";
  plugin_name?: string;
  [key: string]: unknown;
}

interface PluginSettings {
  version: 1;
  title?: string;
  collapsed?: boolean;
  sliderStep?: number;
  height?: number;
  colSpan?: number;
}

const DEFAULT_SETTINGS: PluginSettings = { version: 1 };

const PYODIDE_CDN = "https://cdn.jsdelivr.net/pyodide/v0.27.0/full/";

// Module-level cache for fetched plugin sources (keyed by artifact hash).
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
  return resp.arrayBuffer();
}

// ---------------------------------------------------------------------------
// JS iframe shell — plugin source runs directly, data via postMessage.
// ---------------------------------------------------------------------------
function buildJsIframeSrcdoc(pluginSource: string): string {
  return `<!DOCTYPE html>
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
${pluginSource}
</script>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Python iframe shell — loads Pyodide in-iframe for full DOM access
// (matplotlib wasm_backend works natively with interactive figures).
// ---------------------------------------------------------------------------
function buildPyIframeSrcdoc(pluginSource: string): string {
  // Escape backticks and backslashes in plugin source for embedding in template literal.
  const escaped = pluginSource.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
  return `<!DOCTYPE html>
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
<script src="https://cdn.plot.ly/plotly-2.35.2.min.js" charset="utf-8"></script>
<script src="${PYODIDE_CDN}pyodide.js"></script>
<script>
const PLUGIN_SOURCE = \`${escaped}\`;

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
    pyodide = await loadPyodide({ indexURL: "${PYODIDE_CDN}" });
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
</script>
</body></html>`;
}

export default function PluginCard({
  runId,
  metric,
  settingsKeyOverride,
  onRemove,
}: Props) {
  const [settings, updateSettings] = useCardSettings(
    settingsKeyOverride ?? {
      runId,
      metricName: metric.name,
      contextHash: metric.context_hash,
    },
    DEFAULT_SETTINGS,
  );

  const q = useSequence(runId, metric.name, {
    context: metric.context_hash || undefined,
    maxPoints: 200,
  });

  const points = useMemo(
    () => (q.data?.points ?? []).filter((p) => p.artifact_hash),
    [q.data],
  );

  const globalSteps = useMemo(() => {
    const s = new Set<number>();
    for (const p of points) s.add(p.step);
    return Array.from(s).sort((a, b) => a - b);
  }, [points]);

  const [idx, setIdx] = useState(settings.sliderStep ?? 0);
  const safeIdx = Math.min(Math.max(0, idx), Math.max(0, globalSteps.length - 1));
  const currentStep = globalSteps[safeIdx] ?? 0;
  const current = useMemo(
    () => points.find((p) => p.step === currentStep) ?? points[0],
    [points, currentStep],
  );

  const pluginMeta = useMemo(
    () => safeJsonParse<PluginMeta>(current?.artifact_metadata ?? null) ?? {},
    [current],
  );

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [iframeHeight, setIframeHeight] = useState(300);
  const [error, setError] = useState<string | null>(null);
  const [iframeReady, setIframeReady] = useState(false);
  // Track the current srcdoc to avoid rebuilding the iframe on every step.
  const activeSrcdocHash = useRef<string>("");

  // Cleanup blob URLs on unmount.
  useEffect(() => {
    return () => { if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current); };
  }, []);

  // Listen for resize messages from the iframe.
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "cairn:resize" && typeof e.data.height === "number") {
        setIframeHeight(Math.max(100, Math.min(2000, e.data.height)));
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const lang = pluginMeta.plugin_lang ?? "js";

  // Track blob URLs so we can revoke them on cleanup.
  const blobUrlRef = useRef<string>("");

  // Build or update the iframe when plugin source changes.
  const setupIframe = useCallback(async () => {
    if (!pluginMeta.plugin_hash) return;
    setError(null);

    try {
      const source = await fetchPluginSource(pluginMeta.plugin_hash);
      const iframe = iframeRef.current;
      if (!iframe) return;

      // Only rebuild when plugin hash changes (not on every step).
      const hashKey = `${pluginMeta.plugin_hash}:${lang}`;
      if (activeSrcdocHash.current !== hashKey) {
        activeSrcdocHash.current = hashKey;
        setIframeReady(false);

        if (lang === "js") {
          iframe.removeAttribute("src");
          iframe.srcdoc = buildJsIframeSrcdoc(source);
        } else {
          // Python: use a blob URL (not srcdoc) so the iframe can fetch
          // CDN scripts (Pyodide, Plotly) without allow-same-origin.
          iframe.removeAttribute("srcdoc");
          if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
          const html = buildPyIframeSrcdoc(source);
          const blob = new Blob([html], { type: "text/html" });
          const url = URL.createObjectURL(blob);
          blobUrlRef.current = url;
          iframe.src = url;
        }
        await new Promise<void>((resolve) => { iframe.onload = () => resolve(); });
        setIframeReady(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [pluginMeta.plugin_hash, lang]);

  useEffect(() => { setupIframe(); }, [setupIframe]);

  // Post data to iframe on step change (once iframe is ready).
  useEffect(() => {
    if (!iframeReady || !current?.artifact_hash) return;
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;

    let cancelled = false;
    fetchArtifactData(current.artifact_hash).then((data) => {
      if (cancelled) return;
      const clone = data.slice(0);
      iframe.contentWindow?.postMessage(
        {
          type: "cairn:render",
          data: clone,
          metadata: pluginMeta,
          step: currentStep,
          runId,
          metricName: metric.name,
        },
        "*",
        [clone],
      );
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    });
    return () => { cancelled = true; };
  }, [iframeReady, current, pluginMeta, currentStep, runId, metric.name]);

  const subtitle = globalSteps.length > 0
    ? `step ${currentStep} (${safeIdx + 1}/${globalSteps.length})`
    : pluginMeta.plugin_name ?? "plugin";

  return (
    <div
      className="card p-4 flex flex-col"
      style={{
        position: "relative",
        height: settings.collapsed ? undefined : (settings.height ?? 400),
        gridColumn: (settings.colSpan ?? 1) > 1 ? `span ${settings.colSpan}` : undefined,
      }}
    >
      <CardHeader
        title={settings.title ?? metric.name}
        onTitleChange={(t) => updateSettings({ title: t || undefined })}
        subtitle={subtitle}
        collapsed={settings.collapsed}
        onToggleCollapse={() => updateSettings({ collapsed: !settings.collapsed })}
        onToggleFullWidth={() => updateSettings({ colSpan: (settings.colSpan ?? 1) > 1 ? 1 : 2 })}
        isFullWidth={(settings.colSpan ?? 1) > 1}
        onRemove={onRemove}
      >
        <span className="inline-flex items-center rounded bg-bg-hover px-1.5 py-0.5 text-[10px] text-fg-muted">
          {lang === "py" ? "Python" : "JS"}
        </span>
      </CardHeader>

      {!settings.collapsed && (
        <>
          {error ? (
            <div className="flex-1 rounded bg-bg p-3 text-xs text-status-failed overflow-auto">
              <pre>{error}</pre>
            </div>
          ) : !pluginMeta.plugin_hash ? (
            <div className="flex-1 flex items-center justify-center text-sm text-fg-muted">
              No plugin metadata found
            </div>
          ) : (
            <iframe
              ref={iframeRef}
              {...(lang === "js" ? { sandbox: "allow-scripts" } : {})}
              className="flex-1 w-full rounded border-0"
              style={{ height: iframeHeight, minHeight: 200 }}
              title={`Plugin: ${pluginMeta.plugin_name ?? metric.name}`}
            />
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
      />
    </div>
  );
}
