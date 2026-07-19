/**
 * `renderers/use-chart-controller.ts` — the SVG-chart adapter that projects a
 * `useChartViewport` return value onto the renderer-agnostic {@link PlotController}
 * facade the `<PlotToolbar>` (S1) drives. One per chart instance
 * (Scatter/Histogram/Bar/Heatmap). ScalarPlot and ParallelCoords get their own
 * adapters in later slices.
 *
 * S0 SKELETON — no behavior change, not mounted anywhere yet (S1 mounts it):
 *  - zoomIn/zoomOut/autoscale/reset  → the viewport hook's `actions` 1:1.
 *  - setDragMode(public "zoom")      → translate "zoom"→"box", call the hook.
 *  - dragMode getter                 → translate internal "box"→"zoom".
 *  - hoverMode / spikelines          → local state, VISUALLY INERT until S4.
 *  - toPNG                           → passed-in impl, else the shared
 *                                      `plotToPng(rootRef.current)` default.
 *  - capabilities                    → hook's ChartCapabilities widened, with
 *                                      every not-yet-implemented flag = false.
 */
import { useCallback, useMemo, useState } from "react";
import type { RefObject } from "react";
import { plotToPng } from "../primitives/plot-to-png";
import type { ChartDragMode, ChartViewportResult } from "../viewport/use-chart-viewport";
import type {
  ControllerCapabilities,
  DragMode,
  HoverMode,
  PlotController,
  ToPNGOptions,
} from "../controls/types";

export interface UseChartControllerArgs {
  /** The renderer's `useChartViewport` result (state machine + actions). */
  viewport: ChartViewportResult;
  /** The renderer's root element — the default `toPNG` export target. */
  rootRef: RefObject<HTMLElement | null>;
  /** Optional client-side PNG exporter; when absent, `toPNG` rasterizes
   *  `rootRef` via the shared `plotToPng` helper. */
  toPNG?: (opts?: ToPNGOptions) => Promise<Blob>;
  /** Advertise box-select + lasso (ScatterPlot). When true the toolbar shows
   *  the select/lasso mode buttons; other charts leave it off. */
  selectable?: boolean;
  /** The renderer's current selection, surfaced on `controller.selection` so a
   *  toolbar (or host) can read the ids / clear it. Pass alongside
   *  `selectable`. */
  selection?: { ids: ReadonlySet<string>; clear: () => void };
}

/** internal ChartDragMode → public DragMode ("box" is the toolbar's "zoom"). */
function toPublicDragMode(m: ChartDragMode): DragMode {
  return m === "box" ? "zoom" : m;
}

/** public DragMode → internal ChartDragMode (toolbar "zoom" is the hook's "box"). */
function toInternalDragMode(m: DragMode): ChartDragMode {
  return m === "zoom" ? "box" : m;
}

export function useChartController({
  viewport,
  rootRef,
  toPNG: toPNGImpl,
  selectable = false,
  selection,
}: UseChartControllerArgs): PlotController {
  // The hook does not expose its current drag mode, so we mirror it here. The
  // hook's default is "box"; the public face of that is "zoom".
  const [internalDragMode, setInternalDragMode] = useState<ChartDragMode>("box");
  // Hover/spikelines are visually INERT in S0 — wired to the renderers in S4.
  const [hoverMode, setHoverModeState] = useState<HoverMode>("closest");
  const [spikelines, setSpikelines] = useState<boolean>(false);

  const { actions, capabilities: vp, isModified } = viewport;

  const setDragMode = useCallback(
    (m: DragMode) => {
      const internal = toInternalDragMode(m);
      setInternalDragMode(internal);
      actions.setDragMode(internal);
    },
    [actions],
  );

  const setHoverMode = useCallback((m: HoverMode) => setHoverModeState(m), []);
  const toggleSpikelines = useCallback(() => setSpikelines((v) => !v), []);

  const toPNG = useCallback(
    (opts?: ToPNGOptions): Promise<Blob> => {
      // An explicitly-passed exporter always wins.
      if (toPNGImpl) return toPNGImpl(opts);
      // Default: rasterize the renderer root (which contains the chart <svg>
      // and any <canvas> layers) with the shared, self-contained helper.
      const root = rootRef.current;
      if (!root) {
        return Promise.reject(
          new Error("toPNG: export target not mounted (rootRef is null)"),
        );
      }
      return plotToPng(root, opts);
    },
    [toPNGImpl, rootRef],
  );

  const capabilities: ControllerCapabilities = useMemo(
    () => ({
      // From the viewport hook:
      zoom: vp.zoom,
      pan: vp.pan,
      boxZoom: vp.boxZoom,
      autoscale: vp.autoscale,
      reset: vp.reset,
      screenshot: vp.screenshot,
      // Box-select + lasso: on for renderers that opt in (ScatterPlot).
      select: selectable,
      lasso: selectable,
      // Not implemented yet — reported false until their slice lands:
      hover: false,
      spikelines: false,
      hoverModes: false,
      legend: false,
      axisScaleToggle: false,
      perAxisDrag: false,
      brush: false,
      reorder: false,
    }),
    [vp, selectable],
  );

  return useMemo<PlotController>(
    () => ({
      capabilities,
      dragMode: toPublicDragMode(internalDragMode),
      hoverMode,
      spikelines,
      isModified,
      setDragMode,
      setHoverMode,
      toggleSpikelines,
      zoomIn: actions.zoomIn,
      zoomOut: actions.zoomOut,
      autoscale: actions.autoscale,
      reset: actions.reset,
      toPNG,
      // Only surfaced when the renderer opts into selection (ScatterPlot); the
      // `PlotController.selection` member is optional so other charts omit it.
      selection: selectable ? selection : undefined,
    }),
    [
      capabilities,
      internalDragMode,
      hoverMode,
      spikelines,
      isModified,
      setDragMode,
      setHoverMode,
      toggleSpikelines,
      actions,
      toPNG,
      selectable,
      selection,
    ],
  );
}
