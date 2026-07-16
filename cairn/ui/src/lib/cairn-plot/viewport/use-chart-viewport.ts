/**
 * `useChartViewport` — the single, Plotly-style zoom/pan state machine shared by
 * every 2D cairn-plot chart renderer (ScatterPlot / HistogramPlot / BarChart /
 * Heatmap). It mirrors ScalarPlot's Recharts gesture machine
 * (`renderers/scalar/use-plot-gestures.ts`) exactly — wheel-zoom to cursor,
 * drag-to-box-zoom, modifier/mode pan, double-click reset — so all charts feel
 * identical.
 *
 * The hook owns the viewport as internal state (with a controlled `value`/
 * `onChange` override) and returns a live `domain` in MAPPED axis space. A
 * renderer's job is only to (1) feed a `home` domain + a per-render
 * `plotRectRef` (the plot inset in container-local px), (2) rebuild its
 * `toX`/`toY` from the returned `domain`, and (3) spread `containerProps` +
 * draw the `dragRect` overlay. All the pointer math lives in
 * `chart-viewport-math.ts`.
 *
 * Self-contained per the project's self-contained-components rule: no app
 * hooks, no external viewport store — the component holds its own view state.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, MutableRefObject, RefObject } from "react";
import {
  applyConstraints,
  boxToDomain,
  BOX_THRESHOLD_PX,
  DRAG_START_PX,
  domainsEqual,
  panByPixels,
  wheelZoom,
  WHEEL_FACTOR,
  zoomAboutAnchor,
  type ChartDomain,
  type ClientRect,
  type ConstrainAxis,
  type DomainClamp,
  type MinSpan,
} from "./chart-viewport-math";

export type { ChartDomain } from "./chart-viewport-math";

export type ChartDragMode = "box" | "pan";

/** A plot rectangle in CONTAINER-LOCAL px (origin = container top-left), the
 *  same space `plotRectRef` is written in each render. */
export interface PlotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The capability descriptor a renderer publishes alongside its viewport, so a
 * future toolbar (S5) can honestly show/hide controls. Charts expose the full
 * set; ParallelCoords deliberately omits zoom/pan (see its module comment).
 */
export interface ChartCapabilities {
  zoom: boolean;
  pan: boolean;
  boxZoom: boolean;
  autoscale: boolean;
  reset: boolean;
  screenshot: boolean;
}

/** The full 2D-chart capability set (Scatter/Histogram/BarChart/Heatmap). */
export const CHART_CAPABILITIES: ChartCapabilities = {
  zoom: true,
  pan: true,
  boxZoom: true,
  autoscale: true,
  reset: true,
  screenshot: true,
};

/**
 * Imperative controller surface. Named to match the future `PlotController`
 * (S5 toolbar) 1:1 so wiring a toolbar needs zero rework here.
 */
export interface ChartViewportActions {
  zoomIn: () => void;
  zoomOut: () => void;
  autoscale: () => void;
  reset: () => void;
  setDragMode: (m: ChartDragMode) => void;
  panBy: (dxData: number, dyData: number) => void;
  zoomTo: (domain: ChartDomain) => void;
}

export interface UseChartViewportArgs {
  /** The element that receives pointer/wheel gestures (the renderer's root). */
  containerRef: RefObject<HTMLElement | null>;
  /** The plot inset in container-local px, rewritten each render. */
  plotRectRef: MutableRefObject<PlotRect | null>;
  /** The autoscaled/padded "home" domain (mapped space). Following it while
   *  unmodified means new data reframes automatically. */
  home: ChartDomain;
  /** Controlled viewport. When set, the hook renders `value` and reports
   *  changes through `onChange` instead of holding internal state. */
  value?: ChartDomain;
  onChange?: (domain: ChartDomain) => void;
  /** Primary drag gesture. `'box'` (default) = drag to box-zoom; `'pan'` =
   *  drag to pan. The modifier key inverts whichever is active. */
  dragMode?: ChartDragMode;
  /** Restrict gestures to one axis (`'x'` = BarChart value axis only). */
  constrainTo?: ConstrainAxis;
  /** Minimum span per axis (max-zoom floor, e.g. one histogram bin). */
  minSpan?: MinSpan;
  /** Hard bounds the domain may never exceed (e.g. heatmap [0,cols]/[0,rows]). */
  clamp?: DomainClamp;
  /** Keep square cells by equalizing units-per-pixel (Heatmap opt-in). */
  lockAspect?: boolean;
}

