import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlotSpec, paneIds, type BuildPlotSpecInput, type IdentifiedPlotNode } from "./build-plot-spec.ts";
import type { SequencePoint } from "../../api/types";

const COLORS = ["#60a5fa", "#f59e0b", "#34d399"] as const;

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

function imageInput(overrides: Partial<BuildPlotSpecInput> = {}): BuildPlotSpecInput {
  const bindings = [
    { runId: "runA", name: "render", contextHash: "ctx" },
    { runId: "runB", name: "render", contextHash: "ctx" },
  ];
  const artifactPoints = [
    [point(0, "a0"), point(10, "a10")],
    [point(0, "b0"), point(10, "b10")],
  ];
  return {
    objectType: "image",
    metricName: "render",
    bindings,
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
    seriesColors: COLORS,
    ...overrides,
  };
}

function children(input: BuildPlotSpecInput): IdentifiedPlotNode[] {
  const spec = buildPlotSpec(input);
  assert.ok(spec, "expected a spec");
  assert.equal(spec.root.kind, "grid");
  return (spec.root as { kind: "grid"; children: IdentifiedPlotNode[] }).children;
}

const REFERENCE_POINTS = [
  [point(0, "ra0"), point(10, "ra10")],
  [point(0, "rb0"), point(10, "rb10")],
];

function compareInput(overrides: Partial<BuildPlotSpecInput> = {}): BuildPlotSpecInput {
  return imageInput({
    comparison: { name: "target", contextHash: "ctxRef" },
    referenceArtifactPoints: REFERENCE_POINTS.map((p) => [...p]),
    ...overrides,
  });
}

test("compare panes hold the previous frame while the next step resolves", () => {
  const nodes = children(compareInput());
  assert.equal(nodes.length, 2);
  for (const node of nodes) {
    assert.equal(node.kind, "compare");
    // H3: this was set only on the plain-image branch, so compare panes blanked
    // to "Loading…" on every step change.
    assert.equal(node.props?.holdPreviousWhileLoading, true);
  }
});

test("plain image panes keep the hold flag", () => {
  for (const node of children(imageInput())) {
    assert.equal(node.props?.holdPreviousWhileLoading, true);
  }
});

test("every child carries a stable id equal to its run id", () => {
  assert.deepEqual(children(imageInput()).map((n) => n.id), ["runA", "runB"]);
  assert.deepEqual(children(compareInput()).map((n) => n.id), ["runA", "runB"]);
});

test("two series of the same run get distinct ids", () => {
  const bindings = [
    { runId: "runA", name: "render", contextHash: "ctx" },
    { runId: "runA", name: "albedo", contextHash: "ctx" },
    { runId: "runB", name: "render", contextHash: "ctx" },
  ];
  assert.deepEqual(paneIds(bindings), ["runA:render:ctx", "runA:albedo:ctx", "runB"]);
  assert.equal(new Set(paneIds(bindings)).size, 3);
});

test("a run whose first artifact is above the step keeps its pane", () => {
  // runB only starts logging at step 100; the slider sits at 10.
  const input = compareInput({
    artifactPoints: [
      [point(0, "a0"), point(10, "a10")],
      [point(100, "b100")],
    ],
    referenceArtifactPoints: [
      [point(0, "ra0"), point(10, "ra10")],
      [point(100, "rb100")],
    ],
    currentStep: 10,
  });
  const nodes = children(input);
  // H6: this pane used to be dropped out of the grid entirely.
  assert.deepEqual(nodes.map((n) => n.id), ["runA", "runB"]);
  assert.equal(nodes[1]!.kind, "compare");
});

test("a run with no points at all stays out of the grid without nulling the card", () => {
  const input = imageInput({
    artifactPoints: [[point(0, "a0"), point(10, "a10")], []],
    seriesPoints: [[point(0, "a0"), point(10, "a10")], []],
  });
  const nodes = children(input);
  assert.deepEqual(nodes.map((n) => n.id), ["runA"]);
});

test("the spec is built while one run is still loading", () => {
  // H5: the card used to return null (unmounting every pane) whenever any
  // query — including a newly added reference binding — was still loading.
  const input = imageInput({
    anyLoading: true,
    artifactPoints: [[point(0, "a0"), point(10, "a10")], []],
    seriesPoints: [[point(0, "a0"), point(10, "a10")], []],
  });
  const spec = buildPlotSpec(input);
  assert.ok(spec, "expected a spec while one run loads");
  assert.deepEqual(children(input).map((n) => n.id), ["runA"]);
});

test("a compare pane whose reference has not arrived falls back to the plain image", () => {
  const input = compareInput({ anyLoading: true, referenceArtifactPoints: [[], []] });
  const nodes = children(input);
  assert.deepEqual(nodes.map((n) => n.id), ["runA", "runB"]);
  for (const node of nodes) {
    assert.equal(node.kind, "plot");
    assert.equal(node.props?.holdPreviousWhileLoading, true);
  }
});

test("nothing at all while loading still yields the loading placeholder", () => {
  const spec = buildPlotSpec(imageInput({
    anyLoading: true,
    artifactPoints: [[], []],
    seriesPoints: [[], []],
  }));
  assert.equal(spec, null);
});

test("the pane that is itself the reference is not compared against itself", () => {
  const input = compareInput({
    bindings: [
      { runId: "runA", name: "render", contextHash: "ctx" },
      { runId: "runB", name: "target", contextHash: "ctxRef" },
    ],
  });
  assert.deepEqual(children(input).map((n) => n.id), ["runA"]);
});

test("compare nodes carry the selected operation and presentation", () => {
  const split = children(compareInput({ compareOperation: "split" }))[0]!;
  assert.equal(split.kind, "compare");
  assert.equal((split as { presentation: string }).presentation, "split");
  assert.equal(split.settings?.["compare.operation"], "split");

  const flip = children(compareInput({ compareOperation: "flip" }))[0]!;
  assert.equal((flip as { presentation: string }).presentation, "difference");
  assert.equal(flip.settings?.["compare.operation"], "flip");
});

test("the scalar branch still builds one grid child with an id", () => {
  const spec = buildPlotSpec(imageInput({
    objectType: "scalar",
    seriesPoints: [[{ ...point(0, "a0"), scalar_value: 1, object_type: "scalar" }], []],
  }));
  assert.ok(spec);
  const nodes = (spec.root as { children: IdentifiedPlotNode[] }).children;
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0]!.id, "runA");
});
