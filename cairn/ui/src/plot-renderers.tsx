/**
 * `CORE_RENDERERS` — the standalone plot bundle's ALWAYS-present `renderer`
 * name → component table (design spec §4): the 2D charts + single-image +
 * table. It imports the SAME pure `lib/cairn-plot` renderers the viewer app
 * uses, so a Python-emitted plot is pixel-identical to the same renderer in
 * the app (consistency by construction).
 *
 * O2 bundle-split: Plotly `figure` is NO LONGER in this map — it ships as a
 * separate addon (`plot-figure-renderer.tsx` → `figure.iife.js`) registered at
 * runtime via `registerRenderer` so a scalar/table/image page never carries
 * Plotly. 3D (three.js) is likewise Phase-D addon territory and absent here.
 * `registerCoreRenderers()` seeds the runtime registry (`plot-registry.tsx`).
 *
 * Each entry is a thin STANDALONE ADAPTER around the pure renderer. The pure
 * renderers are prop-pure but several expect controlled interactive state
 * (e.g. `ScalarPlot`'s `viewport`/`onViewportChange`) or required config the
 * app's cards normally supply; standalone there is no card, so these adapters:
 *   1. own the interactive state locally (`useState`) with sensible seeds,
 *   2. fill required config props with defaults (overridable by the
 *      descriptor's `props`), and
 *   3. give chart renderers (which fill their container via `useContainerSize`)
 *      a default height box so they don't collapse to 0 on a bare page.
 *
 * DATA props arrive already-resolved from the descriptor (`resolveDataProps`)
 * merged over the descriptor's config `props`; adapters spread that as `p`.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import ScalarPlot from "./lib/cairn-plot/renderers/ScalarPlot";
import ScatterPlot from "./lib/cairn-plot/renderers/ScatterPlot";
import ParallelCoords from "./lib/cairn-plot/renderers/ParallelCoords";
import BarChart from "./lib/cairn-plot/renderers/BarChart";
import HistogramPlot from "./lib/cairn-plot/renderers/HistogramPlot";
import Heatmap from "./lib/cairn-plot/renderers/Heatmap";
import CpuImagePane from "./lib/cairn-plot/renderers/CpuImagePane";
import {
  resolveRenderMode,
  type ImageBackend,
  type RenderMode,
} from "./lib/cairn-plot/renderers/image-backend";
import Table from "./lib/cairn-plot/renderers/Table";
import type { Viewport, PromotedSeriesConfig } from "./lib/cairn-plot/types";
import type { Viewport as ImageViewport } from "./lib/cairn-plot/hooks/use-image-viewport";
import {
  getLastImageViewportState,
  makeImageViewportSyncSourceId,
  publishImageViewportState,
  subscribeImageViewportState,
} from "./lib/cairn-plot/viewport/image-viewport-sync";
import {
  ChartViewportSyncProvider,
  type ChartViewportSyncTarget,
} from "./lib/cairn-plot/viewport/use-chart-viewport";
import { makeChartViewportSyncSourceId } from "./lib/cairn-plot/viewport/chart-viewport-sync";
import { ChartBox } from "./plot-standalone-helpers";
import { registerRenderer } from "./plot-registry";

/** Loose prop bag — resolved data props + descriptor config, unified. */
type P = Record<string, any>;

