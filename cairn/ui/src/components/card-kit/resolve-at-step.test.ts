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
});

test("resolveAtStep falls back to the smallest point above the step", () => {
  // Before the fix this returned null and the caller dropped the pane.
  assert.equal(resolveAtStep(points, 0)?.tag, "a");
  assert.equal(resolveAtStep(points, 9)?.tag, "a");
});

test("resolveAtStep clamps above the last point", () => {
  assert.equal(resolveAtStep(points, 31)?.tag, "c");
  assert.equal(resolveAtStep(points, 1e9)?.tag, "c");
});

test("resolveAtStep returns null only for a run with no points", () => {
  assert.equal(resolveAtStep([] as P[], 0), null);
  assert.equal(resolveAtStep([] as P[], 100), null);
});

test("resolveAtStep handles a single point on both sides", () => {
  const one: P[] = [{ step: 42, tag: "only" }];
  assert.equal(resolveAtStep(one, 0)?.tag, "only");
  assert.equal(resolveAtStep(one, 42)?.tag, "only");
  assert.equal(resolveAtStep(one, 99)?.tag, "only");
});
