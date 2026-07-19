/**
 * Pure domain math for the unified Plotly-style chart viewport.
 *
 * These are the SAME gestures/constants as ScalarPlot's Recharts state machine
 * (`renderers/scalar/use-plot-gestures.ts`) — a 6px box-zoom threshold, a 1.1
 * wheel factor, cursor-anchored wheel zoom, pixel-delta pan and box→domain
 * mapping — lifted into DOM-free functions so every 2D chart renderer shares
 * one implementation (and it can be unit-tested without a browser).
 *
 * COORDINATE SPACES
 * -----------------
 * A `ChartDomain` is expressed in MAPPED axis space: post-log10 where an axis
 * is logarithmic. Renderers keep their `logSafe`/`pow10` conversions at the
 * label/mark boundary; these functions never see raw (pre-log) values.
 *
 * Client-space helpers (`boxToDomain`, `wheelZoom`) take a `ClientRect` — the
 * plot rectangle in *client* coordinates (viewport pixels, as from
 * `getBoundingClientRect()` plus the plot inset). The hook is responsible for
 * turning its container-local `plotRectRef` into client space before calling.
 */

/** Wheel zoom factor per notch — identical to use-plot-gestures.ts:116. */
export const WHEEL_FACTOR = 1.1;
/** Minimum drag (px) before a box-zoom rectangle is drawn/committed. */
export const BOX_THRESHOLD_PX = 6;
/** Minimum drag (px) before a gesture counts as a drag (vs. a click). */
export const DRAG_START_PX = 3;
/**
 * Box-zoom "thinness" floor (px). When a drag's extent is below this on ONE
 * axis (and at/above it on the other) the box snaps to a single-axis (1D) zoom
 * on the thick axis — Plotly's constrained box-zoom. The Scalar chart mirrors
 * this exact threshold in `renderers/scalar/use-plot-gestures.ts`.
 */
export const THIN_BAND_PX = 12;

export interface ChartDomain {
  xDomain: [number, number];
  yDomain: [number, number];
}

/** Which axes a gesture may touch. `'x'` no-ops the y axis (BarChart value
 *  axis only); `'y'` no-ops the x axis. */
export type ConstrainAxis = "both" | "x" | "y";