// ---------------------------------------------------------------------------
// resolveImageRenderer — the render-mode BACKEND seam for the standalone
// image path (formalized from Task 8's WebGPU-or-legacy check; see
// `docs/superpowers/specs/2026-07-16-webgpu-engine-design.md`). Two
// interchangeable backends — `CpuImagePane` (CPU/2D-canvas) and
// `GpuImagePane` (WebGPU engine) — accept the SAME `ImageBackendProps`
// (`lib/cairn-plot/renderers/image-backend.ts`); THIS is where one is chosen
// per mount, by the user-settable `RenderMode` (cpu | gpu | auto — see
// `resolveRenderMode` for the prop → window global → `?render=` → "auto"
// precedence). The rest of the app is backend-agnostic.
//
// The RUNTIME safety net (a mounted `GpuImagePane` that fails mid-render
// self-heals to `CpuImagePane` — the C1 fix, `GpuImagePane.tsx`'s
// `engineFailed` state) is a SEPARATE, later line of defense — both land on
// the same CPU backend, so a page never blanks whether WebGPU is simply
// unavailable (this seam) or available-but-fails-at-runtime (C1).
//
// `core` (this file) must never statically import the engine or
// `GpuImagePane` — that would pull the WebGPU RHI into `core.iife.js`, which
// the bundle guard forbids. Instead, the lazy `gpu-image` addon
// (`plot-gpu-image-addon.tsx`, emitted only on pages with an image/HDR-image/
// compare node) sets `window.__cairnPlotGpuImagePane` once its capability
// check (`getSharedDevice()`) resolves, and dispatches
// `GPU_IMAGE_READY_EVENT` so an already-mounted adapter re-renders onto it —
// see that file's module doc for why a `registerRenderer("image", …)`
// registry overwrite (the Task 6 approach) doesn't work here: `GpuImagePane`
// needs a CALLER-OWNED `zoom`/`pan`/`onViewportChange` (it has no internal
// viewport state), which only `ImageStandalone`/`ImageHdrStandalone` (below)
// can supply, not a bare registry swap.
const GPU_IMAGE_READY_EVENT = "cairn-plot:gpu-image-ready"; // must match plot-gpu-image-addon.tsx's dispatch

declare global {
  interface Window {
    __cairnPlotGpuImagePane?: ComponentType<any>;
    __cairnPlotUseGpuImage?: boolean;
  }
}

// Warn once (not per render) when `"gpu"` is forced but the engine backend
// is genuinely unavailable and the CPU backend is substituted.
let warnedForcedGpuUnavailable = false;

/**
 * Resolves the image BACKEND component to render THIS mount, by `mode`:
 *   - `"cpu"`  → `CpuImagePane`, always.
 *   - `"gpu"`  → the engine's `GpuImagePane` if the gpu-image addon has
 *     registered it (`window.__cairnPlotGpuImagePane`, set once
 *     `getSharedDevice()` resolves — bypassing the `__cairnPlotUseGpuImage`
 *     opt-out, since an explicit force outranks the default gate); if the
 *     addon/WebGPU is genuinely unavailable, `console.warn` once and fall
 *     back to `CpuImagePane` — never a blank pane.
 *   - `"auto"` → today's behavior: `GpuImagePane` when the addon has loaded
 *     AND the capability flag is on (`__cairnPlotUseGpuImage === true`),
 *     else `CpuImagePane` — covering "addon hasn't run yet", "opted out",
 *     and "`getSharedDevice()` rejected" uniformly.
 *
 * Implemented as a React hook (despite the name — no `use` prefix, since
 * this is the seam's public name, not just an internal implementation
 * detail) because it must re-render the caller once, the instant the addon
 * finishes, via the `GPU_IMAGE_READY_EVENT` it dispatches — fixing the
 * async-registration race where the addon's `getSharedDevice()` check
 * resolves AFTER this component's first paint. Return type is the shared
 * `ImageBackend` interface (`image-backend.ts`) — both backends this
 * resolves between accept the same `ImageBackendProps` shape.
 */
function resolveImageRenderer(mode: RenderMode): ImageBackend {
  const [, bump] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined" || window.__cairnPlotGpuImagePane) return;
    const onReady = () => bump((n) => n + 1);
    window.addEventListener(GPU_IMAGE_READY_EVENT, onReady);
    return () => window.removeEventListener(GPU_IMAGE_READY_EVENT, onReady);
  }, []);
  if (typeof window === "undefined" || mode === "cpu") return CpuImagePane;
  const gpuPane = window.__cairnPlotGpuImagePane as ImageBackend | undefined;
  if (mode === "gpu") {
    if (gpuPane) return gpuPane;
    if (!warnedForcedGpuUnavailable) {
      warnedForcedGpuUnavailable = true;
      // eslint-disable-next-line no-console
      console.warn(
        'cairn-plot: render mode "gpu" was forced but the WebGPU image backend is unavailable ' +
          "(gpu-image addon not loaded yet, or WebGPU init failed) — falling back to the CPU backend",
      );
    }
    return CpuImagePane;
  }
  // "auto"
  return window.__cairnPlotUseGpuImage === true && gpuPane ? gpuPane : CpuImagePane;
}

