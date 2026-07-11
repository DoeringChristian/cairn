/**
 * `RENDERER_MAP` — the standalone plot bundle's `renderer` name → component
 * table (design spec §4). It imports the SAME pure `lib/cairn-plot` renderers
 * the viewer app uses, so a Python-emitted plot is pixel-identical to the same
 * renderer in the app (consistency by construction).
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
 *
 * Figure (Plotly) is a `React.lazy` chunk so plotly.js-dist-min (~4.6M) stays
 * OUT of the eager plot bundle and only loads when a `figure` plot renders.
 * 3D (three.js) renderers are intentionally NOT in the eager map — Phase D.
 */
import React, { useState, type ComponentType } from "react";
import {
  ScalarPlot,
  ScatterPlot,
  ParallelCoords,
  BarChart,
  HistogramPlot,
  Heatmap,
  ImagePane,
  Table,
  type Viewport,
  type PromotedSeriesConfig,
} from "./lib/cairn-plot";

/** Loose prop bag — resolved data props + descriptor config, unified. */
type P = Record<string, any>;

const DEFAULT_CHART_HEIGHT = 400;

/** Wrap a container-filling chart renderer in a default-height box so it has
 *  something to measure on a bare standalone page. The pure chart renderers
 *  size themselves to their parent (their root has no intrinsic height — in
 *  the app the card supplies a fixed-height flex cell), so we force the direct
 *  child to fill this box (renderer-agnostic; works whether or not a renderer
 *  forwards `className`). Height is overridable via `props.height` (px). */
function ChartBox({ height, children }: { height?: number; children: React.ReactNode }) {
  return (
    <div
      className="cairn-plot-chartbox"
      style={{ height: height ?? DEFAULT_CHART_HEIGHT, width: "100%" }}
    >
      <style>{".cairn-plot-chartbox > * { height: 100%; width: 100%; }"}</style>
      {children}
    </div>
  );
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

// --- Figure: LAZY so plotly.js stays out of the eager plot bundle ----------
const LazyFigure = React.lazy(() => import("./lib/cairn-plot/renderers/Figure"));

const DEFAULT_FIGURE_SETTINGS = {
  displayModeBar: true,
  scrollZoom: false,
  hoverMode: "closest" as const,
  dragMode: "zoom" as const,
  showLegend: true,
};

function FigureStandalone(p: P) {
  const { height, figure, settings, ...rest } = p;
  return (
    <ChartBox height={height}>
      <LazyFigure
        figure={figure ?? { data: [], layout: {} }}
        settings={{ ...DEFAULT_FIGURE_SETTINGS, ...(settings ?? {}) }}
        style={{ width: "100%", height: "100%" }}
        {...rest}
      />
    </ChartBox>
  );
}

/**
 * The renderer registry. Names match the design spec §7 "clean 2D +
 * single-image" set (`scalar, scatter, parallel, bar, histogram, heatmap,
 * image`) plus `table` and `figure`. 3D (`pointcloud`/`mesh`/`boxes`/`volume`)
 * is Phase D and deliberately absent (keeps three.js out of the eager bundle).
 */
export const RENDERER_MAP: Record<string, ComponentType<any>> = {
  scalar: ScalarPlotStandalone,
  scatter: ScatterPlotStandalone,
  parallel: ParallelCoordsStandalone,
  bar: BarChartStandalone,
  histogram: HistogramStandalone,
  heatmap: HeatmapStandalone,
  image: ImageStandalone,
  table: TableStandalone,
  figure: FigureStandalone,
};
