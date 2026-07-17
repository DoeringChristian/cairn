/**
 * `renderers/scalar/use-scalar-controller.ts` — the ScalarPlot adapter that
 * projects its `Viewport {xMin,xMax,yMin,yMax}` + `onViewportChange` interaction
 * substrate onto the renderer-agnostic {@link PlotController} facade the
 * `<PlotToolbar>` drives.
 *
 * ScalarPlot uses a DIFFERENT substrate from the SVG charts (which layer
 * `useChartViewport` + `use-chart-controller.ts`): a numeric-or-null Viewport
 * prop plus the `usePlotGestures` pointer state machine. This adapter bridges
 * that gap:
 *  - dragMode ("zoom" = box-zoom / "pan") is LOCAL state; ScalarPlot threads it
 *    into `usePlotGestures` as `baseDragMode` so a plain drag honors the toggle
 *    (Alt-drag always pans — the modifier wins).
 *  - zoomIn/zoomOut rescale the current effective x&y span around its center.
 *  - autoscale AND reset both emit the all-null "home" sentinel (Viewport bounds
 *    of null mean "follow the autoscaled data extent").
 *  - toPNG reuses the shared self-contained `plotToPng` over the chart root
 *    (which contains the Recharts <svg>).
 *  - hover/spikelines are inert local state (Scalar advertises them as false),
 *    matching the SVG adapter's S0 stubs.
 */
import { useCallback, useMemo, useState } from "react";
import type { RefObject } from "react";
import { plotToPng } from "../../primitives/plot-to-png";
import type {
  ControllerCapabilities,
  DragMode,
  HoverMode,
  PlotController,
  ToPNGOptions,
} from "../../controls/types";
import type { Viewport } from "../../types";

export interface UseScalarControllerArgs {
  /** The live Scalar viewport (numeric bounds, or null where still auto). */
  viewport: Viewport;
  /** Commits a new viewport (numeric bounds to zoom/pan, all-null to go home). */
  onViewportChange: (v: Viewport) => void;
  /** The chart root (ScalarPlot's `chartBoxRef`) — the PNG export target. */
  rootRef: RefObject<HTMLElement | null>;
  /** The chart's full data extent, used to seed a zoom span when the viewport
   *  is still auto (null bounds). */
  dataBounds?: { x: [number, number]; y: [number, number] };
}

/** zoomIn shrinks the span to 80%; zoomOut grows it to 125%. */
const ZOOM_IN_FACTOR = 0.8;
const ZOOM_OUT_FACTOR = 1.25;

export function useScalarController({
  viewport,
  onViewportChange,
  rootRef,
  dataBounds,
}: UseScalarControllerArgs): PlotController {
  // Local drag mode: "zoom" (box-zoom, the default) or "pan". Scalar has no
  // box/lasso selection, so select/lasso are ignored if ever requested.
  const [dragMode, setDragModeState] = useState<DragMode>("zoom");
  // Hover / spikelines are visually INERT for Scalar (advertised as false).
  const [hoverMode, setHoverModeState] = useState<HoverMode>("closest");
  const [spikelines, setSpikelines] = useState<boolean>(false);

  const setDragMode = useCallback((m: DragMode) => {
    if (m === "zoom" || m === "pan") setDragModeState(m);
  }, []);
  const setHoverMode = useCallback((m: HoverMode) => setHoverModeState(m), []);
  const toggleSpikelines = useCallback(() => setSpikelines((v) => !v), []);

  // Current effective view bounds: prefer the live viewport, falling back
  // per-axis to the data extent wherever a bound is still auto (null). Returns
  // null when neither source yields a finite rectangle (nothing to zoom).
  const zoomBy = useCallback(
    (factor: number) => {
      const x0 = viewport.xMin ?? dataBounds?.x[0];
      const x1 = viewport.xMax ?? dataBounds?.x[1];
      const y0 = viewport.yMin ?? dataBounds?.y[0];
      const y1 = viewport.yMax ?? dataBounds?.y[1];
      if (
        x0 == null || x1 == null || y0 == null || y1 == null ||
        !Number.isFinite(x0) || !Number.isFinite(x1) ||
        !Number.isFinite(y0) || !Number.isFinite(y1)
      ) {
        return;
      }
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const hx = ((x1 - x0) * factor) / 2;
      const hy = ((y1 - y0) * factor) / 2;
      onViewportChange({
        xMin: cx - hx,
        xMax: cx + hx,
        yMin: cy - hy,
        yMax: cy + hy,
      });
    },
    [viewport, dataBounds, onViewportChange],
  );

  const zoomIn = useCallback(() => zoomBy(ZOOM_IN_FACTOR), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(ZOOM_OUT_FACTOR), [zoomBy]);

  // Autoscale and reset are the same "home" op: drop all bounds to auto.
  const home = useCallback(
    () => onViewportChange({ xMin: null, xMax: null, yMin: null, yMax: null }),
    [onViewportChange],
  );

  const toPNG = useCallback(
    (opts?: ToPNGOptions): Promise<Blob> => {
      const root = rootRef.current;
      if (!root) {
        return Promise.reject(new Error("toPNG: scalar plot root not mounted"));
      }
      return plotToPng(root, { scale: opts?.scale, filename: opts?.filename });
    },
    [rootRef],
  );

  // Any non-null bound means the view has been zoomed/panned off its home.
  const isModified =
    viewport.xMin != null ||
    viewport.xMax != null ||
    viewport.yMin != null ||
    viewport.yMax != null;

  const capabilities: ControllerCapabilities = useMemo(
    () => ({
      zoom: true,
      pan: true,
      boxZoom: true,
      autoscale: true,
      reset: true,
      screenshot: true,
      // Not supported by the Scalar substrate:
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
    [],
  );

  return useMemo<PlotController>(
    () => ({
      capabilities,
      dragMode,
      hoverMode,
      spikelines,
      isModified,
      setDragMode,
      setHoverMode,
      toggleSpikelines,
      zoomIn,
      zoomOut,
      autoscale: home,
      reset: home,
      toPNG,
    }),
    [
      capabilities,
      dragMode,
      hoverMode,
      spikelines,
      isModified,
      setDragMode,
      setHoverMode,
      toggleSpikelines,
      zoomIn,
      zoomOut,
      home,
      toPNG,
    ],
  );
}
