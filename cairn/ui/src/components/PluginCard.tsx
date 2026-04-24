/**
 * Plugin card — renders custom JS or Python viewer plugins in a sandboxed iframe.
 *
 * JS plugins run directly in a sandboxed iframe with access to WebGL/WebGPU.
 * Python plugins run in a Pyodide Web Worker and return HTML/SVG.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSequence } from "../api/hooks";
import { api } from "../api/client";
import { safeJsonParse } from "../lib/format";
import { useCardSettings, type CardSettingsKey } from "../lib/card-settings";
import { renderPython } from "../lib/pyodide-worker";
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

function buildIframeSrcdoc(pluginSource: string): string {
  return `<!DOCTYPE html>
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
${pluginSource}
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
  const [pyHtml, setPyHtml] = useState<string | null>(null);

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

  // Render on step change.
  const renderPlugin = useCallback(async () => {
    if (!current?.artifact_hash || !pluginMeta.plugin_hash) return;
    setError(null);

    try {
      const [source, data] = await Promise.all([
        fetchPluginSource(pluginMeta.plugin_hash),
        fetchArtifactData(current.artifact_hash),
      ]);

      const lang = pluginMeta.plugin_lang ?? "js";

      if (lang === "js") {
        // JS: update iframe srcdoc then post data.
        const iframe = iframeRef.current;
        if (!iframe) return;
        const srcdoc = buildIframeSrcdoc(source);
        if (iframe.srcdoc !== srcdoc) {
          iframe.srcdoc = srcdoc;
          // Wait for iframe to load before posting.
          await new Promise<void>((resolve) => {
            iframe.onload = () => resolve();
          });
        }
        // Clone data so we can reuse on next step.
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
        setPyHtml(null);
      } else {
        // Python: render via Pyodide worker.
        const html = await renderPython({
          source,
          data,
          metadata: pluginMeta,
          step: currentStep,
          runId,
          metricName: metric.name,
        });
        setPyHtml(html);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [current, pluginMeta, currentStep, runId, metric.name]);

  useEffect(() => {
    renderPlugin();
  }, [renderPlugin]);

  const subtitle = globalSteps.length > 0
    ? `step ${currentStep} (${safeIdx + 1}/${globalSteps.length})`
    : pluginMeta.plugin_name ?? "plugin";

  const lang = pluginMeta.plugin_lang ?? "js";

  return (
    <div
      className="card p-4 flex flex-col"
      style={{
        position: "relative",
        height: settings.collapsed ? undefined : (settings.height ?? undefined),
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
          ) : lang === "js" ? (
            <iframe
              ref={iframeRef}
              sandbox="allow-scripts"
              className="flex-1 w-full rounded border-0"
              style={{ height: settings.height ? undefined : iframeHeight, minHeight: 100 }}
              title={`Plugin: ${pluginMeta.plugin_name ?? metric.name}`}
            />
          ) : pyHtml ? (
            <iframe
              sandbox="allow-scripts"
              srcDoc={`<!DOCTYPE html><html><head><style>body{margin:0;background:transparent;color:#c9d1d9;font-family:system-ui}</style></head><body>${pyHtml}</body></html>`}
              className="flex-1 w-full rounded border-0"
              style={{ height: settings.height ? undefined : iframeHeight, minHeight: 100 }}
              title={`Plugin: ${pluginMeta.plugin_name ?? metric.name}`}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="h-8 w-8 motion-safe:animate-spin rounded-full border-2 border-accent border-t-transparent" />
              <span className="ml-2 text-xs text-fg-muted">Loading Pyodide...</span>
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
      />
    </div>
  );
}
