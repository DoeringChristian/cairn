import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPlotSpec, paneIds, type BuildPlotSpecInput } from "./build-plot-spec.ts";
import type { SequencePoint } from "../../api/types";
// The `@cairn-plot` tsconfig alias is a bundler/TS concern; the node test runner
// resolves the vendored source directly.
import { compileSessionTopology } from "../../../../../vendor/cairn-plot/ui/src/state/session/session-topology.ts";

/**
 * The card must never author cairn-plot session ids.
 *
 * cairn-plot derives them from node identity (`cell:root/<child id>`, and one
 * level deeper for an expanded image comparison) and prunes anything else on
 * `setTopology`. A hand-rolled, index-derived session — which this card used to
 * build — therefore silently lost every saved pane setting on restore, and the
 * first `onSessionChange` then wrote the cells' defaults back over them.
 * Persisted settings now go in through `plot.patchSettings`, which fans out over
 * this same compiled topology.
 */

function point(step: number, hash: string): SequencePoint {
  return {
    step,
    wall_time: "2026-09-09T00:00:00Z",
    scalar_value: null,
    artifact_hash: hash,
    artifact_mime: "image/x-exr",
    artifact_metadata: null,
    context: null,
    object_type: "image",
  };
}

const BINDINGS = [
  { runId: "runA", name: "render", contextHash: "ctx" },
  { runId: "runB", name: "render", contextHash: "ctx" },
];

function input(overrides: Partial<BuildPlotSpecInput> = {}): BuildPlotSpecInput {
  const artifactPoints = [[point(0, "a0"), point(10, "a10")], [point(0, "b0"), point(10, "b10")]];
  return {
    objectType: "image",
    metricName: "render",
    bindings: BINDINGS,
    labels: ["run A", "run B"],
    seriesPoints: artifactPoints.map((p) => [...p]),
    artifactPoints,
    referenceArtifactPoints: [[], []],
    anyLoading: false,
    currentStep: 10,
    comparison: null,
    compareOperation: "absolute",
    gridColumns: "auto",
    syncGrid: true,
    showLabels: true,
    seriesColors: ["#60a5fa", "#f59e0b"],
    ...overrides,
  };
}

function compareInput(overrides: Partial<BuildPlotSpecInput> = {}): BuildPlotSpecInput {
  return input({
    comparison: { name: "target", contextHash: "ctxRef" },
    referenceArtifactPoints: [
      [point(0, "ra0"), point(10, "ra10")],
      [point(0, "rb0"), point(10, "rb10")],
    ],
    ...overrides,
  });
}

function topologyOf(spec: BuildPlotSpecInput): string[] {
  const built = buildPlotSpec(spec);
  assert.ok(built, "expected a spec");
  return [...compileSessionTopology(built).cellIds].sort();
}

test("every image pane's session id is derived from its pane id", () => {
  const ids = paneIds(BINDINGS);
  const cellIds = topologyOf(input());
  for (const id of ids) {
    assert.ok(
      cellIds.some((cell) => cell.startsWith(`cell:root/${id}`)),
      `no session cell for pane ${id} in ${JSON.stringify(cellIds)}`,
    );
  }
});

test("no session id falls back to a positional key", () => {
  // `gridCellKey` uses `i<index>` when a child carries no id; seeing one means
  // the card stopped emitting `id` on its children.
  for (const spec of [input(), compareInput(), compareInput({ compareOperation: "split" })]) {
    for (const cell of topologyOf(spec)) {
      assert.ok(!/\/i\d+(\/|$)/.test(cell), `positional session id ${cell}`);
    }
  }
});

test("an expanded comparison keeps its cells under its pane id", () => {
  const cellIds = topologyOf(compareInput({ compareOperation: "split" }));
  assert.ok(cellIds.length > 0);
  for (const cell of cellIds) {
    if (cell.startsWith("stack:")) continue;
    assert.ok(
      paneIds(BINDINGS).some((id) => cell.startsWith(`cell:root/${id}`)),
      `session cell ${cell} is not under a pane id`,
    );
  }
});

test("reordering the runs carries each pane's session id with it", () => {
  const forward = topologyOf(input());
  const reversed = topologyOf(input({
    bindings: [...BINDINGS].reverse(),
    labels: ["run B", "run A"],
    seriesPoints: [[point(0, "b0"), point(10, "b10")], [point(0, "a0"), point(10, "a10")]],
    artifactPoints: [[point(0, "b0"), point(10, "b10")], [point(0, "a0"), point(10, "a10")]],
  }));
  assert.deepEqual(reversed, forward);
});

test("the card never authors a session id itself", () => {
  // Regression pin for the deleted `initialSession()` helper: session ids belong
  // to cairn-plot, and any string built here would be pruned on `setTopology`.
  const source = readFileSync(
    new URL("../CairnPlotCard.tsx", import.meta.url),
    "utf8",
  );
  // Reading an id (`firstCellSettings` matches on the `cell:` prefix) is fine;
  // building one, or writing into a session's maps, is not.
  for (const constructed of ["`cell:${", "`stack:${", "`grid:${"]) {
    assert.ok(!source.includes(constructed), `CairnPlotCard builds ${constructed}…`);
  }
  for (const write of ["session.cells[", "session.grids["]) {
    assert.ok(!source.includes(write), `CairnPlotCard writes ${write}…`);
  }
  assert.ok(
    source.includes("patchSettings"),
    "persisted settings must be applied through patchSettings",
  );
});