// --- ScalarPlot: owns viewport + promotedSeries interactive state ----------
function ScalarPlotStandalone(p: P) {
  const [viewport, setViewport] = useState<Viewport>(
    p.viewport ?? { xMin: null, xMax: null, yMin: null, yMax: null },
  );
  const [promoted, setPromoted] = useState<Record<string, PromotedSeriesConfig>>(
    p.promotedSeries ?? {},
  );
  const { height, viewport: _v, promotedSeries: _p, ...rest } = p;
  return (
    <ChartBox height={height}>
      <ScalarPlot
        series={p.series ?? []}
        xAxis={p.xAxis ?? "step"}
        xScale={p.xScale ?? "linear"}
        yScale={p.yScale ?? "linear"}
        xRange={p.xRange ?? [null, null]}
        yRange={p.yRange ?? [null, null]}
        {...rest}
        viewport={viewport}
        onViewportChange={setViewport}
        promotedSeries={promoted}
        onPromotedSeriesChange={setPromoted}
      />
    </ChartBox>
  );
}

/**
 * Derives the stable {@link ChartViewportSyncTarget} for a chart leaf from the
 * grid's `viewportSyncGroupId` (threaded down by `plot-node.tsx` — the SAME
 * flag that syncs image panes). The CHART mirror of `useSyncedImageViewport`:
 * mints a per-instance `sourceId` once (the echo-guard token) and pairs it with
 * the group id. Returns `null` (not synced) when the leaf isn't in a synced
 * grid. Memoized so peers don't re-subscribe every render.
 */
function useChartSyncTarget(
  groupId: string | null | undefined,
): ChartViewportSyncTarget | null {
  const sourceIdRef = useRef<string>();
  if (!sourceIdRef.current) sourceIdRef.current = makeChartViewportSyncSourceId();
  return useMemo(
    () => (groupId ? { groupId, sourceId: sourceIdRef.current! } : null),
    [groupId],
  );
}

/**
 * Opts a chart standalone's pure renderer into the grid's viewport-sync group
 * via context, so the shared `useChartViewport` inside the renderer publishes/
 * subscribes without the renderer component needing any sync-specific prop —
 * exactly how `useSyncedImageViewport` gives image panes sync "for free". A
 * `null` group (unsynced grid or a bare page) is a transparent pass-through.
 */
function ChartSyncBoundary({
  groupId,
  children,
}: {
  groupId: string | null | undefined;
  children: ReactNode;
}) {
  const sync = useChartSyncTarget(groupId);
  return <ChartViewportSyncProvider value={sync}>{children}</ChartViewportSyncProvider>;
}

function ScatterPlotStandalone(p: P) {
  const { height, ...rest } = p;
  return (
    <ChartBox height={height}>
      <ChartSyncBoundary groupId={p.viewportSyncGroupId}>
        <ScatterPlot points={p.points ?? []} {...rest} />
      </ChartSyncBoundary>
    </ChartBox>
  );
}

function ParallelCoordsStandalone(p: P) {
  const { height, ...rest } = p;
  return (
    <ChartBox height={height}>
      <ParallelCoords
        columns={p.columns ?? []}
        rows={p.rows ?? []}
        columnDomains={p.columnDomains ?? []}
        {...rest}
      />
    </ChartBox>
  );
}

function BarChartStandalone(p: P) {
  const { height, ...rest } = p;
  return (
    <ChartBox height={height}>
      <ChartSyncBoundary groupId={p.viewportSyncGroupId}>
        <BarChart bars={p.bars ?? []} {...rest} />
      </ChartSyncBoundary>
    </ChartBox>
  );
}

