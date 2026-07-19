/**
 * Pure unit tests for the unified chart viewport math. No test runner is
 * configured in this package, so this runs under Node's built-in test runner
 * with TypeScript type-stripping:
 *
 *   node --experimental-strip-types --test \
 *     src/lib/cairn-plot/viewport/chart-viewport-math.test.ts
 *
 * These functions are DOM-free pure math, so this is sufficient coverage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyConstraints,
  axisScale1D,
  boxToDomain,
  boxZoomAxis,
  constrainDragRect,
  panByPixels,
  pointInPolygon,
  pointInRect,
  wheelZoom,
  zoomAboutAnchor,
  fracToValue,
  THIN_BAND_PX,
  WHEEL_FACTOR,
  type ChartDomain,
  type ClientRect,
  type PixelPoint,
} from "./chart-viewport-math.ts";

const D = (x0: number, x1: number, y0: number, y1: number): ChartDomain => ({
  xDomain: [x0, x1],
  yDomain: [y0, y1],
});
const rect: ClientRect = { left: 100, top: 50, width: 200, height: 100 };
const approx = (a: number, b: number, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} !~= ${b}`);

test("fracToValue maps 0/0.5/1 across [lo,hi]", () => {
  assert.equal(fracToValue(0, 10, 20), 10);
  assert.equal(fracToValue(0.5, 10, 20), 15);
  assert.equal(fracToValue(1, 10, 20), 20);
});

test("zoomAboutAnchor zooms in about the center symmetrically", () => {
  const out = zoomAboutAnchor(D(0, 10, 0, 10), 5, 5, 1 / WHEEL_FACTOR);
  // span shrinks by factor 1/1.1 about the midpoint.
  approx(out.xDomain[1] - out.xDomain[0], 10 / WHEEL_FACTOR);
  approx((out.xDomain[0] + out.xDomain[1]) / 2, 5);
  approx((out.yDomain[0] + out.yDomain[1]) / 2, 5);
});

test("zoomAboutAnchor keeps the anchor fixed", () => {
  const out = zoomAboutAnchor(D(0, 10, 0, 10), 2, 8, WHEEL_FACTOR);
  // anchor's fraction of the span is unchanged.
  approx((2 - out.xDomain[0]) / (out.xDomain[1] - out.xDomain[0]), 0.2);
  approx((8 - out.yDomain[0]) / (out.yDomain[1] - out.yDomain[0]), 0.8);
});

test("zoomAboutAnchor with constrainTo:'x' leaves y untouched", () => {
  const out = zoomAboutAnchor(D(0, 10, 0, 10), 5, 5, 1 / WHEEL_FACTOR, "x");
  assert.deepEqual(out.yDomain, [0, 10]);
  assert.ok(out.xDomain[1] - out.xDomain[0] < 10);
});

test("wheelZoom outside the rect returns null", () => {
  assert.equal(wheelZoom(10, 10, rect, D(0, 10, 0, 10), -1), null);
});

test("wheelZoom in center zooms in (deltaY<0) about center", () => {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const out = wheelZoom(cx, cy, rect, D(0, 10, 0, 10), -1)!;
  assert.ok(out.xDomain[1] - out.xDomain[0] < 10);
  approx((out.xDomain[0] + out.xDomain[1]) / 2, 5);
});

test("boxToDomain maps a rectangle to its domain span (y flipped)", () => {
  // Drag the left-bottom quarter of the rect.
  const out = boxToDomain(
    rect.left,
    rect.top + rect.height, // bottom
    rect.left + rect.width / 2,
    rect.top + rect.height / 2, // middle
    rect,
    D(0, 10, 0, 10),
  )!;
  approx(out.xDomain[0], 0);
  approx(out.xDomain[1], 5);
  // bottom half of the screen → lower half of y-values.
  approx(out.yDomain[0], 0);
  approx(out.yDomain[1], 5);
});

test("boxToDomain returns null for a degenerate box", () => {
  assert.equal(
    boxToDomain(rect.left, rect.top, rect.left, rect.top, rect, D(0, 10, 0, 10)),
    null,
  );
});

test("panByPixels shifts the domain (y sign inverted vs screen)", () => {
  // Drag right by half the plot width → domain shifts left by half its span.
  const out = panByPixels(rect.width / 2, 0, rect, D(0, 10, 0, 10));
  approx(out.xDomain[0], -5);
  approx(out.xDomain[1], 5);
  // Drag down by half the height → domain shifts UP by half its span.
  const out2 = panByPixels(0, rect.height / 2, rect, D(0, 10, 0, 10));
  approx(out2.yDomain[0], 5);
  approx(out2.yDomain[1], 15);
});

test("applyConstraints enforces the minSpan floor about the center", () => {
  const out = applyConstraints(D(4, 6, 0, 10), { minSpan: { x: 5 } });
  approx(out.xDomain[1] - out.xDomain[0], 5);
  approx((out.xDomain[0] + out.xDomain[1]) / 2, 5);
});

test("applyConstraints clamps a domain back inside its bounds", () => {
  const out = applyConstraints(D(8, 14, 0, 10), {
    clamp: { xDomain: [0, 10] },
  });
  // span 6 fits in [0,10]; shifted back so hi=10.
  approx(out.xDomain[0], 4);
  approx(out.xDomain[1], 10);
});

test("applyConstraints clamps an over-wide span to full bounds", () => {
  const out = applyConstraints(D(-5, 20, 0, 10), {
    clamp: { xDomain: [0, 10] },
  });
  assert.deepEqual(out.xDomain, [0, 10]);
});

// ── FEATURE A: constrained 1D box-zoom ──

test("boxZoomAxis snaps a thin-x / thick-y drag to Y-only", () => {
  // width below THIN, height at/above it → zoom Y only.
  assert.equal(boxZoomAxis("both", THIN_BAND_PX - 1, THIN_BAND_PX + 5), "y");
});

test("boxZoomAxis snaps a thick-x / thin-y drag to X-only", () => {
  assert.equal(boxZoomAxis("both", THIN_BAND_PX + 5, THIN_BAND_PX - 1), "x");
});

test("boxZoomAxis keeps a genuine 2D drag as both", () => {
  assert.equal(boxZoomAxis("both", 40, 40), "both");
  // Both extents thin (ambiguous tiny drag) also stays 'both'.
  assert.equal(boxZoomAxis("both", 4, 4), "both");
});

test("boxZoomAxis ignores drag shape for an already-1D chart", () => {
  // A BarChart (base 'x') never snaps to 'y' no matter how thin in x.
  assert.equal(boxZoomAxis("x", 1, 100), "x");
  assert.equal(boxZoomAxis("y", 100, 1), "y");
});

test("boxZoomAxis uses magnitudes (sign-agnostic)", () => {
  assert.equal(boxZoomAxis("both", -2, -40), "y");
  assert.equal(boxZoomAxis("both", -40, -2), "x");
});

const plot = { x: 100, y: 50, width: 200, height: 100 };

test("constrainDragRect: Y-only snaps to a full-width horizontal band", () => {
  const out = constrainDragRect(150, 70, 156, 130, plot, "y");
  assert.deepEqual(out, { x: 100, y: 70, width: 200, height: 60 });
});

test("constrainDragRect: X-only snaps to a full-height vertical band", () => {
  const out = constrainDragRect(150, 70, 220, 76, plot, "x");
  assert.deepEqual(out, { x: 150, y: 50, width: 70, height: 100 });
});

test("constrainDragRect: both keeps the literal (normalized) rectangle", () => {
  const out = constrainDragRect(220, 130, 150, 70, plot, "both");
  assert.deepEqual(out, { x: 150, y: 70, width: 70, height: 60 });
});

// ── FEATURE B: axis-element (gutter) scale ──

test("axisScale1D is the identity when the cursor hasn't moved", () => {
  // grabFrac === nowFrac → span unchanged, anchor end fixed.
  const out = axisScale1D(0, 10, 0.8, 0.8, 0)!;
  approx(out[0], 0);
  approx(out[1], 10);
});

test("axisScale1D pins the low end and zooms in as the cursor moves outward", () => {
  // Right-third grab (high end), low end pinned at frac 0. Cursor moves from
  // 0.8 → 0.9 (outward) → span shrinks, lo stays 0.
  const out = axisScale1D(0, 10, 0.8, 0.9, 0)!;
  approx(out[0], 0);
  // grabbed value = 8; must sit at frac 0.9 now → span = 8/0.9.
  approx(out[1], 8 / 0.9);
  assert.ok(out[1] - out[0] < 10, "span shrank (zoom in)");
});

test("axisScale1D pins the high end for a left-third grab", () => {
  // Left-third grab (low end at frac 0.2), high end pinned (anchorFrac 1).
  const out = axisScale1D(0, 10, 0.2, 0.1, 1)!;
  approx(out[1], 10); // high end fixed
  // grabbed value = 2; sits at frac 0.1 now: 10 + (0.1-1)*span = 2 → span = 8/0.9.
  approx(out[1] - out[0], 8 / 0.9);
});

test("axisScale1D returns null at/over the pinned end (degenerate)", () => {
  assert.equal(axisScale1D(0, 10, 0.8, 0, 0), null); // cursor on the anchor
  assert.equal(axisScale1D(0, 10, 0.8, -0.1, 0), null); // past the anchor → inverted
});

// ── Selection hit-testing: point-in-rect ──

test("pointInRect: interior, edges (inclusive) and exterior", () => {
  const r = { x: 10, y: 20, width: 100, height: 50 }; // covers x∈[10,110], y∈[20,70]
  assert.equal(pointInRect(60, 45, r), true); // interior
  assert.equal(pointInRect(10, 20, r), true); // top-left corner (inclusive)
  assert.equal(pointInRect(110, 70, r), true); // bottom-right corner (inclusive)
  assert.equal(pointInRect(9, 45, r), false); // left of
  assert.equal(pointInRect(111, 45, r), false); // right of
  assert.equal(pointInRect(60, 19, r), false); // above
  assert.equal(pointInRect(60, 71, r), false); // below
});

// ── Selection hit-testing: point-in-polygon (even-odd ray cast) ──

const square: PixelPoint[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

test("pointInPolygon: convex square membership", () => {
  assert.equal(pointInPolygon(5, 5, square), true); // centre
  assert.equal(pointInPolygon(-1, 5, square), false); // left
  assert.equal(pointInPolygon(15, 5, square), false); // right
  assert.equal(pointInPolygon(5, -1, square), false); // above
  assert.equal(pointInPolygon(5, 15, square), false); // below
});

test("pointInPolygon: implicitly-closed ring (last→first edge counts)", () => {
  // A triangle given without repeating the first vertex still hit-tests as a
  // closed region.
  const tri: PixelPoint[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 5, y: 10 },
  ];
  assert.equal(pointInPolygon(5, 3, tri), true);
  assert.equal(pointInPolygon(1, 8, tri), false); // outside a slanted edge
});

test("pointInPolygon: concave L-shape excludes the notch", () => {
  // L-shape (concave): the top-right quadrant is carved out.
  const L: PixelPoint[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 4 },
    { x: 4, y: 4 },
    { x: 4, y: 10 },
    { x: 0, y: 10 },
  ];
  assert.equal(pointInPolygon(2, 8, L), true); // lower-left arm
  assert.equal(pointInPolygon(8, 2, L), true); // upper-right arm
  assert.equal(pointInPolygon(8, 8, L), false); // the carved-out notch
});

test("pointInPolygon: degenerate ring (< 3 vertices) is always false", () => {
  assert.equal(pointInPolygon(0, 0, []), false);
  assert.equal(pointInPolygon(0, 0, [{ x: 0, y: 0 }]), false);
  assert.equal(
    pointInPolygon(0, 0, [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]),
    false,
  );
});
