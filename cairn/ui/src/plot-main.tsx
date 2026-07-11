/**
 * The standalone `cairn-plot` entry — mounts ONE pure `lib/cairn-plot`
 * renderer from a plot descriptor (design spec §4). This is the THIRD vite
 * entry (alongside `main.tsx`/`index.html` and `embed-main.tsx`/`embed.html`),
 * wired into `vite.config.ts` so `vite build` emits `plot.html` beside the
 * others with a shared `/assets` chunk graph.
 *
 * Unlike the embed entry it mounts NO card, NO app chrome, and needs NEITHER
 * a `QueryClientProvider` NOR a `MemoryRouter` — the pure renderers are
 * prop-pure (verified by build + typecheck; add providers only if a renderer
 * ever transitively needs them). Just: read a descriptor, resolve its data
 * through a pluggable `DataSource`, render `RENDERER_MAP[descriptor.renderer]`.
 *
 * Two data modes, ONE code path (LOCAL vs ENDPOINT differ only in the
 * `DataSource`):
 *  - LOCAL (default, self-contained): descriptor inlined on the page as a
 *    `<script type="application/cairn-plot+json">` blob; binary blobs read
 *    from the page-level `window.__cairnPlotStore` (§5) as `data:` URLs.
 *  - ENDPOINT: descriptor URL in `?src=`; binary artifacts fetched from
 *    `${endpoint}/api/artifacts/${hash}`.
 *
 * Emits the same `cairn:resize` auto-height signal as the embed entry so a
 * notebook host can size the output (`useEmitAutoHeight`).
 */
import React, { Suspense, useEffect, useRef, useState } from "react";
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
} from "./plot-descriptor";
import { RENDERER_MAP } from "./plot-renderers";
import "./index.css";

const DESCRIPTOR_SCRIPT_ID = "__cairn_plot_descriptor__";
const DESCRIPTOR_MIME = "application/cairn-plot+json";

/**
 * Read the plot descriptor. LOCAL default: an inlined
 * `<script type="application/cairn-plot+json">` blob (by id or MIME type).
 * ENDPOINT: a `?src=<url>` param the bootstrap fetches. `?sid=` (a
 * server-stored spec id) is reserved for Phase C.
 */
async function readDescriptor(): Promise<PlotDescriptor> {
  const inline =
    document.getElementById(DESCRIPTOR_SCRIPT_ID) ??
    document.querySelector(`script[type="${DESCRIPTOR_MIME}"]`);
  if (inline?.textContent) {
    return JSON.parse(inline.textContent) as PlotDescriptor;
  }
  const params = new URLSearchParams(window.location.search);
  const src = params.get("src");
  if (src) {
    const res = await fetch(src);
    if (!res.ok) {
      throw new Error(`failed to fetch descriptor from ${src} (${res.status})`);
    }
    return (await res.json()) as PlotDescriptor;
  }
  if (params.get("sid")) {
    throw new Error("?sid= descriptor loading is not available yet (Phase C).");
  }
  throw new Error(
    "No plot descriptor found (expected an inline " +
      `<script type="${DESCRIPTOR_MIME}"> blob or a ?src= param).`,
  );
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

function PlotApp() {
  const containerRef = useRef<HTMLDivElement>(null);
  useEmitAutoHeight(containerRef);

  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; renderer: string; props: Record<string, unknown> }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const descriptor = await readDescriptor();
        const Renderer = RENDERER_MAP[descriptor.renderer];
        if (!Renderer) {
          throw new Error(`unknown renderer "${descriptor.renderer}"`);
        }
        const source = dataSourceFor(descriptor);
        const dataProps = await resolveDataProps(descriptor.data, source);
        if (cancelled) return;
        setState({
          status: "ready",
          renderer: descriptor.renderer,
          props: { ...(descriptor.props ?? {}), ...dataProps },
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
  }, []);

  let body: React.ReactNode;
  if (state.status === "loading") {
    body = <Message text="Loading…" />;
  } else if (state.status === "error") {
    body = <Message text={`Plot error: ${state.message}`} error />;
  } else {
    const Renderer = RENDERER_MAP[state.renderer]!;
    body = (
      <Suspense fallback={<Message text="Loading renderer…" />}>
        <Renderer {...state.props} />
      </Suspense>
    );
  }

  return (
    <div ref={containerRef} className="p-2">
      {body}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("cairn-plot-root")!).render(
  <React.StrictMode>
    <PlotApp />
  </React.StrictMode>,
);