/** A rectangle in client (viewport) pixels. */
export interface ClientRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Optional hard bounds a domain may never exceed (e.g. a heatmap's [0,cols]). */
export interface DomainClamp {
  xDomain?: [number, number];
  yDomain?: [number, number];
}

/** Optional minimum span per axis (a max-zoom floor). */
export interface MinSpan {
  x?: number;
  y?: number;
}

const isPair = (p: [number, number]) =>
  Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[1] > p[0];

/** Map a fraction (0..1 across an axis) to a value in [lo, hi]. */
export function fracToValue(frac: number, lo: number, hi: number): number {
  return lo + frac * (hi - lo);
}

/**
 * Cursor-anchored zoom in mapped domain space. `anchorX`/`anchorY` are the
 * DATA values under the cursor (computed once by the caller from cursor
 * fractions through the current domain). `factor < 1` zooms in, `> 1` zooms
 * out — mirroring use-plot-gestures.ts:116-127.
 */
export function zoomAboutAnchor(
  domain: ChartDomain,
  anchorX: number,
  anchorY: number,
  factor: number,
  constrainTo: ConstrainAxis = "both",
): ChartDomain {
  const [x0, x1] = domain.xDomain;
  const [y0, y1] = domain.yDomain;
  const nx: [number, number] =
    constrainTo === "y"
      ? [x0, x1]
      : [anchorX - (anchorX - x0) * factor, anchorX + (x1 - anchorX) * factor];
  const ny: [number, number] =
    constrainTo === "x"
      ? [y0, y1]
      : [anchorY - (anchorY - y0) * factor, anchorY + (y1 - anchorY) * factor];
  return { xDomain: nx, yDomain: ny };
}

/**
 * Wheel-zoom about a client cursor position inside a client-space plot rect.
 * Returns the scaled domain, or `null` if the cursor is outside the rect (the
 * caller should then let the page scroll). Mirrors use-plot-gestures.ts:105-127.
 */
export function wheelZoom(
  clientX: number,
  clientY: number,
  rect: ClientRect,
  domain: ChartDomain,
  deltaY: number,
  constrainTo: ConstrainAxis = "both",
): ChartDomain | null {
  const left = rect.left;
  const right = rect.left + rect.width;
  const top = rect.top;
  const bottom = rect.top + rect.height;
  if (clientX < left || clientX > right || clientY < top || clientY > bottom) {
    return null;
  }
  const factor = deltaY < 0 ? 1 / WHEEL_FACTOR : WHEEL_FACTOR;
  const fx = (clientX - left) / Math.max(1, right - left);
  const fy = (bottom - clientY) / Math.max(1, bottom - top);
  const ax = fracToValue(fx, domain.xDomain[0], domain.xDomain[1]);
  const ay = fracToValue(fy, domain.yDomain[0], domain.yDomain[1]);
  return zoomAboutAnchor(domain, ax, ay, factor, constrainTo);
}

/**
 * Map a drag rectangle (two client corners) to a new domain. `y` is flipped so
 * the bottom of the rect is the low y-value (chart convention). Returns `null`
 * for a degenerate/inverted result. Mirrors use-plot-gestures.ts:287-308.
 */
export function boxToDomain(
  x0c: number,
  y0c: number,
  x1c: number,
  y1c: number,
  rect: ClientRect,
  domain: ChartDomain,
  constrainTo: ConstrainAxis = "both",
): ChartDomain | null {
  const w = Math.max(1, rect.width);
  const hgt = Math.max(1, rect.height);
  const loX = Math.min(x0c, x1c);
  const hiX = Math.max(x0c, x1c);
  const loY = Math.min(y0c, y1c);
  const hiY = Math.max(y0c, y1c);
  const bottom = rect.top + rect.height;
  const fxLo = (loX - rect.left) / w;
  const fxHi = (hiX - rect.left) / w;
  const fyLo = (bottom - hiY) / hgt; // lower on screen → smaller y-value
  const fyHi = (bottom - loY) / hgt;
  const [xa, xb] = domain.xDomain;
  const [ya, yb] = domain.yDomain;
  const nx: [number, number] =
    constrainTo === "y"
      ? [xa, xb]
      : [fracToValue(fxLo, xa, xb), fracToValue(fxHi, xa, xb)];
  const ny: [number, number] =
    constrainTo === "x"
      ? [ya, yb]
      : [fracToValue(fyLo, ya, yb), fracToValue(fyHi, ya, yb)];
  if (!isPair(nx) || !isPair(ny)) return null;
  return { xDomain: nx, yDomain: ny };
}

/** A rectangle in a renderer's CONTAINER-LOCAL px space (origin = container
 *  top-left) — the same shape the viewport hook draws as its `dragRect`. */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A point in a renderer's CONTAINER-LOCAL px space (a lasso vertex, or a
 *  data point already mapped through the renderer's `toX`/`toY`). */
export interface PixelPoint {
  x: number;
  y: number;
}

/**
 * Decide which axis (or both) a box-zoom should touch, given the chart's base
 * axis constraint and the drag's pixel extents. A `'both'`-constrained chart
 * SNAPS to a single axis when the drag is thin (< `thin` px) in the OTHER axis
 * — Plotly's constrained box-zoom:
 *
 *   thin in x, thick in y → `'y'` (zoom Y only, X domain untouched)
 *   thin in y, thick in x → `'x'` (zoom X only, Y domain untouched)
 *   otherwise             → `'both'` (a genuine 2D box)
 *
 * An already-1D chart (`base` = `'x'`/`'y'`) is returned unchanged — its
 * gesture never spans the constrained axis regardless of the drag shape.
 * `dxPx`/`dyPx` may be signed; only magnitudes matter.
 */
export function boxZoomAxis(
  base: ConstrainAxis,
  dxPx: number,
  dyPx: number,
  thin: number = THIN_BAND_PX,
): ConstrainAxis {
  if (base !== "both") return base;
  const adx = Math.abs(dxPx);
  const ady = Math.abs(dyPx);
  if (adx < thin && ady >= thin) return "y";
  if (ady < thin && adx >= thin) return "x";
  return "both";
}

/**
 * Snap a raw drag rectangle (two container-local corners) to the band the
 * effective box `axis` implies: a FULL-WIDTH horizontal band for a Y-only
 * zoom, a FULL-HEIGHT vertical band for an X-only zoom, or the literal 2D
 * rectangle for `'both'`. `plot` is the plot rect in the SAME container-local
 * px space as the corners. The hook hands this straight to `dragRect` so
 * renderers draw the already-constrained band with zero extra logic.
 */
export function constrainDragRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  plot: PixelRect,
  axis: ConstrainAxis,
): PixelRect {
  const loX = Math.min(x0, x1);
  const loY = Math.min(y0, y1);
  const w = Math.abs(x1 - x0);
  const h = Math.abs(y1 - y0);
  if (axis === "y") return { x: plot.x, y: loY, width: plot.width, height: h };
  if (axis === "x") return { x: loX, y: plot.y, width: w, height: plot.height };
  return { x: loX, y: loY, width: w, height: h };
}

