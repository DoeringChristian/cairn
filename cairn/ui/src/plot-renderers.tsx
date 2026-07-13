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
import { useState, type ComponentType } from "react";
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
import { ChartBox } from "./plot-standalone-helpers";
import { registerRenderer } from "./plot-registry";

/** Loose prop bag — resolved data props + descriptor config, unified. */
type P = Record<string, any>;

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

// --- ImagePane: content/aspect-sized, fills required config with defaults ---
function ImageStandalone(p: P) {
  return (
    <ImagePane
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
      zoom={p.zoom}
      pan={p.pan}
    />
  );
}

// --- HdrImagePane: float-HDR image, tone-mapped client-side (canvas only) ---
// Data (`hdr`) arrives already-resolved from the `imghdr` DataSpec; the config
// props (`tonemap`/`exposure`/`gamma`) come from the descriptor. Wrapped in a
// ChartBox so it has a sizing box on a bare standalone page (like the charts) —
// the pane fills its container. NO three.js / Plotly: pure canvas 2D, so it
// lives in the CORE bundle.
function ImageHdrStandalone(p: P) {
  const { height, ...rest } = p;
  return (
    <ChartBox height={height}>
      <HdrImagePane
        hdr={rest.hdr}
        tonemap={rest.tonemap ?? "srgb"}
        exposure={rest.exposure ?? 0}
        gamma={rest.gamma ?? 1}
        showAxes={rest.showAxes ?? false}
        label={rest.label ?? ""}
        interpolation={rest.interpolation ?? "auto"}
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