export interface ChartViewportResult {
  /** The live viewport (mapped space): `value ?? internal ?? home`. */
  domain: ChartDomain;
  /** Spread onto the renderer's root element. */
  containerProps: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
    onDoubleClick: () => void;
    style: CSSProperties;
  };
  /** The live box-zoom rectangle in container-local px, or `null`. */
  dragRect: { x: number; y: number; width: number; height: number } | null;
  /** True when the current view differs from `home`. */
  isModified: boolean;
  /** Set true while a drag just occurred; a renderer's mark/background onClick
   *  should early-return when this is set (suppresses the click that ends a
   *  drag), then it self-clears. Mirrors use-plot-gestures.ts:68. */
  wasDragRef: MutableRefObject<boolean>;
  actions: ChartViewportActions;
  capabilities: ChartCapabilities;
}

interface DragState {
  pointerId: number;
  mode: ChartDragMode;
  startClientX: number;
  startClientY: number;
  startDomain: ChartDomain;
  /** Plot rect in client space at pointer-down (for box/pan mapping). */
  rectClient: ClientRect;
  moved: boolean;
}

/** Read the local `plotRectRef` and lift it into client space via the
 *  container's current bounding rect. Returns null if not measured. */
function rectToClient(
  containerRef: RefObject<HTMLElement | null>,
  plotRectRef: MutableRefObject<PlotRect | null>,
): ClientRect | null {
  const el = containerRef.current;
  const pr = plotRectRef.current;
  if (!el || !pr) return null;
  const box = el.getBoundingClientRect();
  return {
    left: box.left + pr.x,
    top: box.top + pr.y,
    width: pr.width,
    height: pr.height,
  };
}

