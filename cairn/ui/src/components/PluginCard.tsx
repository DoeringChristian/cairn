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
import { getStreamMode } from "../lib/stream-mode";
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
  const buf = await resp.arrayBuffer();
  // Strip the "cairn-plugin:...\n" header prepended by PluginHandler.
  const bytes = new Uint8Array(buf);
  const PREFIX = new TextEncoder().encode("cairn-plugin:");
  if (bytes.length >= PREFIX.length) {
    let match = true;
    for (let i = 0; i < PREFIX.length; i++) {
      if (bytes[i] !== PREFIX[i]) { match = false; break; }
    }
    if (match) {
      const nl = bytes.indexOf(10); // newline
      if (nl > 0) return buf.slice(nl + 1);
    }
  }
  return buf;
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

  // --- Server/Window plugin state ---
  const wsRef = useRef<WebSocket | null>(null);
  const [serverFrameUrl, setServerFrameUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const webrtcStreamRef = useRef<MediaStream | null>(null);
  const [useWebRTC, setUseWebRTC] = useState(false);
  const lastMouseSent = useRef(0);

  // Assign WebRTC stream to <video> element via ref callback.
  const videoRefCallback = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && webrtcStreamRef.current) {
      console.log("[PluginCard] Assigning WebRTC stream to <video>");
      el.srcObject = webrtcStreamRef.current;
    }
  }, []);

  // Server plugin: WebSocket connection + render.
  useEffect(() => {
    if ((lang !== "server" && lang !== "window") || !current?.artifact_hash || !pluginMeta.plugin_hash) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/plugin/${runId}/${encodeURIComponent(metric.name)}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "blob";
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "render",
        artifact_hash: current.artifact_hash,
        metadata: pluginMeta,
        step: currentStep,
      }));

      // For window plugins, attempt WebRTC upgrade for smooth video streaming.
      const streamMode = getStreamMode();
      if (lang === "window" && streamMode !== "jpeg") {
        // No STUN — localhost/LAN only needs host candidates.
        const pc = new RTCPeerConnection({ iceServers: [] });
        pcRef.current = pc;
        pc.addTransceiver("video", { direction: "recvonly" });
        pc.ontrack = (ev) => {
          console.log("[PluginCard] WebRTC ontrack fired, track:", ev.track.kind, ev.track.readyState);
          webrtcStreamRef.current = ev.streams[0] ?? new MediaStream([ev.track]);
          setUseWebRTC(true);
        };
        // Wait for ICE gathering to complete before sending offer.
        pc.createOffer().then(async (offer) => {
          await pc.setLocalDescription(offer);
          // Wait for ICE candidates to be gathered.
          await new Promise<void>((resolve) => {
            if (pc.iceGatheringState === "complete") { resolve(); return; }
            pc.onicegatheringstatechange = () => {
              if (pc.iceGatheringState === "complete") resolve();
            };
            // Timeout after 2s — send what we have.
            setTimeout(resolve, 2000);
          });
          // Send the complete offer (with ICE candidates embedded in SDP).
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: "webrtc_offer",
              sdp: pc.localDescription?.sdp,
            }));
          }
        }).catch((err) => {
          console.warn("[PluginCard] WebRTC offer failed:", err);
        });
      }
    };

    let pendingMime = "";
    ws.onmessage = (e) => {
      if (typeof e.data === "string") {
        const msg = JSON.parse(e.data);
        if (msg.type === "frame") {
          pendingMime = msg.mime || "image/jpeg";
        } else if (msg.type === "error") {
          setError(msg.message);
        } else if (msg.type === "webrtc_answer" && pcRef.current) {
          pcRef.current.setRemoteDescription(
            new RTCSessionDescription({ type: "answer", sdp: msg.sdp })
          );
        } else if (msg.type === "webrtc_failed") {
          console.warn("[PluginCard] WebRTC failed:", msg.message, "— using JPEG fallback");
        }
      } else if (e.data instanceof Blob) {
        // Binary frame data (JPEG fallback — only used if WebRTC not active).
        if (!useWebRTC) {
          const blob = new Blob([e.data], { type: pendingMime });
          const url = URL.createObjectURL(blob);
          setServerFrameUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return url;
          });
        }
      }
    };

    ws.onerror = () => setError("WebSocket connection failed");

    return () => {
      ws.close();
      wsRef.current = null;
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      setUseWebRTC(false);
    };
  }, [lang, current, pluginMeta, currentStep, runId, metric.name]);

  // Forward mouse events to server plugin, mapping coordinates from
  // the displayed viewport to the plugin's native resolution.
  // Throttled to 60 events/sec for move events.
  const sendMouseEvent = useCallback((action: string, e: React.MouseEvent) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    // Throttle move events to max 60/sec.
    if (action === "move") {
      const now = performance.now();
      if (now - lastMouseSent.current < 16) return;
      lastMouseSent.current = now;
    }

    const img = e.currentTarget as HTMLImageElement | HTMLVideoElement;
    const natW = (img as HTMLImageElement).naturalWidth || (img as HTMLVideoElement).videoWidth || 0;
    const natH = (img as HTMLImageElement).naturalHeight || (img as HTMLVideoElement).videoHeight || 0;
    if (!natW || !natH) return;

    const rect = img.getBoundingClientRect();

    // Compute the actual rendered image area within the <img> element.
    // object-contain scales to fit while preserving aspect ratio.
    const elemAspect = rect.width / rect.height;
    const imgAspect = natW / natH;

    let renderW: number, renderH: number, offsetX: number, offsetY: number;
    if (imgAspect > elemAspect) {
      // Image is wider than element → pillarboxed (empty space top/bottom)
      renderW = rect.width;
      renderH = rect.width / imgAspect;
      offsetX = 0;
      offsetY = (rect.height - renderH) / 2;
    } else {
      // Image is taller than element → letterboxed (empty space left/right)
      renderH = rect.height;
      renderW = rect.height * imgAspect;
      offsetX = (rect.width - renderW) / 2;
      offsetY = 0;
    }

    // Mouse position relative to the rendered image area.
    const imgX = e.clientX - rect.left - offsetX;
    const imgY = e.clientY - rect.top - offsetY;

    // Ignore events outside the actual image area.
    if (imgX < 0 || imgY < 0 || imgX > renderW || imgY > renderH) return;

    // Map to native resolution.
    const x = Math.round((imgX / renderW) * natW);
    const y = Math.round((imgY / renderH) * natH);

    ws.send(JSON.stringify({ type: "mouse", x, y, button: e.button, action }));
  }, []);

  // Track blob URLs so we can revoke them on cleanup.
  const blobUrlRef = useRef<string>("");

  // Build or update the iframe when plugin source changes (JS/Python only).
  const setupIframe = useCallback(async () => {
    if (lang === "server" || lang === "window") return;  // server/window plugins use WebSocket, not iframe
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
          {lang === "window" ? "Window" : lang === "server" ? "Server" : lang === "py" ? "Python" : "JS"}
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
          ) : (lang === "server" || lang === "window") ? (
            useWebRTC ? (
              <video
                ref={videoRefCallback}
                autoPlay
                playsInline
                muted
                className="flex-1 w-full rounded object-contain cursor-grab active:cursor-grabbing"
                style={{ minHeight: 200, userSelect: "none", background: "#161b22" }}
                onMouseDown={(e) => { e.preventDefault(); sendMouseEvent("down", e); }}
                onMouseMove={(e) => sendMouseEvent("move", e)}
                onMouseUp={(e) => sendMouseEvent("up", e)}
                onMouseLeave={(e) => sendMouseEvent("up", e)}
              />
            ) : serverFrameUrl ? (
              <img
                src={serverFrameUrl}
                alt={`Server plugin: ${pluginMeta.plugin_name ?? metric.name}`}
                className="flex-1 w-full rounded object-contain cursor-grab active:cursor-grabbing"
                style={{ minHeight: 200, userSelect: "none" }}
                draggable={false}
                onMouseDown={(e) => { e.preventDefault(); sendMouseEvent("down", e); }}
                onMouseMove={(e) => sendMouseEvent("move", e)}
                onMouseUp={(e) => sendMouseEvent("up", e)}
                onMouseLeave={(e) => sendMouseEvent("up", e)}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="h-8 w-8 motion-safe:animate-spin rounded-full border-2 border-accent border-t-transparent" />
                <span className="ml-2 text-xs text-fg-muted">Connecting to server...</span>
              </div>
            )
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
