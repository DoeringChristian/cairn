// Internal satellite of ScalarPlot: the wheel-zoom / pan / box-select / promoted
// right-axis-drag pointer state machine. Split out of ScalarPlot.tsx verbatim.
//
// GEOMETRY / COORDINATE SPACES
// ----------------------------
// `plotOffsetRef` holds the Recharts plot rectangle (the inner drawing area,
// excluding axes/legend) as captured by the <Customized> component. Recharts
// reports this `offset` in *chart-container-local* coordinates: the origin is
// the top-left of the chart container element (which is `chartBoxRef`, since the
// ResponsiveContainer fills it with no padding).
//
// The pointer/wheel handlers work in *client* coordinates (e.clientX/Y). To
// convert the measured plot rect into client space we add the container's
// client-space origin, i.e. `chartBoxRef.getBoundingClientRect().left/top`:
//
//     plotLeft(client)   = rect.left + po.left
//     plotRight(client)  = rect.left + po.left + po.width
//     plotTop(client)    = rect.top  + po.top
//     plotBottom(client) = rect.top  + po.top  + po.height
//
// From client coords we derive domain fractions (fx, fy) inside the plot rect,
// then map fractions to data-domain values. This conversion is written once,
// here, and used by both the wheel handler and pointer-down.
//
// If `plotOffsetRef` is unset (first render, before <Customized> has measured
// the rect) the gesture bails out rather than guessing a rect.

import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject, RefObject } from "react";
import type { PromotedSeriesConfig, Viewport } from "../../types";

export interface PlotOffset {
  top: number;
  left: number;
  width: number;
  height: number;
}

type RightAxisDragMode = "pan" | "scale";
type PlotDragMode = "pan" | "select";