function HistogramStandalone(p: P) {
  const { height, ...rest } = p;
  // Discriminated on `view` ("bars" | "heatmap"); default to bars.
  const props = (rest.view ? rest : { ...rest, view: "bars" }) as any;
  return (
    <ChartBox height={height}>
      <ChartSyncBoundary groupId={p.viewportSyncGroupId}>
        <HistogramPlot {...props} />
      </ChartSyncBoundary>
    </ChartBox>
  );
}

function HeatmapStandalone(p: P) {
  const { height, ...rest } = p;
  return (
    <ChartBox height={height}>
      <ChartSyncBoundary groupId={p.viewportSyncGroupId}>
        <Heatmap matrix={p.matrix ?? []} colormap={p.colormap ?? "viridis"} {...rest} />
      </ChartSyncBoundary>
    </ChartBox>
  );
}

/**
 * Owns a pane's local `{zoom,pan}` viewport state, optionally linked to a
 * `viewportSyncGroupId` (threaded down from a grid's `shared.sync.viewport` —
 * see `plot-node.tsx`'s `GridView`) via `image-viewport-sync.ts`'s group
 * pub/sub bus — the IMAGE mirror of the 3D `cameraSyncGroupId` mechanism
 * (`lib/camera-sync.ts` / `three/camera-sync.ts`). Shared by
 * `ImageStandalone`/`ImageHdrStandalone` so BOTH the WebGPU engine pane and
 * the legacy CPU panes (`ImagePane`/`HdrImagePane`/`GpuImagePane` are all
 * fully controlled via `zoom`/`pan`/`onViewportChange`, owning no viewport
 * state of their own) get sync for free — neither pane component needs to
 * know sync exists, only the adapter that already owns the viewport state.
 *
 * - Joining a group adopts the last-published state immediately, so a pane
 *   that mounts after its peers have already zoomed/panned doesn't snap them
 *   back to home.
 * - A LOCAL gesture (the pane's own `onViewportChange`, returned here) both
 *   updates local state and publishes to the group.
 * - A REMOTE update (another pane's publish, delivered via `subscribe`) only
 *   updates local state — it is never re-published, so there's no feedback
 *   loop (see `image-viewport-sync.ts`'s module doc for why no second
 *   "suppress while applying" guard is needed here, unlike the 3D bus).
 */
function useSyncedImageViewport(
  groupId: string | null | undefined,
  seed: ImageViewport,
): [ImageViewport, (v: ImageViewport) => void] {
  const [viewport, setViewport] = useState<ImageViewport>(seed);
  const sourceIdRef = useRef<string>();
  if (!sourceIdRef.current) sourceIdRef.current = makeImageViewportSyncSourceId();

  useEffect(() => {
    if (!groupId) return;
    const last = getLastImageViewportState(groupId);
    if (last) setViewport(last);
    return subscribeImageViewportState(groupId, sourceIdRef.current!, (state) => {
      setViewport(state);
    });
  }, [groupId]);

  const onViewportChange = useCallback(
    (v: ImageViewport) => {
      setViewport(v);
      if (groupId) publishImageViewportState(groupId, sourceIdRef.current!, v);
    },
    [groupId],
  );

  return [viewport, onViewportChange];
}

// --- ImagePane: content/aspect-sized, fills required config with defaults ---
// Like ScalarPlotStandalone, owns the interactive viewport locally: ImagePane's
// wheel-zoom (modifier-gated) + drag-pan are CONTROLLED — they need a
// `zoom`/`pan` value plus an `onViewportChange` callback to persist the gesture.
// Standalone has no settings store, so the adapter holds the state itself,
// seeded from any descriptor-provided `zoom`/`pan`. `p.viewportSyncGroupId`
// (threaded from a grid's `shared.sync.viewport` — see `plot-node.tsx`) links
// this viewport to every other synced pane in the same grid.
function ImageStandalone(p: P) {
  const [viewport, onViewportChange] = useSyncedImageViewport(p.viewportSyncGroupId, {
    zoom: p.zoom ?? 1,
    pan: p.pan ?? { x: 0, y: 0 },
  });
  // resolveImageRenderer: the backend for this mount (GpuImagePane or
  // CpuImagePane — both satisfy the shared `ImageBackendProps` contract, so
  // the swap below is a drop-in replacement), chosen by the user-settable
  // render mode: explicit `renderMode` from the descriptor/spec →
  // `window.__cairnPlotRenderMode` → `?render=cpu|gpu|auto` → "auto".
  const Pane = resolveImageRenderer(resolveRenderMode(p.renderMode));
  return (
    <Pane
      imageUrl={p.imageUrl ?? null}
      baselineUrl={p.baselineUrl ?? null}
      diffMode={p.diffMode ?? "none"}
      interpolation={p.interpolation ?? "auto"}
      colormap={p.colormap ?? "none"}
      showAxes={p.showAxes ?? false}
      label={p.label ?? ""}
      overlay={p.overlay}
      overlaySettings={p.overlaySettings}
      processing={p.processing}
      pixelValueNotation={p.pixelValueNotation}
      zoom={viewport.zoom}
      pan={viewport.pan}
      onViewportChange={onViewportChange}
    />
  );
}

