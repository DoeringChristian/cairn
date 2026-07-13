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
  boxToDomain,
  panByPixels,
  wheelZoom,
  zoomAboutAnchor,
  fracToValue,
  WHEEL_FACTOR,
  type ChartDomain,
  type ClientRect,
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