/**
 * Follow-cursor 1D axis scale for an axis-gutter drag. The data value grabbed
 * at pointer-down (`grabFrac` = its fraction 0..1 along the axis through the
 * START domain) tracks the cursor (`nowFrac` = the cursor's fraction now) while
 * the OPPOSITE end stays pinned (`anchorFrac`: 0 = low end fixed, 1 = high end
 * fixed). Returns the new `[lo, hi]`, or `null` when the result is degenerate
 * (cursor at/over the anchor, or a non-positive/inverted span) so the caller
 * can simply skip the update.
 */
export function axisScale1D(
  startLo: number,
  startHi: number,
  grabFrac: number,
  nowFrac: number,
  anchorFrac: 0 | 1,
): [number, number] | null {
  const grabbed = startLo + grabFrac * (startHi - startLo);
  const anchorValue = anchorFrac === 0 ? startLo : startHi;
  const denom = nowFrac - anchorFrac;
  if (Math.abs(denom) < 1e-4) return null; // cursor reached the pinned end
  const span = (grabbed - anchorValue) / denom;
  if (!(span > 0) || !Number.isFinite(span)) return null;
  const lo = anchorValue - anchorFrac * span;
  const hi = lo + span;
  if (!(hi > lo)) return null;
  return [lo, hi];
}

/**
 * Translate a domain by a pixel delta over a plot rect. `startDomain` is the
 * domain captured at pointer-down. Mirrors use-plot-gestures.ts:238-250 (note
 * the y sign: dragging down moves the view up in data space).
 */
export function panByPixels(
  dxPx: number,
  dyPx: number,
  rect: { width: number; height: number },
  startDomain: ChartDomain,
  constrainTo: ConstrainAxis = "both",
): ChartDomain {
  const [x0, x1] = startDomain.xDomain;
  const [y0, y1] = startDomain.yDomain;
  const dxData = (dxPx / Math.max(1, rect.width)) * (x1 - x0);
  const dyData = (dyPx / Math.max(1, rect.height)) * (y1 - y0);
  const nx: [number, number] =
    constrainTo === "y" ? [x0, x1] : [x0 - dxData, x1 - dxData];
  const ny: [number, number] =
    constrainTo === "x" ? [y0, y1] : [y0 + dyData, y1 + dyData];
  return { xDomain: nx, yDomain: ny };
}

function clampAxis(
  lo: number,
  hi: number,
  bound: [number, number],
): [number, number] {
  const [b0, b1] = bound;
  const span = hi - lo;
  const bspan = b1 - b0;
  if (span >= bspan) return [b0, b1];
  if (lo < b0) return [b0, b0 + span];
  if (hi > b1) return [b1 - span, b1];
  return [lo, hi];
}

