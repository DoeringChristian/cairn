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
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, MutableRefObject, RefObject } from "react";
import {
  applyConstraints,
  axisScale1D,
  boxToDomain,
  boxZoomAxis,
  BOX_THRESHOLD_PX,
  constrainDragRect,
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
  type PixelPoint,
  type PixelRect,
} from "./chart-viewport-math";
import {
  getLastChartViewport,
  publishChartViewport,
  subscribeChartViewport,
  type ChartSyncPayload,
} from "./chart-viewport-sync";
import { useModifierKey } from "../hooks/use-modifier-key";

export type { ChartDomain } from "./chart-viewport-math";

/**
 * Identifies the live-sync group a chart belongs to (see
 * `chart-viewport-sync.ts`). `groupId` scopes the pub/sub bus (one per synced
 * grid); `sourceId` is this chart instance's echo-guard token (a peer ignores
 * its own broadcasts). Passed to {@link useChartViewport} either as the `sync`
 * arg (direct/testable) or — since the pure chart renderers don't forward a
 * viewport-sync prop — through {@link ChartViewportSyncProvider}, so a
 * standalone adapter can opt a whole subtree into a group without the renderer
 * component needing to know sync exists (mirrors how the image path threads
 * `viewportSyncGroupId` into `useSyncedImageViewport`).
 */
export interface ChartViewportSyncTarget {
  groupId: string;
  sourceId: string;
}

const ChartViewportSyncContext = createContext<ChartViewportSyncTarget | null>(null);

/**
 * Opts every {@link useChartViewport} in the subtree into the given sync group.
 * The standalone chart adapters (`plot-renderers.tsx`) wrap their pure renderer
 * in this when a grid enables `shared.sync.viewport`, so the shared hook picks
 * the group up from context without any renderer-component plumbing. An explicit
 * `sync` arg still wins over context (see the hook body).
 */
export const ChartViewportSyncProvider = ChartViewportSyncContext.Provider;

// The internal drag vocabulary. `"box"` (box-zoom) is deliberately kept as the
// internal token — the toolbar's PUBLIC name `"zoom"` is translated to `"box"`
// at the controller adapter (renderers/use-chart-controller.ts). `"select"`
// (rubber-band marquee) and `"lasso"` (freeform polygon) collect a geometry and
// emit it via the `onSelect` callback on release instead of zooming; a renderer
// (ScatterPlot today) hit-tests its marks against that geometry. `"pan"` drags
// the view. A held modifier temporarily swaps the active gesture to pan (box/
// select/lasso) or box (pan) — see the pointer-down path.
export type ChartDragMode = "box" | "pan" | "select" | "lasso";

/**
 * A completed selection gesture, emitted through {@link UseChartViewportArgs.onSelect}
 * on release. Both variants are expressed in the renderer's CONTAINER-LOCAL px
 * space (origin = container top-left) — the same space as `dragRect`/`dragPath`
 * and a renderer's `toX`/`toY` outputs — so the renderer can hit-test directly
 * with `pointInRect`/`pointInPolygon`.
 */
export type SelectionGeometry =
  | { kind: "rect"; rect: PixelRect }
  | { kind: "lasso"; points: PixelPoint[] };

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
  /** Called on release of a `"select"` / `"lasso"` drag with the completed
   *  marquee/polygon (container-local px). A renderer hit-tests its marks
   *  against it. When absent, select/lasso drags draw their overlay but emit
   *  nothing (so a chart that doesn't opt in never selects). */
  onSelect?: (geometry: SelectionGeometry) => void;
  /** Live viewport-sync group. When set (directly, or inherited from
   *  {@link ChartViewportSyncProvider}), every viewport COMMIT publishes the
   *  new domain to the group and peers' commits are applied here — Plotly
   *  matched-axes behaviour across a grid. A direct arg wins over context. */
  sync?: ChartViewportSyncTarget;
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
    onPointerLeave: (e: React.PointerEvent) => void;
    onDoubleClick: () => void;
    style: CSSProperties;
  };
  /** The live box-zoom / box-select rectangle in container-local px, or `null`.
   *  (`"select"` mode reuses this channel; the renderer draws the same overlay.) */
  dragRect: { x: number; y: number; width: number; height: number } | null;
  /** The live lasso polygon (ordered container-local px vertices) while a
   *  `"lasso"` drag is in progress, or `null`. The renderer strokes it. */
  dragPath: PixelPoint[] | null;
  /** True when the current view differs from `home`. */
  isModified: boolean;
  /** Set true while a drag just occurred; a renderer's mark/background onClick
   *  should early-return when this is set (suppresses the click that ends a
   *  drag), then it self-clears. Mirrors use-plot-gestures.ts:68. */
  wasDragRef: MutableRefObject<boolean>;
  actions: ChartViewportActions;
  capabilities: ChartCapabilities;
}

