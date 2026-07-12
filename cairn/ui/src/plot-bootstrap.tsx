/**
 * The shared cairn-plot bootstrap (Phase B `PlotApp` + Phase C multi-mount).
 *
 * Phase B's `plot-main.tsx` auto-mounted ONE page-level `#cairn-plot-root` from
 * a single inline descriptor — right for the server `/plot` route, but a
 * notebook page (Phase C) carries MANY plots, each in its own `<div>`, each
 * with its own descriptor. So the mount logic is factored here and exposed as
 * `window.__cairnPlotBootstrap(divId, descId)` (mount ONE div from the
 * descriptor in the `<script id=descId application/cairn-plot+json>` blob),
 * plus a tiny queue-drain so a Python-emitted page can enqueue mounts before
 * the bundle finishes loading (GA-style `push` shim).
 *
 * Two build shapes consume this ONE module (identical behaviour):
 *  - `plot-main.tsx` → the code-split `plot.html` entry (server `/plot`, the
 *    ENDPOINT/`link` companion — chunks loaded from the server origin);
 *  - the `vite.plot-inline.config.ts` lib build → a single self-contained IIFE
 *    (`dist/plot-inline/plot-inline.iife.js`) Python inlines for the offline
 *    LOCAL default (no server, no external network).
 */
import React, {
  Suspense,
  useEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";
import ReactDOM from "react-dom/client";
import {
  createEndpointDataSource,
  createLocalDataSource,
  loadPlotStoreFromDom,
  type DataSource,
} from "./lib/cairn-plot";
import { useEmitAutoHeight } from "./lib/emit-auto-height";
import {
  resolveDataProps,
  type PlotDescriptor,
  type PlotNode,
} from "./plot-descriptor";
import { getRenderer, onRegister, registerRenderer } from "./plot-registry";

const DESCRIPTOR_SCRIPT_ID = "__cairn_plot_descriptor__";
const DESCRIPTOR_MIME = "application/cairn-plot+json";

/**
 * How long a mounted `PlotApp` waits for a not-yet-registered renderer (an
 * addon `<script>` still parsing) before giving up with a visible "unknown
 * renderer" error. The addon IIFE is emitted synchronously BEFORE the mount
 * push, so in practice registration always wins the race; this bound only
 * guards a genuinely unknown renderer (a bad descriptor / a missing addon).
 */
const RENDERER_WAIT_MS = 8000;

type QueueEntry = [divId: string, descId: string];

declare global {
  interface Window {
    __cairnPlotBundleLoaded?: boolean;
    __cairnPlotBootstrap?: (divId: string, descId: string) => void;
    __cairnPlotQueue?: QueueEntry[] | { push: (e: QueueEntry) => void };
    /**
     * Addon → core seam (O2). The core bundle exposes this so a self-contained
     * addon IIFE (which cannot `import` from core) can add its renderer by name
     * at runtime. GENERIC: figure today, three.js 3D in Phase D — same hook.
     */
    __cairnPlotRegisterRenderer?: (name: string, component: ComponentType<any>) => void;
    /** Include-once guard the `figure` addon sets after it registers. */
    __cairnPlotFigureLoaded?: boolean;
  }
}

/**
 * Read the plot descriptor for the page-level root (server `/plot` route).
 * LOCAL default: an inlined `<script application/cairn-plot+json>` blob; a
 * `?src=<url>` param the bootstrap fetches (ENDPOINT). Per-div notebook mounts
 * do NOT use this — they get their descriptor by id via `__cairnPlotBootstrap`.
 */
async function readPageDescriptor(): Promise<PlotDescriptor> {
  const inline =
    document.getElementById(DESCRIPTOR_SCRIPT_ID) ??
    document.querySelector(`script[type="${DESCRIPTOR_MIME}"]`);
  if (inline?.textContent) {
    return normalizeDescriptor(JSON.parse(inline.textContent));
  }
  const params = new URLSearchParams(window.location.search);
  const src = params.get("src");
  if (src) {
    const res = await fetch(src);
    if (!res.ok) {
      throw new Error(`failed to fetch descriptor from ${src} (${res.status})`);
    }
    return normalizeDescriptor(await res.json());
  }
  if (params.get("sid")) {
    throw new Error("?sid= descriptor loading is not available yet (Phase C).");
  }
  throw new Error(
    "No plot descriptor found (expected an inline " +
      `<script type="${DESCRIPTOR_MIME}"> blob or a ?src= param).`,
  );
}

/**
 * Legacy-flat shim (plan B): a pre-G1 descriptor is `{renderer,props?,data,…}`
 * with no `root`. Lift it to the G1 tree shape `{root:{kind:"plot",…},…}` so old
 * committed fixtures / emitters keep mounting. New descriptors already carry
 * `root` and pass through unchanged.
 */
export function normalizeDescriptor(raw: any): PlotDescriptor {
  if (raw && !raw.root && typeof raw.renderer === "string") {
    return {
      root: {
        kind: "plot",
        renderer: raw.renderer,
        props: raw.props,
        data: raw.data,
      },
      mode: raw.mode,
      endpoint: raw.endpoint,
    };
  }
  return raw as PlotDescriptor;
}

/** Build the `DataSource` the descriptor's `mode` selects. */
function dataSourceFor(descriptor: PlotDescriptor): DataSource {
  if (descriptor.mode === "endpoint") {
    const base = (descriptor.endpoint ?? window.location.origin).replace(/\/$/, "");
    return createEndpointDataSource((hash) => `${base}/api/artifacts/${hash}`);
  }
  // LOCAL: read the page's content-addressed store (§5) once.
  return createLocalDataSource(loadPlotStoreFromDom());
}

function Message({ text, error }: { text: string; error?: boolean }) {
  return (
    <div className={`card p-4 text-sm ${error ? "text-red-400" : "text-fg-muted"}`}>
      {text}
    </div>
  );
}

/**
 * Mount ONE renderer. `descriptor` may be supplied directly (per-div notebook
 * mount) or read from the page (server `/plot` root). NEVER throws to the host
 * — a resolve/render failure degrades to a visible in-div message.
 */
export function PlotApp({ descriptor: given }: { descriptor?: PlotDescriptor }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEmitAutoHeight(containerRef);

  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; renderer: string; props: Record<string, unknown> }
  >({ status: "loading" });
  // Bumped when the registry gains a renderer, so a `ready` state whose
  // renderer was not yet registered re-evaluates `getRenderer` and mounts.
  const [, bumpRegistry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const descriptor = normalizeDescriptor(
          given ?? (await readPageDescriptor()),
        );
        // Stage A bridge: this thin PlotApp renders the root leaf only; the
        // recursive grid/compare compositor arrives in Stage B (plot-node.tsx).
        const root: PlotNode = descriptor.root;
        if (root.kind !== "plot") {
          throw new Error(`unsupported root node kind "${root.kind}"`);
        }
        // NOTE (O2): do NOT reject an unregistered renderer here. With the
        // bundle split a `figure` addon may still be parsing; the render path
        // below waits for registration (bounded) instead of throwing.
        const source = dataSourceFor(descriptor);
        const dataProps = await resolveDataProps(root.data, source);
        if (cancelled) return;
        setState({
          status: "ready",
          renderer: root.renderer,
          props: { ...(root.props ?? {}), ...dataProps },
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [given]);

  // Wait-for-registration: when the data is ready but the descriptor's renderer
  // is not yet in the registry (its addon `<script>` hasn't executed), subscribe
  // and re-render the instant it arrives; after a bounded wait, surface the
  // existing visible "unknown renderer" error for a genuinely missing renderer.
  const rendererMissing = state.status === "ready" && !getRenderer(state.renderer);
  useEffect(() => {
    if (state.status !== "ready" || getRenderer(state.renderer)) return;
    const name = state.renderer;
    let settled = false;
    const unsub = onRegister(() => {
      if (!settled && getRenderer(name)) {
        settled = true;
        bumpRegistry((n) => n + 1);
      }
    });
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        setState({ status: "error", message: `unknown renderer "${name}"` });
      }
    }, RENDERER_WAIT_MS);
    return () => {
      settled = true;
      unsub();
      clearTimeout(timer);
    };
  }, [state, rendererMissing]);

  let body: React.ReactNode;
  if (state.status === "loading") {
    body = <Message text="Loading…" />;
  } else if (state.status === "error") {
    body = <Message text={`Plot error: ${state.message}`} error />;
  } else {
    const Renderer = getRenderer(state.renderer);
    body = Renderer ? (
      <Suspense fallback={<Message text="Loading renderer…" />}>
        <Renderer {...state.props} />
      </Suspense>
    ) : (
      <Message text="Loading renderer…" />
    );
  }

  return (
    <div ref={containerRef} className="p-2">
      {body}
    </div>
  );
}

