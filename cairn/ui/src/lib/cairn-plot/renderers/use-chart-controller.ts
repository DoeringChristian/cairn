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
 *  - toPNG                           → passed-in impl, else rejects (S10).
 *  - capabilities                    → hook's ChartCapabilities widened, with
 *                                      every not-yet-implemented flag = false.
 */
import { useCallback, useMemo, useState } from "react";
import type { RefObject } from "react";
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
  /** The renderer's root element — the future export target (S10 toPNG). */
  rootRef: RefObject<HTMLElement | null>;
  /** Optional client-side PNG exporter; when absent, `toPNG` rejects (S10). */
  toPNG?: (opts?: ToPNGOptions) => Promise<Blob>;
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
      if (toPNGImpl) return toPNGImpl(opts);
      // rootRef is the export target for the S10 client-side PNG pipeline.
      void rootRef;
      return Promise.reject(new Error("toPNG not implemented (S10)"));
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
      // Not implemented yet — reported false until their slice lands:
      select: false,
      lasso: false,
      hover: false,
      spikelines: false,
      hoverModes: false,
      legend: false,
      axisScaleToggle: false,
      perAxisDrag: false,
      brush: false,
      reorder: false,
    }),
    [vp],
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
    ],
  );
}