function enforceMinSpan(
  lo: number,
  hi: number,
  min: number | undefined,
): [number, number] {
  if (min == null || hi - lo >= min) return [lo, hi];
  const c = (lo + hi) / 2;
  return [c - min / 2, c + min / 2];
}

/**
 * Square-cell aspect lock: expand whichever axis has the smaller
 * data-units-per-pixel so both axes share the larger ratio (about each center).
 * Opt-in (Heatmap); a no-op when the rect is unusable.
 */
export function applyLockAspect(
  domain: ChartDomain,
  rect: { width: number; height: number },
): ChartDomain {
  if (rect.width <= 0 || rect.height <= 0) return domain;
  const [x0, x1] = domain.xDomain;
  const [y0, y1] = domain.yDomain;
  const uppX = (x1 - x0) / rect.width;
  const uppY = (y1 - y0) / rect.height;
  const upp = Math.max(uppX, uppY);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const nsx = upp * rect.width;
  const nsy = upp * rect.height;
  return {
    xDomain: [cx - nsx / 2, cx + nsx / 2],
    yDomain: [cy - nsy / 2, cy + nsy / 2],
  };
}

/**
 * Apply (in order) min-span floor, optional aspect lock, then hard clamp. Run
 * after every gesture so a viewport can never invert, over-zoom past the floor,
 * or (when clamped) escape its data bounds.
 */
export function applyConstraints(
  domain: ChartDomain,
  opts: {
    clamp?: DomainClamp;
    minSpan?: MinSpan;
    lockAspect?: boolean;
    rect?: { width: number; height: number } | null;
  } = {},
): ChartDomain {
  let [x0, x1] = domain.xDomain;
  let [y0, y1] = domain.yDomain;
  [x0, x1] = enforceMinSpan(x0, x1, opts.minSpan?.x);
  [y0, y1] = enforceMinSpan(y0, y1, opts.minSpan?.y);
  let out: ChartDomain = { xDomain: [x0, x1], yDomain: [y0, y1] };
  if (opts.lockAspect && opts.rect) out = applyLockAspect(out, opts.rect);
  if (opts.clamp?.xDomain) {
    out.xDomain = clampAxis(out.xDomain[0], out.xDomain[1], opts.clamp.xDomain);
  }
  if (opts.clamp?.yDomain) {
    out.yDomain = clampAxis(out.yDomain[0], out.yDomain[1], opts.clamp.yDomain);
  }
  return out;
}

/** Structural equality — used to decide whether a view is "modified" vs home. */
export function domainsEqual(a: ChartDomain, b: ChartDomain): boolean {
  return (
    a.xDomain[0] === b.xDomain[0] &&
    a.xDomain[1] === b.xDomain[1] &&
    a.yDomain[0] === b.yDomain[0] &&
    a.yDomain[1] === b.yDomain[1]
  );
}

// ── Selection hit-testing (box-select / lasso) ──
// Both operate in a renderer's CONTAINER-LOCAL px space: the viewport hook emits
// the marquee rect / lasso polygon in that space, and a renderer maps each data
// point through its `toX`/`toY` (same space) before testing membership.

/** True when pixel point (`px`,`py`) lies within `rect` (edges inclusive). */
export function pointInRect(px: number, py: number, rect: PixelRect): boolean {
  return (
    px >= rect.x &&
    px <= rect.x + rect.width &&
    py >= rect.y &&
    py <= rect.y + rect.height
  );
}

/**
 * Even-odd ray-cast point-in-polygon. `poly` is an ordered ring of vertices
 * treated as implicitly closed (the last vertex joins back to the first).
 * Returns `false` for a degenerate ring (< 3 vertices). Points exactly on an
 * edge are not guaranteed either way (inherent to ray-casting) — fine for
 * marquee/lasso hit-testing where sub-pixel edge cases don't matter.
 */
export function pointInPolygon(
  px: number,
  py: number,
  poly: readonly PixelPoint[],
): boolean {
  const n = poly.length;
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    // Does a rightward ray from (px,py) cross the edge (j → i)?
    const crosses =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}
