import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlotSpec, paneIds, type BuildPlotSpecInput, type IdentifiedPlotNode } from "./build-plot-spec.ts";
import type { SequencePoint } from "../../api/types";

const COLORS = ["#60a5fa", "#f59e0b", "#34d399"] as const;

const ID_A = "runA:render:ctx";
const ID_B = "runB:render:ctx";

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

function dataOf(node: IdentifiedPlotNode): { kind: string; hash?: string | null } {
  assert.equal(node.kind, "plot");
  return (node as { data: { kind: string; hash?: string | null } }).data;
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

test("compare panes ask to hold the previous frame while the next step resolves", () => {
  const nodes = children(compareInput());
  assert.equal(nodes.length, 2);
  for (const node of nodes) {
    assert.equal(node.kind, "compare");
    // H3: the flag was set only on the plain-image branch, which the comparison
    // branch returned before reaching. cairn-plot currently drops it for compare
    // nodes (comparison-plan allowlist + the `!diffSpec` gate in host-adapter);
    // the runtime honouring it lands with the next cairn-plot bump. Emitting it
    // is this side's half of the contract.
    assert.equal(node.props?.holdPreviousWhileLoading, true);
  }
});

test("plain image panes keep the hold flag", () => {
  for (const node of children(imageInput())) {
    assert.equal(node.props?.holdPreviousWhileLoading, true);
  }
});

test("every child carries the full series key as its id", () => {
  assert.deepEqual(children(imageInput()).map((n) => n.id), [ID_A, ID_B]);
  assert.deepEqual(children(compareInput()).map((n) => n.id), [ID_A, ID_B]);
});

test("paneIds is the full series key, unconditionally and stably", () => {
  const solo = [{ runId: "runA", name: "render", contextHash: "ctx" }];
  // Unique even for one binding, and unchanged when siblings are added — a key
  // that only disambiguated on collision would re-key this pane below.
  assert.deepEqual(paneIds(solo), [ID_A]);
  const withSibling = [...solo, { runId: "runA", name: "albedo", contextHash: "ctx" }];
  assert.deepEqual(paneIds(withSibling), [ID_A, "runA:albedo:ctx"]);
  assert.equal(paneIds(withSibling)[0], paneIds(solo)[0]);
  assert.equal(new Set(paneIds(withSibling)).size, 2);
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
  assert.deepEqual(nodes.map((n) => n.id), [ID_A, ID_B]);
  assert.equal(nodes[1]!.kind, "compare");
});

test("a run with no artifact at all still gets an unavailable pane", () => {
  // F3: one child per binding, always — a missing artifact holds its cell with
  // a null hash, which cairn-plot renders as "Image unavailable".
  const input = imageInput({
    artifactPoints: [[point(0, "a0"), point(10, "a10")], []],
    seriesPoints: [[point(0, "a0"), point(10, "a10")], []],
  });
  const nodes = children(input);
  assert.deepEqual(nodes.map((n) => n.id), [ID_A, ID_B]);
  assert.deepEqual(dataOf(nodes[1]!), { kind: "image", hash: null });
  assert.equal(nodes[1]!.props?.holdPreviousWhileLoading, true);
  assert.equal(nodes[1]!.props?.label, "run B");
});

test("the child count always equals the binding count", () => {
  const cases: BuildPlotSpecInput[] = [
    imageInput(),
    compareInput(),
    imageInput({ artifactPoints: [[], []], seriesPoints: [[point(0, "a0")], []] }),
    compareInput({ referenceArtifactPoints: [[], []] }),
    compareInput({ artifactPoints: [[point(0, "a0")], []], seriesPoints: [[point(0, "a0")], []] }),
  ];
  for (const input of cases) {
    assert.equal(children(input).length, input.bindings.length);
  }
});

test("the spec is built while one run is still loading", () => {
  // H5: the card used to return null (unmounting every pane) whenever any
  // query — including a newly added reference binding — was still loading.
  const input = imageInput({
    anyLoading: true,
    artifactPoints: [[point(0, "a0"), point(10, "a10")], []],
    seriesPoints: [[point(0, "a0"), point(10, "a10")], []],
  });
  const nodes = children(input);
  assert.deepEqual(nodes.map((n) => n.id), [ID_A, ID_B]);
  assert.deepEqual(dataOf(nodes[0]!), {
    kind: "image", hash: "a10", metadata: null, format: "exr",
  } as never);
  assert.equal(dataOf(nodes[1]!).hash, null);
});

test("a compare pane whose reference has not arrived falls back to the plain image", () => {
  const input = compareInput({ anyLoading: true, referenceArtifactPoints: [[], []] });
  const nodes = children(input);
  assert.deepEqual(nodes.map((n) => n.id), [ID_A, ID_B]);
  for (const node of nodes) {
    assert.equal(node.kind, "plot");
    assert.equal(dataOf(node).kind, "image");
    assert.notEqual(dataOf(node).hash, null);
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

test("nothing at all once settled yields unavailable panes, not a null card", () => {
  const nodes = children(imageInput({
    anyLoading: false,
    artifactPoints: [[], []],
    seriesPoints: [[], []],
  }));
  assert.equal(nodes.length, 2);
  for (const node of nodes) assert.equal(dataOf(node).hash, null);
});

test("the pane that is itself the reference shows its own image, and keeps its cell", () => {
  const input = compareInput({
    bindings: [
      { runId: "runA", name: "render", contextHash: "ctx" },
      { runId: "runB", name: "target", contextHash: "ctxRef" },
    ],
  });
  const nodes = children(input);
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0]!.kind, "compare");
  // Never compared against itself, but no longer dropped from the grid either.
  assert.equal(nodes[1]!.kind, "plot");
  assert.equal(dataOf(nodes[1]!).hash, "b10");
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

test("a 3D run with no artifact gets a null-hash npz pane", () => {
  const nodes = children(imageInput({
    objectType: "pointcloud",
    artifactPoints: [[], []],
    seriesPoints: [[point(0, "a0")], []],
  }));
  assert.equal(nodes.length, 2);
  assert.deepEqual(dataOf(nodes[1]!), {
    kind: "npz", hash: null, objectType: "pointcloud", meta: {},
  } as never);
});

test("the scalar branch still builds one grid child with an id", () => {
  const spec = buildPlotSpec(imageInput({
    objectType: "scalar",
    seriesPoints: [[{ ...point(0, "a0"), scalar_value: 1, object_type: "scalar" }], []],
  }));
  assert.ok(spec);
  const nodes = (spec.root as { children: IdentifiedPlotNode[] }).children;
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0]!.id, ID_A);
});