/** Mount one notebook plot: div `#divId` from descriptor JSON in `#descId`. */
function mountOne(divId: string, descId: string): void {
  const el = document.getElementById(divId);
  if (!el) return;
  const descEl = document.getElementById(descId);
  let descriptor: PlotDescriptor | null = null;
  try {
    descriptor = descEl?.textContent
      ? (JSON.parse(descEl.textContent) as PlotDescriptor)
      : null;
  } catch {
    descriptor = null;
  }
  if (!descriptor) {
    el.textContent = "cairn-plot: missing/invalid descriptor";
    return;
  }
  ReactDOM.createRoot(el).render(
    <React.StrictMode>
      <PlotApp descriptor={descriptor} />
    </React.StrictMode>,
  );
}

/**
 * Install `window.__cairnPlotBootstrap` + drain the mount queue, and — for the
 * server `/plot` route — auto-mount the page-level `#cairn-plot-root` if it
 * exists. Idempotent: re-running the bundle (the Python emit's runtime
 * `window.__cairnPlotBundleLoaded` guard already prevents this, but be safe)
 * is a no-op.
 */
export function installCairnPlotBootstrap(): void {
  if (window.__cairnPlotBootstrap) return;
  window.__cairnPlotBootstrap = mountOne;
  // Expose the addon → core seam BEFORE marking the bundle loaded, so an addon
  // IIFE (emitted after core) can always find it (O2 / generic for Phase D).
  window.__cairnPlotRegisterRenderer = registerRenderer;
  window.__cairnPlotBundleLoaded = true;

  // Drain anything queued before the bundle loaded, then swap the queue for a
  // shim that mounts immediately on every future push.
  const q = window.__cairnPlotQueue;
  if (Array.isArray(q)) {
    for (const [divId, descId] of q) mountOne(divId, descId);
  }
  window.__cairnPlotQueue = {
    push: ([divId, descId]: QueueEntry) => mountOne(divId, descId),
  };

  // Server `/plot` route (single page-level descriptor). Absent on notebook
  // pages (they use per-div `__cairnPlotBootstrap`), so guard on existence.
  const root = document.getElementById("cairn-plot-root");
  if (root) {
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <PlotApp />
      </React.StrictMode>,
    );
  }
}