export function useChartViewport({
  containerRef,
  plotRectRef,
  home,
  value,
  onChange,
  dragMode = "box",
  constrainTo = "both",
  minSpan,
  clamp,
  lockAspect,
}: UseChartViewportArgs): ChartViewportResult {
  // `null` internal ⇒ "follow home" (auto-reframe on new data). A committed
  // gesture sets it; reset clears it back to null.
  const [internal, setInternal] = useState<ChartDomain | null>(null);
  const [dragMode2, setDragMode2] = useState<ChartDragMode>(dragMode);
  const [dragRect, setDragRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const controlled = value !== undefined;
  const domain: ChartDomain = value ?? internal ?? home;

  // Latest values behind refs so the wheel/pointer handlers stay stable and
  // never read stale closures.
  const domainRef = useRef(domain);
  domainRef.current = domain;
  const dragModeRef = useRef(dragMode2);
  dragModeRef.current = dragMode2;
  const constrainRef = useRef(constrainTo);
  constrainRef.current = constrainTo;
  const rectRef = useRef<{ width: number; height: number } | null>(null);
  rectRef.current = plotRectRef.current
    ? { width: plotRectRef.current.width, height: plotRectRef.current.height }
    : null;

  const wasDragRef = useRef(false);
  const dragRef = useRef<DragState | null>(null);

  const constrain = useCallback(
    (d: ChartDomain): ChartDomain =>
      applyConstraints(d, {
        clamp,
        minSpan,
        lockAspect,
        rect: rectRef.current,
      }),
    [clamp, minSpan, lockAspect],
  );

  const commit = useCallback(
    (d: ChartDomain) => {
      const next = constrain(d);
      onChange?.(next);
      if (!controlled) setInternal(next);
    },
    [constrain, onChange, controlled],
  );

  const reset = useCallback(() => {
    onChange?.(home);
    if (!controlled) setInternal(null);
  }, [home, onChange, controlled]);

  // ── Wheel zoom (non-passive so preventDefault sticks) ──
  // Alt-gated: only Alt+wheel zooms. A plain wheel does nothing and never calls
  // preventDefault, so it bubbles and scrolls the page normally. Ctrl/Cmd+wheel
  // is left alone (browser page-zoom); Alt is the sole zoom modifier.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!e.altKey) return; // plain wheel → let the page scroll (no preventDefault)
      const rect = rectToClient(containerRef, plotRectRef);
      if (!rect) return;
      const next = wheelZoom(
        e.clientX,
        e.clientY,
        rect,
        domainRef.current,
        e.deltaY,
        constrainRef.current,
      );
      if (!next) return; // cursor outside plot → let the page scroll
      e.preventDefault();
      commit(next);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [containerRef, plotRectRef, commit]);

  // ── Pointer down: begin pan or box-zoom (modifier inverts the mode) ──
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      wasDragRef.current = false;
      if (e.button !== 0) return;
      const rect = rectToClient(containerRef, plotRectRef);
      if (!rect) return;
      if (
        e.clientX < rect.left ||
        e.clientX > rect.left + rect.width ||
        e.clientY < rect.top ||
        e.clientY > rect.top + rect.height
      ) {
        return; // gesture only starts inside the plot rect
      }
      const modifier = e.altKey || e.ctrlKey || e.metaKey;
      const base = dragModeRef.current;
      // modifier XOR base: box↔pan.
      const mode: ChartDragMode = modifier
        ? base === "pan"
          ? "box"
          : "pan"
        : base;
      dragRef.current = {
        pointerId: e.pointerId,
        mode,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startDomain: domainRef.current,
        rectClient: rect,
        moved: false,
      };
    },
    [containerRef, plotRectRef],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const s = dragRef.current;
      if (!s || s.pointerId !== e.pointerId) return;
      const dx = e.clientX - s.startClientX;
      const dy = e.clientY - s.startClientY;
      if (!s.moved && (Math.abs(dx) >= DRAG_START_PX || Math.abs(dy) >= DRAG_START_PX)) {
        s.moved = true;
        wasDragRef.current = true;
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(s.pointerId);
        } catch {
          /* capture is best-effort */
        }
      }
      if (s.mode === "pan") {
        commit(panByPixels(dx, dy, s.rectClient, s.startDomain, constrainRef.current));
        return;
      }
      // box: draw the live rectangle (container-local px) once past threshold.
      if (Math.abs(dx) >= BOX_THRESHOLD_PX || Math.abs(dy) >= BOX_THRESHOLD_PX) {
        const el = containerRef.current;
        const box = el?.getBoundingClientRect();
        if (!box) return;
        const x0 = s.startClientX - box.left;
        const y0 = s.startClientY - box.top;
        const x1 = e.clientX - box.left;
        const y1 = e.clientY - box.top;
        setDragRect({
          x: Math.min(x0, x1),
          y: Math.min(y0, y1),
          width: Math.abs(x1 - x0),
          height: Math.abs(y1 - y0),
        });
      }
    },
    [commit, containerRef],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent) => {
      const s = dragRef.current;
      if (!s || s.pointerId !== e.pointerId) return;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ok */
      }
      if (s.mode === "box") {
        const dx = Math.abs(e.clientX - s.startClientX);
        const dy = Math.abs(e.clientY - s.startClientY);
        // Require a real 2D box on unconstrained axes; a 1D drag on a
        // constrained axis (BarChart x-only) needs width only.
        const okX = constrainRef.current === "y" || dx >= BOX_THRESHOLD_PX;
        const okY = constrainRef.current === "x" || dy >= BOX_THRESHOLD_PX;
        if (okX && okY) {
          const next = boxToDomain(
            s.startClientX,
            s.startClientY,
            e.clientX,
            e.clientY,
            s.rectClient,
            s.startDomain,
            constrainRef.current,
          );
          if (next) commit(next);
        }
      }
      setDragRect(null);
      dragRef.current = null;
    },
    [commit],
  );

  const actions: ChartViewportActions = useMemo(() => {
    const zoomBy = (factor: number) => {
      const d = domainRef.current;
      const cx = (d.xDomain[0] + d.xDomain[1]) / 2;
      const cy = (d.yDomain[0] + d.yDomain[1]) / 2;
      commit(zoomAboutAnchor(d, cx, cy, factor, constrainRef.current));
    };
    return {
      zoomIn: () => zoomBy(1 / WHEEL_FACTOR),
      zoomOut: () => zoomBy(WHEEL_FACTOR),
      autoscale: reset,
      reset,
      setDragMode: (m: ChartDragMode) => setDragMode2(m),
      panBy: (dxData: number, dyData: number) => {
        const d = domainRef.current;
        commit({
          xDomain: [d.xDomain[0] + dxData, d.xDomain[1] + dxData],
          yDomain: [d.yDomain[0] + dyData, d.yDomain[1] + dyData],
        });
      },
      zoomTo: (target: ChartDomain) => commit(target),
    };
  }, [commit, reset]);

  const isModified = !domainsEqual(domain, home);

  const cursor =
    dragMode2 === "pan" ? "grab" : "crosshair";
  const containerProps = {
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onDoubleClick: reset,
    style: {
      touchAction: "none",
      cursor,
      userSelect: "none",
      WebkitUserSelect: "none",
    } as CSSProperties,
  };

  return {
    domain,
    containerProps,
    dragRect,
    isModified,
    wasDragRef,
    actions,
    capabilities: CHART_CAPABILITIES,
  };
}
