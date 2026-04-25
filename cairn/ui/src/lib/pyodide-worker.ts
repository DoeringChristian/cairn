/**
 * Pyodide Web Worker manager for Python plugin rendering.
 *
 * Lazily creates a single Web Worker that loads Pyodide from CDN.
 * The worker persists across renders so subsequent calls are fast.
 */

const PYODIDE_CDN = "https://cdn.jsdelivr.net/pyodide/v0.27.0/full/";

// Inline worker source — runs Pyodide in a dedicated thread.
const WORKER_SOURCE = `
importScripts("${PYODIDE_CDN}pyodide.js");

let pyodide = null;
const installedPackages = new Set();

async function ensurePyodide() {
  if (pyodide) return pyodide;
  pyodide = await loadPyodide({ indexURL: "${PYODIDE_CDN}" });
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
      // Force Agg backend for matplotlib (no DOM in Web Worker)
      // and auto-install mpld3 for interactive output.
      if (reqs.some(r => r === "matplotlib")) {
        py.runPython("import matplotlib; matplotlib.use('agg')");
        if (!installedPackages.has("mpld3")) {
          await micropip.install("mpld3");
          installedPackages.add("mpld3");
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
`;

let worker: Worker | null = null;
let workerReady = false;
let readyPromise: Promise<void> | null = null;

function getWorker(): Worker {
  if (worker) return worker;
  const blob = new Blob([WORKER_SOURCE], { type: "application/javascript" });
  worker = new Worker(URL.createObjectURL(blob));
  readyPromise = new Promise<void>((resolve, reject) => {
    const handler = (e: MessageEvent) => {
      if (e.data.type === "ready") {
        workerReady = true;
        worker!.removeEventListener("message", handler);
        resolve();
      } else if (e.data.type === "error") {
        worker!.removeEventListener("message", handler);
        reject(new Error(e.data.message));
      }
    };
    worker!.addEventListener("message", handler);
  });
  worker.postMessage({ type: "init" });
  return worker;
}

export interface RenderPythonOpts {
  source: string;
  data: ArrayBuffer;
  metadata: Record<string, unknown>;
  step: number;
  runId: string;
  metricName: string;
}

/**
 * Render a Python plugin. Returns HTML/SVG string.
 * Lazily initializes Pyodide on first call (~10MB download, cached by browser).
 */
export async function renderPython(opts: RenderPythonOpts): Promise<string> {
  const w = getWorker();
  if (!workerReady && readyPromise) await readyPromise;

  return new Promise<string>((resolve, reject) => {
    const handler = (e: MessageEvent) => {
      if (e.data.type === "result") {
        w.removeEventListener("message", handler);
        resolve(e.data.html);
      } else if (e.data.type === "error") {
        w.removeEventListener("message", handler);
        reject(new Error(e.data.message));
      }
    };
    w.addEventListener("message", handler);
    // Clone data before transfer so we can reuse it on step scrub.
    const clone = opts.data.slice(0);
    w.postMessage(
      {
        type: "render",
        source: opts.source,
        data: clone,
        metadata: opts.metadata,
        step: opts.step,
        runId: opts.runId,
        metricName: opts.metricName,
      },
      [clone],
    );
  });
}
