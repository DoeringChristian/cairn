import { test } from "node:test";
import assert from "node:assert/strict";
import { forgetDepartedCells, nextSeedBatch } from "./seed-cell-settings.ts";

test("every cell of a fresh session needs seeding", () => {
  const ids = ["cell:root/runA:m:c", "cell:root/runB:m:c", "stack:root"];
  assert.deepEqual(nextSeedBatch(ids, new Set()), ids);
});

test("a cell is seeded once and never again", () => {
  const seeded = new Set(["cell:root/runA:m:c", "stack:root"]);
  assert.deepEqual(nextSeedBatch(["cell:root/runA:m:c", "stack:root"], seeded), []);
});

test("a pane that appears later is seeded on its own notification", () => {
  // The regression: a boolean "already applied" guard consumed on the first
  // notification left every later pane on the plot's defaults.
  const seeded = new Set(["cell:root/runA:m:c", "stack:root"]);
  assert.deepEqual(
    nextSeedBatch(["cell:root/runA:m:c", "stack:root", "cell:root/runB:m:c"], seeded),
    ["cell:root/runB:m:c"],
  );
});

test("a first session with no cells at all seeds nothing and consumes nothing", () => {
  const seeded = new Set<string>();
  assert.deepEqual(nextSeedBatch([], seeded), []);
  // Nothing was consumed, so the cells of the next spec still get seeded.
  assert.deepEqual(nextSeedBatch(["cell:root/runA:m:c"], seeded), ["cell:root/runA:m:c"]);
});

test("departed cells are forgotten so a returning pane is re-seeded", () => {
  const seeded = new Set(["cell:root/runA:m:c", "cell:root/runB:m:c", "stack:root"]);
  forgetDepartedCells(seeded, ["cell:root/runA:m:c", "stack:root"]);
  assert.deepEqual([...seeded].sort(), ["cell:root/runA:m:c", "stack:root"]);
  // runB comes back after the prune: its cell re-registered with defaults.
  assert.deepEqual(
    nextSeedBatch(["cell:root/runA:m:c", "stack:root", "cell:root/runB:m:c"], seeded),
    ["cell:root/runB:m:c"],
  );
});

test("forgetDepartedCells keeps the set when nothing left", () => {
  const seeded = new Set(["a", "b"]);
  assert.equal(forgetDepartedCells(seeded, ["a", "b", "c"]), seeded);
  assert.deepEqual([...seeded].sort(), ["a", "b"]);
});