// --- HdrImagePane: float-HDR image, tone-mapped client-side (canvas only) ---
// Data (`hdr`) arrives already-resolved from the `imghdr` DataSpec; the config
// props (`tonemap`/`exposure`/`gamma`) come from the descriptor. Wrapped in a
// ChartBox so it has a sizing box on a bare standalone page (like the charts) —
// the pane fills its container. NO static three.js / Plotly / engine import:
// this file stays in the CORE bundle; the GPU pane below (Task 8) is only
// ever reached through the runtime `window.__cairnPlotGpuImagePane` seam, so
// core.iife.js never carries the engine even though this adapter can render
// through it.
function ImageHdrStandalone(p: P) {
  const { height, ...rest } = p;
  const [viewport, onViewportChange] = useSyncedImageViewport(rest.viewportSyncGroupId, {
    zoom: rest.zoom ?? 1,
    pan: rest.pan ?? { x: 0, y: 0 },
  });
  // resolveImageRenderer: the backend for this mount (shared
  // `ImageBackendProps` contract, same render-mode resolution as
  // `ImageStandalone` above).
  const Pane = resolveImageRenderer(resolveRenderMode(rest.renderMode));
  return (
    <ChartBox height={height}>
      <Pane
        hdr={rest.hdr}
        tonemap={rest.tonemap ?? "srgb"}
        exposure={rest.exposure ?? 0}
        gamma={rest.gamma}
        showAxes={rest.showAxes ?? false}
        label={rest.label ?? ""}
        interpolation={rest.interpolation ?? "auto"}
        pixelValueNotation={rest.pixelValueNotation}
        zoom={viewport.zoom}
        pan={viewport.pan}
        onViewportChange={onViewportChange}
      />
    </ChartBox>
  );
}

function TableStandalone(p: P) {
  return (
    <Table
      table={p.table ?? { columns: [], data: [] }}
      rowsPerPage={p.rowsPerPage ?? 20}
      hiddenColumns={p.hiddenColumns ?? []}
      diffStatuses={p.diffStatuses}
      invertDiff={p.invertDiff}
    />
  );
}

/**
 * The core renderer registry. Names match the design spec §7 "clean 2D +
 * single-image" set (`scalar, scatter, parallel, bar, histogram, heatmap,
 * image`) plus `table`. `figure` (Plotly) and 3D (three.js) are ADDONS
 * registered at runtime — deliberately absent so they stay out of core.
 */
export const CORE_RENDERERS: Record<string, ComponentType<any>> = {
  scalar: ScalarPlotStandalone,
  scatter: ScatterPlotStandalone,
  parallel: ParallelCoordsStandalone,
  bar: BarChartStandalone,
  histogram: HistogramStandalone,
  heatmap: HeatmapStandalone,
  image: ImageStandalone,
  imagehdr: ImageHdrStandalone,
  table: TableStandalone,
};

/** Seed the runtime registry with the always-present core renderers. */
export function registerCoreRenderers(): void {
  for (const [name, component] of Object.entries(CORE_RENDERERS)) {
    registerRenderer(name, component);
  }
}