export interface Selection {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface UsePlotGesturesArgs {
  chartBoxRef: RefObject<HTMLDivElement>;
  plotOffsetRef: MutableRefObject<PlotOffset | null>;
  effectiveRef: MutableRefObject<{ x: [number, number]; y: [number, number] }>;
  promotedRef: MutableRefObject<Record<string, PromotedSeriesConfig>>;
  onViewportChange: (v: Viewport) => void;
  onPromotedSeriesChange: (p: Record<string, PromotedSeriesConfig>) => void;
}

export function usePlotGestures({
  chartBoxRef,
  plotOffsetRef,
  effectiveRef,
  promotedRef,
  onViewportChange,
  onPromotedSeriesChange,
}: UsePlotGesturesArgs) {
  // `wasDragRef` distinguishes a drag from a click so the container's onClick
  // can suppress selection when a gesture just finished.
  const wasDragRef = useRef(false);

  const rightAxisDragRef = useRef<{
    key: string;
    pointerId: number;
    mode: RightAxisDragMode;
    startY: number;
    startMin: number;
    startMax: number;
    axisHeightPx: number;
    axisTopPx: number;
    anchorData: number;
  } | null>(null);

  const plotDragRef = useRef<{
    pointerId: number;
    mode: PlotDragMode;
    startClientX: number;
    startClientY: number;
    plotLeft: number;
    plotTop: number;
    plotW: number;
    plotH: number;
    startXDomain: [number, number];
    startYDomain: [number, number];
  } | null>(null);

  const [selection, setSelection] = useState<Selection | null>(null);

  // ── Wheel zoom (centers on cursor) ──
  useEffect(() => {
    const el = chartBoxRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      // Alt-gated, matching the unified chart viewport (useChartViewport): only
      // Alt+wheel zooms. A plain wheel does nothing and never calls
      // preventDefault, so it bubbles and scrolls the page normally. Ctrl/Cmd+
      // wheel is left alone (browser page-zoom); Alt is the sole zoom modifier.
      if (!e.altKey) return; // plain wheel → let the page scroll (no preventDefault)
      const po = plotOffsetRef.current;
      if (!po) return; // geometry not measured yet — bail rather than guess
      const rect = el.getBoundingClientRect();
      const plotLeft = rect.left + po.left;
      const plotRight = rect.left + po.left + po.width;
      const plotTop = rect.top + po.top;
      const plotBottom = rect.top + po.top + po.height;
      if (
        e.clientX < plotLeft || e.clientX > plotRight ||
        e.clientY < plotTop || e.clientY > plotBottom
      ) return;
      e.preventDefault();

      const factor = e.deltaY < 0 ? 1 / 1.1 : 1.1;
      const { x, y } = effectiveRef.current;
      const fx = (e.clientX - plotLeft) / Math.max(1, plotRight - plotLeft);
      const fy = (plotBottom - e.clientY) / Math.max(1, plotBottom - plotTop);
      const ax = x[0] + fx * (x[1] - x[0]);
      const ay = y[0] + fy * (y[1] - y[0]);
      onViewportChange({
        xMin: ax - (ax - x[0]) * factor,
        xMax: ax + (x[1] - ax) * factor,
        yMin: ay - (ay - y[0]) * factor,
        yMax: ay + (y[1] - ay) * factor,
      });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
    // refs are stable; only onViewportChange is a reactive dependency.
  }, [chartBoxRef, plotOffsetRef, effectiveRef, onViewportChange]);

  // ── Promoted right-axis strip drag (pan/scale) ──
  const onAxisStripPointerDown = useCallback(
    (
      key: string,
      e: React.PointerEvent<SVGRectElement>,
      axisHeightPx: number,
      axisTopPx: number,
    ) => {
      const cfg = promotedRef.current[key];
      if (!cfg) return;
      e.stopPropagation();
      e.preventDefault();
      chartBoxRef.current?.setPointerCapture(e.pointerId);
      const rect = (e.currentTarget as SVGRectElement)
        .ownerSVGElement?.getBoundingClientRect();
      const svgTop = rect?.top ?? 0;
      const localY = e.clientY - svgTop;
      const fracFromTop = Math.max(
        0,
        Math.min(1, (localY - axisTopPx) / Math.max(1, axisHeightPx)),
      );
      const anchorData = cfg.max - fracFromTop * (cfg.max - cfg.min);
      rightAxisDragRef.current = {
        key,
        pointerId: e.pointerId,
        mode: e.shiftKey ? "scale" : "pan",
        startY: e.clientY,
        startMin: cfg.min,
        startMax: cfg.max,
        axisHeightPx,
        axisTopPx,
        anchorData,
      };
    },
    [chartBoxRef, promotedRef],
  );

  // ── Plot-area pointer down (starts pan or box-select) ──
  const onChartPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      wasDragRef.current = false;
      const el = chartBoxRef.current;
      const po = plotOffsetRef.current;
      if (!el || !po) return; // geometry not measured yet — bail
      const rect = el.getBoundingClientRect();
      const plotLeft = rect.left + po.left;
      const plotRight = rect.left + po.left + po.width;
      const plotTop = rect.top + po.top;
      const plotBottom = rect.top + po.top + po.height;
      if (
        e.clientX < plotLeft || e.clientX > plotRight ||
        e.clientY < plotTop || e.clientY > plotBottom
      ) return;
      if (e.button !== 0) return;
      const mode: PlotDragMode = (e.altKey || e.ctrlKey || e.metaKey) ? "pan" : "select";
      plotDragRef.current = {
        pointerId: e.pointerId,
        mode,
        startClientX: e.clientX,
        startClientY: e.clientY,
        plotLeft,
        plotTop,
        plotW: Math.max(1, plotRight - plotLeft),
        plotH: Math.max(1, plotBottom - plotTop),
        startXDomain: effectiveRef.current.x,
        startYDomain: effectiveRef.current.y,
      };
    },
    [chartBoxRef, plotOffsetRef, effectiveRef],
  );

  const onChartPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const ax = rightAxisDragRef.current;
      if (ax && ax.pointerId === e.pointerId) {
        const dyPx = e.clientY - ax.startY;
        if (ax.mode === "pan") {
          const range = ax.startMax - ax.startMin;
          const dyData = (dyPx / Math.max(1, ax.axisHeightPx)) * range;
          onPromotedSeriesChange({
            ...promotedRef.current,
            [ax.key]: { min: ax.startMin + dyData, max: ax.startMax + dyData },
          });
        } else {
          const factor = Math.exp(dyPx / Math.max(1, ax.axisHeightPx));
          const newMin = ax.anchorData - (ax.anchorData - ax.startMin) * factor;
          const newMax = ax.anchorData + (ax.startMax - ax.anchorData) * factor;
          if (Number.isFinite(newMin) && Number.isFinite(newMax) && newMax > newMin) {
            onPromotedSeriesChange({
              ...promotedRef.current,
              [ax.key]: { min: newMin, max: newMax },
            });
          }
        }
        return;
      }

      const s = plotDragRef.current;
      if (!s || s.pointerId !== e.pointerId) return;
      const moved = Math.abs(e.clientX - s.startClientX) >= 3 || Math.abs(e.clientY - s.startClientY) >= 3;
      if (moved) {
        wasDragRef.current = true;
        try { (e.currentTarget as HTMLDivElement).setPointerCapture(s.pointerId); } catch { /* ok */ }
      }
      if (s.mode === "pan") {
        const dxPx = e.clientX - s.startClientX;
        const dyPx = e.clientY - s.startClientY;
        const [x0, x1] = s.startXDomain;
        const [y0, y1] = s.startYDomain;
        const dxData = (dxPx / s.plotW) * (x1 - x0);
        const dyData = (dyPx / s.plotH) * (y1 - y0);
        onViewportChange({
          xMin: x0 - dxData,
          xMax: x1 - dxData,
          yMin: y0 + dyData,
          yMax: y1 + dyData,
        });
        return;
      }
      const el2 = chartBoxRef.current;
      if (!el2) return;
      const rect2 = el2.getBoundingClientRect();
      const localX = e.clientX - rect2.left;
      const localY = e.clientY - rect2.top;
      const wPx = Math.abs(e.clientX - s.startClientX);
      const hPx = Math.abs(e.clientY - s.startClientY);
      if (wPx >= 6 || hPx >= 6) {
        const startLocalX = s.startClientX - rect2.left;
        const startLocalY = s.startClientY - rect2.top;
        setSelection({ x0: startLocalX, y0: startLocalY, x1: localX, y1: localY });
      }
    },
    [chartBoxRef, promotedRef, onViewportChange, onPromotedSeriesChange],
  );

  const onChartPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const ax = rightAxisDragRef.current;
      if (ax && ax.pointerId === e.pointerId) {
        wasDragRef.current = true;
        rightAxisDragRef.current = null;
        try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch { /* ok */ }
        return;
      }

      const s = plotDragRef.current;
      if (!s || s.pointerId !== e.pointerId) return;
      try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch { /* ok */ }
      if (s.mode === "select") {
        const wPx = Math.abs(e.clientX - s.startClientX);
        const hPx = Math.abs(e.clientY - s.startClientY);
        if (wPx >= 6 && hPx >= 6) {
          wasDragRef.current = true;
          const x0c = Math.min(s.startClientX, e.clientX);
          const x1c = Math.max(s.startClientX, e.clientX);
          const y0c = Math.min(s.startClientY, e.clientY);
          const y1c = Math.max(s.startClientY, e.clientY);
          const fxLo = (x0c - s.plotLeft) / s.plotW;
          const fxHi = (x1c - s.plotLeft) / s.plotW;
          const plotBottom = s.plotTop + s.plotH;
          const fyLo = (plotBottom - y1c) / s.plotH;
          const fyHi = (plotBottom - y0c) / s.plotH;
          const [xa, xb] = s.startXDomain;
          const [ya, yb] = s.startYDomain;
          const xMinNew = xa + fxLo * (xb - xa);
          const xMaxNew = xa + fxHi * (xb - xa);
          const yMinNew = ya + fyLo * (yb - ya);
          const yMaxNew = ya + fyHi * (yb - ya);
          if (
            Number.isFinite(xMinNew) && Number.isFinite(xMaxNew) &&
            Number.isFinite(yMinNew) && Number.isFinite(yMaxNew) &&
            xMaxNew > xMinNew && yMaxNew > yMinNew
          ) {
            onViewportChange({ xMin: xMinNew, xMax: xMaxNew, yMin: yMinNew, yMax: yMaxNew });
          }
        }
        setSelection(null);
      }
      plotDragRef.current = null;
    },
    [onViewportChange],
  );

  // ── Double-click: reset the viewport to autoscale (home) ──
  // Emit the all-null sentinel; ScalarPlot reads null bounds as "follow the
  // autoscaled data extent", matching the charts' dblclick-to-home reset.
  const onChartDoubleClick = useCallback(() => {
    plotDragRef.current = null;
    rightAxisDragRef.current = null;
    setSelection(null);
    onViewportChange({ xMin: null, xMax: null, yMin: null, yMax: null });
  }, [onViewportChange]);

  // For the container's onLostPointerCapture: abort any in-flight gesture.
  const clearDrag = useCallback(() => {
    plotDragRef.current = null;
    rightAxisDragRef.current = null;
    setSelection(null);
  }, []);

  return {
    selection,
    wasDragRef,
    onChartPointerDown,
    onChartPointerMove,
    onChartPointerUp,
    onChartDoubleClick,
    onAxisStripPointerDown,
    clearDrag,
  };
}
