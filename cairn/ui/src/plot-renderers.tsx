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
import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import ScalarPlot from "./lib/cairn-plot/renderers/ScalarPlot";
import ScatterPlot from "./lib/cairn-plot/renderers/ScatterPlot";
import ParallelCoords from "./lib/cairn-plot/renderers/ParallelCoords";
import BarChart from "./lib/cairn-plot/renderers/BarChart";
import HistogramPlot from "./lib/cairn-plot/renderers/HistogramPlot";
import Heatmap from "./lib/cairn-plot/renderers/Heatmap";
import ImagePane from "./lib/cairn-plot/renderers/ImagePane";
import HdrImagePane from "./lib/cairn-plot/renderers/HdrImagePane";
import Table from "./lib/cairn-plot/renderers/Table";
import type { Viewport, PromotedSeriesConfig } from "./lib/cairn-plot/types";
import type { Viewport as ImageViewport } from "./lib/cairn-plot/hooks/use-image-viewport";
import {
  getLastImageViewportState,
  makeImageViewportSyncSourceId,
  publishImageViewportState,
  subscribeImageViewportState,
} from "./lib/cairn-plot/viewport/image-viewport-sync";
import { ChartBox } from "./plot-standalone-helpers";
import { registerRenderer } from "./plot-registry";
// TYPE-ONLY import — erased at compile time, so this does NOT pull the
// engine's runtime code (or `GpuImagePane` itself) into `core.iife.js`; see
// `ImageRenderProps`'s own doc comment for why this is safe. Mirrors
// `media-compare/compositor.tsx`'s identical `import type { GpuComparePaneProps }`.
import type { ImageRenderProps } from "./lib/cairn-plot/renderers/GpuImagePane";

/** Loose prop bag — resolved data props + descriptor config, unified. */
type P = Record<string, any>;

// ---------------------------------------------------------------------------
// resolveImageRenderer — the formalized WebGPU-engine-or-legacy-CPU-pane
// SEAM for the standalone image path (Task 8, WebGPU engine Sub-project 1;
// named/formalized when the WebGL2 backend was removed — see
// `docs/superpowers/specs/2026-07-16-webgpu-engine-design.md`).
//
// This is the CAPABILITY-GATED half of the engine's fallback boundary: an
// up-front check, resolved once per page load, that decides WebGPU engine
// vs. legacy CPU pane BEFORE either ever mounts. The RUNTIME safety net
// (a mounted `GpuImagePane` that throws mid-render self-heals to the legacy
// pane — the C1 fix, `renderers/GpuImagePane.tsx`'s `engineFailed` state) is
// a SEPARATE, later line of defense — both land on the same legacy
// `ImagePane`/`HdrImagePane` pane, so a page never blanks whether WebGPU is
// simply unavailable (this seam) or available-but-fails-at-runtime (C1).
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

/**
 * Resolves the image-pane component to render THIS mount: the WebGPU
 * engine's `GpuImagePane` if the gpu-image addon has loaded AND the
 * capability flag is on (`__cairnPlotUseGpuImage === true`, set by the addon
 * itself once `getSharedDevice()` resolves — see its module doc), else
 * `null` (caller falls back to the legacy `ImagePane`/`HdrImagePane` CPU
 * pane) — covering "addon hasn't run yet", "opted out", and
 * "`getSharedDevice()` rejected (no WebGPU available)" uniformly, with ZERO
 * extra branching at the call site (`ImageStandalone`/`ImageHdrStandalone`
 * below just do `resolveImageRenderer() ?? LegacyPane`).
 *
 * Implemented as a React hook (despite the name — no `use` prefix, since
 * this is the seam's public name, not just an internal implementation
 * detail) because it must re-render the caller once, the instant the addon
 * finishes, via the `GPU_IMAGE_READY_EVENT` it dispatches — fixing the
 * async-registration race where the addon's `getSharedDevice()` check
 * resolves AFTER this component's first paint. Return type is the
 * formalized `ImageRenderProps` contract (`GpuImagePane`'s doc comment) —
 * both the engine pane and the legacy panes this resolves between accept
 * that same shape.
 */
function resolveImageRenderer(): ComponentType<ImageRenderProps> | null {
  const [, bump] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined" || window.__cairnPlotGpuImagePane) return;
    const onReady = () => bump((n) => n + 1);
    window.addEventListener(GPU_IMAGE_READY_EVENT, onReady);
    return () => window.removeEventListener(GPU_IMAGE_READY_EVENT, onReady);
  }, []);
  if (typeof window === "undefined" || window.__cairnPlotUseGpuImage !== true) return null;
  return (window.__cairnPlotGpuImagePane as ComponentType<ImageRenderProps> | undefined) ?? null;
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

function ScatterPlotStandalone(p: P) {
  const { height, ...rest } = p;
  return (
    <ChartBox height={height}>
      <ScatterPlot points={p.points ?? []} {...rest} />
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
      <BarChart bars={p.bars ?? []} {...rest} />
    </ChartBox>
  );
}

function HistogramStandalone(p: P) {
  const { height, ...rest } = p;
  // Discriminated on `view` ("bars" | "heatmap"); default to bars.
  const props = (rest.view ? rest : { ...rest, view: "bars" }) as any;
  return (
    <ChartBox height={height}>
      <HistogramPlot {...props} />
    </ChartBox>
  );
}

function HeatmapStandalone(p: P) {
  const { height, ...rest } = p;
  return (
    <ChartBox height={height}>
      <Heatmap matrix={p.matrix ?? []} colormap={p.colormap ?? "viridis"} {...rest} />
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
  // resolveImageRenderer: the WebGPU engine pane when available (both sides
  // satisfy the shared `ImageRenderProps` contract, so the swap below is a
  // drop-in replacement — see that type's doc comment), else `null` and this
  // falls back to the legacy `ImagePane`.
  const Pane = (resolveImageRenderer() ?? ImagePane) as typeof ImagePane;
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
  // resolveImageRenderer: the WebGPU engine pane when available (shared
  // `ImageRenderProps` contract, same as `ImageStandalone` above), else the
  // legacy `HdrImagePane`.
  const Pane = (resolveImageRenderer() ?? HdrImagePane) as typeof HdrImagePane;
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