/**
 * A drag begun in an axis GUTTER (the margin band below the x-axis / left of
 * the y-axis, outside the plot rect). `axis` names which domain it drives;
 * `sub` is pan (middle third of the axis) or scale (an outer third, pinned at
 * the opposite end). For scale, `grabFrac` is the grabbed point's fraction
 * along the axis at pointer-down and `anchorFrac` (0 = low end, 1 = high end)
 * is the pinned end. See FEATURE B in the hook body.
 */
interface GutterDrag {
  axis: ConstrainAxis; // "x" | "y"
  sub: "pan" | "scale";
  grabFrac: number;
  anchorFrac: 0 | 1;
}

interface DragState {
  pointerId: number;
  /** `"plot"` = pan/box-zoom inside the plot rect; `"gutter"` = an axis-element
   *  (margin) pan/scale. The pointer handlers branch on this first. */
  kind: "plot" | "gutter";
  mode: ChartDragMode;
  startClientX: number;
  startClientY: number;
  startDomain: ChartDomain;
  /** Plot rect in client space at pointer-down (for box/pan/scale mapping). */
  rectClient: ClientRect;
  moved: boolean;
  /** Present only when `kind === "gutter"`. */
  gutter?: GutterDrag;
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

/**
 * Which axis GUTTER (margin band) a client point sits in, or `null` when it is
 * inside the plot or off the container. `rect` is the plot rect in client space
 * and `box` the container's client rect. Shared by the pointer-down grab logic
 * (FEATURE B) and the pointer-move cursor affordance so both agree on where the
 * gutters are: the x-gutter is below the plot within its x-extent (drives X),
 * the y-gutter is left of the plot within its y-extent (drives Y). `constrainTo`
 * disables the gutter for an axis a chart doesn't expose.
 */
function gutterAxisAt(
  clientX: number,
  clientY: number,
  rect: ClientRect,
  box: { left: number; bottom: number },
  constrainTo: ConstrainAxis,
): "x" | "y" | null {
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  const inPlotX = clientX >= rect.left && clientX <= right;
  const inPlotY = clientY >= rect.top && clientY <= bottom;
  if (constrainTo !== "y" && inPlotX && clientY > bottom && clientY <= box.bottom) {
    return "x";
  }
  if (constrainTo !== "x" && inPlotY && clientX < rect.left && clientX >= box.left) {
    return "y";
  }
  return null;
}

/** Classify an axis-gutter grab (`grabFrac` = fraction 0..1 along the axis) as
 *  a pan (middle third) or a scale pinned at the opposite end (outer thirds:
 *  near the low end → pin the high end, and vice-versa). */
function gutterFromFrac(axis: "x" | "y", grabFrac: number): GutterDrag {
  const f = Math.max(0, Math.min(1, grabFrac));
  if (f > 1 / 3 && f < 2 / 3) {
    return { axis, sub: "pan", grabFrac: f, anchorFrac: 0 };
  }
  return { axis, sub: "scale", grabFrac: f, anchorFrac: f < 1 / 3 ? 1 : 0 };
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
  onSelect,
  sync,
}: UseChartViewportArgs): ChartViewportResult {
  // Resolve the sync target: an explicit `sync` arg wins, else inherit the
  // group a standalone adapter opted this subtree into via context. Kept in a
  // ref so the stable `commit`/`reset` callbacks publish to the current group
  // without re-identifying when it changes.
  const contextSync = useContext(ChartViewportSyncContext);
  const syncTarget = sync ?? contextSync ?? null;
  const syncRef = useRef<ChartViewportSyncTarget | null>(syncTarget);
  syncRef.current = syncTarget;
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
  // The live lasso polygon (container-local px) while a lasso drag is in flight.
  const [dragPath, setDragPath] = useState<PixelPoint[] | null>(null);
  // Axis-gutter hover cursor ("ew-resize" over the x-gutter, "ns-resize" over
  // the y-gutter) or null for the mode's default cursor. Only flips when the
  // pointer crosses a gutter boundary, so it costs at most one render per cross.
  const [hoverCursor, setHoverCursor] = useState<
    "ew-resize" | "ns-resize" | null
  >(null);

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
  // Keyboard-tracked modifier (Alt/Ctrl/Meta) — the same mechanism the image
  // viewport uses. WheelEvent.altKey is unreliable during scroll on some
  // platforms, so gate wheel-zoom on this ref rather than e.altKey.
  const modifierDown = useModifierKey();
  const modifierDownRef = useRef(modifierDown);
  modifierDownRef.current = modifierDown;
  const rectRef = useRef<{ width: number; height: number } | null>(null);
  rectRef.current = plotRectRef.current
    ? { width: plotRectRef.current.width, height: plotRectRef.current.height }
    : null;

  const wasDragRef = useRef(false);
  const dragRef = useRef<DragState | null>(null);
  // Latest `onSelect` behind a ref so the pointer handlers stay stable and a
  // renderer can point it at a closure that reads its freshest `toX`/`toY`.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  // Accumulates lasso vertices (container-local px) during a lasso drag. Kept in
  // a ref (not state) so appends are O(1); `dragPath` state mirrors it for paint.
  const lassoPtsRef = useRef<PixelPoint[]>([]);

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

  // Broadcast the just-committed viewport to the sync group (no-op when this
  // chart isn't in one). Only ever called from a LOCAL commit/reset — never
  // from the subscribe handler below — so a remote update is never re-published
  // (the echo guard, mirroring image-viewport-sync.ts). `"home"` is sent for
  // autoscale/reset so peers return to following their own home domain.
  const publishSync = useCallback((d: ChartDomain | "home") => {
    const s = syncRef.current;
    if (!s) return;
    publishChartViewport(
      s.groupId,
      s.sourceId,
      d === "home" ? "home" : { x: d.xDomain, y: d.yDomain },
    );
  }, []);

  const commit = useCallback(
    (d: ChartDomain) => {
      const next = constrain(d);
      onChange?.(next);
      if (!controlled) setInternal(next);
      publishSync(next);
    },
    [constrain, onChange, controlled, publishSync],
  );

  const reset = useCallback(() => {
    onChange?.(home);
    if (!controlled) setInternal(null);
    publishSync("home");
  }, [home, onChange, controlled, publishSync]);

  // ── Live viewport sync: apply a PEER's broadcast ──
  // Adopt a peer's domain WITHOUT re-committing (so it never re-publishes — the
  // echo guard). `"home"` returns to following our own home domain; a concrete
  // domain is applied directly (Plotly matched-axes: data-space, not pixels),
  // each axis falling back to our current range when the peer left it null.
  // Held behind a ref, refreshed each render, so the subscribe effect stays
  // keyed only on the group id and doesn't churn its subscription per render.
  const applyRemoteRef = useRef<(payload: ChartSyncPayload) => void>(() => {});
  applyRemoteRef.current = (payload: ChartSyncPayload) => {
    if (payload === "home") {
      onChange?.(home);
      if (!controlled) setInternal(null);
      return;
    }
    const cur = domainRef.current;
    const next = constrain({
      xDomain: payload.x ?? cur.xDomain,
      yDomain: payload.y ?? cur.yDomain,
    });
    onChange?.(next);
    if (!controlled) setInternal(next);
  };

  useEffect(() => {
    if (!syncTarget) return;
    const { groupId, sourceId } = syncTarget;
    const last = getLastChartViewport(groupId);
    if (last) applyRemoteRef.current(last);
    return subscribeChartViewport(groupId, sourceId, (payload) =>
      applyRemoteRef.current(payload),
    );
    // Re-subscribe only when the group identity changes; peer application reads
    // freshest state through `applyRemoteRef`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncTarget?.groupId, syncTarget?.sourceId]);

  // ── Wheel zoom (non-passive so preventDefault sticks) ──
  // Modifier-gated (Alt/Ctrl/Meta via useModifierKey, matching the image
  // viewport): only modifier+wheel zooms. A plain wheel does nothing and never
  // calls preventDefault, so it bubbles and scrolls the page normally.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!modifierDownRef.current) return; // plain wheel → let the page scroll (no preventDefault)
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

  // ── Pointer down: begin a plot pan/box-zoom, or an axis-gutter pan/scale ──
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      wasDragRef.current = false;
      if (e.button !== 0) return;
      const el = containerRef.current;
      const pr = plotRectRef.current;
      if (!el || !pr) return;
      const box = el.getBoundingClientRect();
      const rect: ClientRect = {
        left: box.left + pr.x,
        top: box.top + pr.y,
        width: pr.width,
        height: pr.height,
      };
      const right = rect.left + rect.width;
      const bottom = rect.top + rect.height;
      const inPlotX = e.clientX >= rect.left && e.clientX <= right;
      const inPlotY = e.clientY >= rect.top && e.clientY <= bottom;

      if (inPlotX && inPlotY) {
        // Inside the plot rect: pan or box-zoom (modifier inverts the mode).
        const modifier = e.altKey || e.ctrlKey || e.metaKey;
        const base = dragModeRef.current;
        const mode: ChartDragMode = modifier
          ? base === "pan"
            ? "box"
            : "pan"
          : base;
        dragRef.current = {
          pointerId: e.pointerId,
          kind: "plot",
          mode,
          startClientX: e.clientX,
          startClientY: e.clientY,
          startDomain: domainRef.current,
          rectClient: rect,
          moved: false,
        };
        return;
      }

      // ── FEATURE B: axis-gutter (margin) drag ──
      // X gutter = below the plot within its x-extent → drives X.
      // Y gutter = left of the plot within its y-extent → drives Y.
      // Middle third of the axis pans; an outer third scales, pinned at the
      // opposite end. The base `constrainTo` gates which gutters are live.
      const constrainAxis = constrainRef.current;
      const gAxis = gutterAxisAt(e.clientX, e.clientY, rect, box, constrainAxis);
      let gutter: GutterDrag | null = null;
      if (gAxis === "x") {
        const grabFrac = (e.clientX - rect.left) / Math.max(1, rect.width);
        gutter = gutterFromFrac("x", grabFrac);
      } else if (gAxis === "y") {
        // Fraction from the BOTTOM (data increases upward).
        const grabFrac = (bottom - e.clientY) / Math.max(1, rect.height);
        gutter = gutterFromFrac("y", grabFrac);
      }
      if (!gutter) return;

      dragRef.current = {
        pointerId: e.pointerId,
        kind: "gutter",
        mode: "pan", // unused for gutter drags
        startClientX: e.clientX,
        startClientY: e.clientY,
        startDomain: domainRef.current,
        rectClient: rect,
        moved: false,
        gutter,
      };
      // Capture immediately so a scale/pan keeps tracking outside the gutter.
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* best-effort */
      }
    },
    [containerRef, plotRectRef],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const s = dragRef.current;
      if (!s) {
        // ── No active drag: axis-gutter cursor affordance ──
        // Reuse the FEATURE B gutter geometry to show a resize cursor while the
        // pointer hovers a gutter ("ew-resize" over x, "ns-resize" over y). The
        // functional setState only re-renders when the value actually changes,
        // so plain hovering across the plot is free.
        const el = containerRef.current;
        const pr = plotRectRef.current;
        if (el && pr) {
          const box = el.getBoundingClientRect();
          const rect: ClientRect = {
            left: box.left + pr.x,
            top: box.top + pr.y,
            width: pr.width,
            height: pr.height,
          };
          const g = gutterAxisAt(
            e.clientX,
            e.clientY,
            rect,
            box,
            constrainRef.current,
          );
          const next = g === "x" ? "ew-resize" : g === "y" ? "ns-resize" : null;
          setHoverCursor((prev) => (prev === next ? prev : next));
        }
        return;
      }
      if (s.pointerId !== e.pointerId) return;
      const dx = e.clientX - s.startClientX;
      const dy = e.clientY - s.startClientY;
      if (!s.moved && (Math.abs(dx) >= DRAG_START_PX || Math.abs(dy) >= DRAG_START_PX)) {
        s.moved = true;
        wasDragRef.current = true;
        if (s.kind === "plot") {
          try {
            (e.currentTarget as HTMLElement).setPointerCapture(s.pointerId);
          } catch {
            /* capture is best-effort (gutter captured at pointer-down) */
          }
        }
      }

      // ── FEATURE B: axis-gutter pan / scale (X-only or Y-only) ──
      if (s.kind === "gutter" && s.gutter) {
        if (!s.moved) return;
        const g = s.gutter;
        const rc = s.rectClient;
        if (g.sub === "pan") {
          commit(
            g.axis === "x"
              ? panByPixels(dx, 0, rc, s.startDomain, "x")
              : panByPixels(0, dy, rc, s.startDomain, "y"),
          );
          return;
        }
        // scale: the grabbed data value tracks the cursor, opposite end pinned.
        if (g.axis === "x") {
          const nowFrac = (e.clientX - rc.left) / Math.max(1, rc.width);
          const nx = axisScale1D(
            s.startDomain.xDomain[0],
            s.startDomain.xDomain[1],
            g.grabFrac,
            nowFrac,
            g.anchorFrac,
          );
          if (nx) commit({ xDomain: nx, yDomain: s.startDomain.yDomain });
        } else {
          const bottom = rc.top + rc.height;
          const nowFrac = (bottom - e.clientY) / Math.max(1, rc.height);
          const ny = axisScale1D(
            s.startDomain.yDomain[0],
            s.startDomain.yDomain[1],
            g.grabFrac,
            nowFrac,
            g.anchorFrac,
          );
          if (ny) commit({ xDomain: s.startDomain.xDomain, yDomain: ny });
        }
        return;
      }

      if (s.mode === "pan") {
        commit(panByPixels(dx, dy, s.rectClient, s.startDomain, constrainRef.current));
        return;
      }

      // ── lasso: accumulate the freeform polygon (container-local px) ──
      // Vertices are distance-thinned to ~2px so a long drag stays bounded; the
      // ref is the source of truth and `dragPath` mirrors it for painting.
      if (s.mode === "lasso") {
        const el = containerRef.current;
        const box = el?.getBoundingClientRect();
        if (!box) return;
        const pts = lassoPtsRef.current;
        if (pts.length === 0) {
          pts.push({ x: s.startClientX - box.left, y: s.startClientY - box.top });
        }
        const px = e.clientX - box.left;
        const py = e.clientY - box.top;
        const last = pts[pts.length - 1];
        if (Math.hypot(px - last.x, py - last.y) >= 2) {
          pts.push({ x: px, y: py });
          setDragPath(pts.slice());
        }
        return;
      }

      // ── box / select: draw the live rectangle (container-local px) once past
      // the threshold. Box-zoom (FEATURE A) snaps a thin drag to a full-width /
      // full-height 1D band; a SELECT marquee always keeps the literal 2D rect
      // the user dragged (no axis snapping — it's the hit-test region). ──
      if (Math.abs(dx) >= BOX_THRESHOLD_PX || Math.abs(dy) >= BOX_THRESHOLD_PX) {
        const el = containerRef.current;
        const box = el?.getBoundingClientRect();
        const plot = plotRectRef.current;
        if (!box || !plot) return;
        const x0 = s.startClientX - box.left;
        const y0 = s.startClientY - box.top;
        const x1 = e.clientX - box.left;
        const y1 = e.clientY - box.top;
        const axis =
          s.mode === "select" ? "both" : boxZoomAxis(constrainRef.current, dx, dy);
        setDragRect(constrainDragRect(x0, y0, x1, y1, plot, axis));
      }
    },
    [commit, containerRef, plotRectRef],
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
      // Gutter drags commit live during the move — nothing to finalize here.
      if (s.kind === "gutter") {
        dragRef.current = null;
        return;
      }

      // ── select: emit the literal marquee rect (container-local px) ──
      // A drag that never cleared the box threshold is treated as a click (no
      // emit); the renderer's empty-click path clears any prior selection.
      if (s.mode === "select") {
        const el = containerRef.current;
        const box = el?.getBoundingClientRect();
        if (s.moved && box && onSelectRef.current) {
          const width = Math.abs(e.clientX - s.startClientX);
          const height = Math.abs(e.clientY - s.startClientY);
          if (width >= BOX_THRESHOLD_PX || height >= BOX_THRESHOLD_PX) {
            onSelectRef.current({
              kind: "rect",
              rect: {
                x: Math.min(s.startClientX, e.clientX) - box.left,
                y: Math.min(s.startClientY, e.clientY) - box.top,
                width,
                height,
              },
            });
          }
        }
        setDragRect(null);
        dragRef.current = null;
        return;
      }

      // ── lasso: emit the freeform polygon (needs ≥3 vertices to bound area) ──
      if (s.mode === "lasso") {
        const pts = lassoPtsRef.current;
        if (s.moved && pts.length >= 3 && onSelectRef.current) {
          onSelectRef.current({ kind: "lasso", points: pts.slice() });
        }
        lassoPtsRef.current = [];
        setDragPath(null);
        dragRef.current = null;
        return;
      }

      // ── box-zoom: commit the drawn rectangle as the new domain ──
      if (s.mode === "box") {
        const dx = Math.abs(e.clientX - s.startClientX);
        const dy = Math.abs(e.clientY - s.startClientY);
        // FEATURE A: a thin drag snaps to a 1D zoom on the thick axis; only the
        // axis/axes actually zoomed must clear the box threshold.
        const axis = boxZoomAxis(constrainRef.current, dx, dy);
        const okX = axis === "y" || dx >= BOX_THRESHOLD_PX;
        const okY = axis === "x" || dy >= BOX_THRESHOLD_PX;
        if (okX && okY) {
          const next = boxToDomain(
            s.startClientX,
            s.startClientY,
            e.clientX,
            e.clientY,
            s.rectClient,
            s.startDomain,
            axis,
          );
          if (next) commit(next);
        }
      }
      // box (finalized above) and pan (committed live) both land here.
      setDragRect(null);
      dragRef.current = null;
    },
    [commit, containerRef],
  );

  // Reset the axis-gutter hover cursor when the pointer leaves the container (no
  // more pointermove fires to clear it). Skipped mid-drag so a gutter drag that
  // strays outside keeps its resize cursor.
  const onPointerLeave = useCallback(() => {
    if (!dragRef.current) setHoverCursor((prev) => (prev === null ? prev : null));
  }, []);

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

  // An axis-gutter hover cursor overrides the mode's base cursor ("grab" for
  // pan, "crosshair" for box/select/lasso) so hovering a gutter previews its
  // 1D resize affordance.
  const baseCursor = dragMode2 === "pan" ? "grab" : "crosshair";
  const cursor = hoverCursor ?? baseCursor;
  const containerProps = {
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onPointerLeave,
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
    dragPath,
    isModified,
    wasDragRef,
    actions,
    capabilities: CHART_CAPABILITIES,
  };
}
