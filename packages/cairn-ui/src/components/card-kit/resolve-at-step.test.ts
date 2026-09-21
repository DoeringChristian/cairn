import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAtStep } from "./resolve-at-step.ts";

interface P { step: number; tag: string }

const points: P[] = [
  { step: 10, tag: "a" },
  { step: 20, tag: "b" },
  { step: 30, tag: "c" },
];

test("resolveAtStep returns the largest point at or below the step", () => {
  assert.equal(resolveAtStep(points, 10)?.tag, "a");
  assert.equal(resolveAtStep(points, 25)?.tag, "b");
  assert.equal(resolveAtStep(points, 30)?.tag, "c");
  assert.equal(resolveAtStep(points, 25, { nearest: true })?.tag, "b");
});

test("the default mode still returns null below the first point", () => {
  // VideoPlayerCard / FigureInteractiveCard render their own "nothing logged
  // yet" state from this null; only the image/compare card opts into nearest.
  assert.equal(resolveAtStep(points, 0), null);
  assert.equal(resolveAtStep(points, 9), null);
  assert.equal(resolveAtStep(points, 9, { nearest: false }), null);
});

test("nearest falls back to the smallest point above the step", () => {
  // Without this the compare card dropped the pane out of the grid entirely.
  assert.equal(resolveAtStep(points, 0, { nearest: true })?.tag, "a");
  assert.equal(resolveAtStep(points, 9, { nearest: true })?.tag, "a");
});

test("resolveAtStep clamps above the last point in both modes", () => {
  assert.equal(resolveAtStep(points, 31)?.tag, "c");
  assert.equal(resolveAtStep(points, 1e9)?.tag, "c");
  assert.equal(resolveAtStep(points, 1e9, { nearest: true })?.tag, "c");
});

test("an empty run is null in both modes", () => {
  assert.equal(resolveAtStep([] as P[], 0), null);
  assert.equal(resolveAtStep([] as P[], 100), null);
  assert.equal(resolveAtStep([] as P[], 0, { nearest: true }), null);
  assert.equal(resolveAtStep([] as P[], 100, { nearest: true }), null);
});

test("a single point resolves on both sides under nearest", () => {
  const one: P[] = [{ step: 42, tag: "only" }];
  assert.equal(resolveAtStep(one, 0, { nearest: true })?.tag, "only");
  assert.equal(resolveAtStep(one, 42, { nearest: true })?.tag, "only");
  assert.equal(resolveAtStep(one, 99, { nearest: true })?.tag, "only");
  assert.equal(resolveAtStep(one, 0), null);
  assert.equal(resolveAtStep(one, 42)?.tag, "only");
});
