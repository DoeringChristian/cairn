import type { DataSpec, PlotNode, PlotSpec } from "@cairn-plot";
import type { SequencePoint } from "../../api/types";
import { artifactFormat } from "../../lib/artifact-format.ts";
import { resolveAtStep } from "./resolve-at-step.ts";

/**
 * Pure authored-spec construction for `CairnPlotCard`.
 *
 * It lives outside the `.tsx` card on purpose: `node --experimental-strip-types
 * --test` cannot load `.tsx`, and the rules this module encodes (one child per
 * image binding, always; stable pane ids; never null the whole card while one
 * run is still loading; hold the previous frame in compare panes) are exactly
 * the ones that need regression tests.
 */

export interface SeriesBinding {
  runId: string;
  name: string;
  contextHash: string;
}

export interface ComparisonRef {
  name: string;
  contextHash: string;
}

export interface BuildPlotSpecInput {
  objectType: string;
  metricName: string;
  /** One entry per foreground series, aligned with `labels` and the point lists. */
  bindings: SeriesBinding[];
  labels: string[];
  /** Every point of each foreground series (the scalar branch reads these). */
  seriesPoints: SequencePoint[][];
  /** Foreground points that carry an artifact hash. */
  artifactPoints: SequencePoint[][];
  /** Reference-operand points that carry an artifact hash, per foreground series. */
  referenceArtifactPoints: SequencePoint[][];
  /** True while any sequence query has not delivered data yet. */
  anyLoading: boolean;
  currentStep: number;
  /** Pinned reference step; absent follows `currentStep`. */
  referenceStep?: number;
  comparison?: ComparisonRef | null;
  compareOperation: string;
  gridColumns: string;
  syncGrid: boolean;
  showLabels: boolean;
  seriesColors: readonly string[];
}

function metadata(point: SequencePoint): Record<string, string | number | boolean | null> {
  if (!point.artifact_metadata) return {};
  try {
    const value = JSON.parse(point.artifact_metadata) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, string | number | boolean | null>
      : {};
  } catch {
    return {};
  }
}

function visualData(type: string, point: SequencePoint): DataSpec | null {
  const hash = point.artifact_hash;
  if (!hash) return null;
  if (type === "image") {
    return {
      kind: "image",
      hash,
      metadata: point.artifact_metadata,
      format: artifactFormat(point.artifact_mime),
    };
  }
  if (type === "pointcloud" || type === "mesh" || type === "volume" || type === "boxes3d") {
    return { kind: "npz", hash, objectType: type, meta: metadata(point) };
  }
  return null;
}

function latestArtifact(points: readonly SequencePoint[]): SequencePoint | undefined {
  for (let index = points.length - 1; index >= 0; index--) {
    if (points[index]?.artifact_hash) return points[index];
  }
  return undefined;
}

/**
 * The one spelling of a series' identity — pane ids, scalar series keys, and
 * the card's own de-duplication of its binding list.
 */
export function seriesKey(binding: SeriesBinding | undefined): string {
  return `${binding?.runId}:${binding?.name}:${binding?.contextHash}`;
}

/**
 * Stable per-pane ids. The full series key, unconditionally: it is unique even
 * when one run contributes several series to a card, and — unlike a key that
 * only disambiguates on collision — it does not change when a sibling series is
 * added or removed. cairn-plot keys both the React cell and its session path
 * (`cell:root/<id>`) off this value, so a stable one is what stops a pane — and
 * its saved settings — from being handed to a different run on a reorder.
 */
export function paneIds(bindings: readonly SeriesBinding[]): string[] {
  return bindings.map(seriesKey);
}

/**
 * The "nothing to show for this binding" pane, for image cards only.
 *
 * cairn-plot's `DataSpec` declares `hash: string | null`, and its image panes
 * handle the null: the GPU pane shows an empty checkerboard, the CPU pane shows
 * "no image". Either way the binding keeps its grid cell instead of collapsing
 * the layout and shifting every neighbour.
 *
 * The 3D types deliberately have no placeholder: `plots/three/register.ts`
 * throws on a null npz hash ("npz DataSpec has no hash to resolve"), which the
 * host surfaces as a red "Plot error" pane. 3D cards therefore keep a
 * variable-length grid, and an artifact-less run stays out of it.
 */
function placeholderData(objectType: string): DataSpec | null {
  return objectType === "image" ? { kind: "image", hash: null } : null;
}

function gridSpec(children: PlotNode[], input: BuildPlotSpecInput): PlotSpec {
  const configuredColumns = input.gridColumns === "auto"
    ? Math.ceil(Math.sqrt(children.length))
    : Number(input.gridColumns);
  const columns = Math.max(1, Math.min(configuredColumns, children.length));
  const rows = Math.ceil(children.length / columns);
  return {
    root: {
      kind: "grid",
      children,
      cols: columns,
      rowHeights: Array.from({ length: rows }, () => "minmax(0, 1fr)"),
      gap: "0.75rem",
      switchable: false,
      shared: { sync: { settings: input.syncGrid } },
    },
  };
}

function buildScalarSpec(input: BuildPlotSpecInput, ids: string[]): PlotSpec {
  const scalarSeries = input.seriesPoints.map((points, index) => ({
    key: seriesKey(input.bindings[index]),
    label: input.labels[index] ?? `series ${index + 1}`,
    color: input.seriesColors[index % input.seriesColors.length]!,
    points: points
      .filter((point) => point.scalar_value != null)
      .map((point) => ({
        x: point.step,
        y: point.scalar_value!,
        wallTime: point.wall_time,
        context: point.context,
      })),
  }));
  const child: PlotNode = {
    kind: "plot",
    id: ids[0] ?? "scalar",
    type: "scalar",
    data: {
      kind: "inline",
      props: {
        series: scalarSeries,
        xAxis: "step",
        showLegend: scalarSeries.length > 1,
        smoothing: 0,
        outlierPct: [0, 100],
      },
    },
  };
  return {
    root: {
      kind: "grid",
      children: [child],
      cols: 1,
      rowHeights: ["minmax(0, 1fr)"],
      gap: "0.75rem",
      switchable: false,
    },
  };
}

/**
 * Build the authored spec, or `null` when there is genuinely nothing to show
 * yet (no run has delivered a single point, and something is still loading).
 *
 * On an **image** card every binding produces exactly one child: a binding whose
 * run has no artifact at the selected step gets an explicit unavailable pane
 * rather than disappearing, so the grid layout is a pure function of the binding
 * list and panes never reflow or shift as data arrives. Other object types have
 * no renderable placeholder (see `placeholderData`) and keep a variable-length
 * grid.
 */
export function buildPlotSpec(input: BuildPlotSpecInput): PlotSpec | null {
  const ids = paneIds(input.bindings);
  const nothingYet = input.seriesPoints.every((points) => points.length === 0);
  if (nothingYet && input.anyLoading) return null;

  if (input.objectType === "scalar") return buildScalarSpec(input, ids);

  const isImage = input.objectType === "image";
  const children = input.bindings.flatMap<PlotNode>((binding, index) => {
    const id = ids[index]!;
    const label = input.labels[index] ?? input.metricName;
    const point = isImage
      // Nearest, not "≤ step or nothing": a run whose first artifact lands
      // after the slider position keeps showing its earliest frame.
      ? resolveAtStep(input.artifactPoints[index] ?? [], input.currentStep, { nearest: true })
      : latestArtifact(input.seriesPoints[index] ?? []);
    const data = point ? visualData(input.objectType, point) : null;

    const imageProps = {
      ...(input.showLabels ? { label } : {}),
      ...(isImage ? { holdPreviousWhileLoading: true } : {}),
    };
    const plotNode = (nodeData: DataSpec): PlotNode => ({
      kind: "plot",
      id,
      type: input.objectType,
      data: nodeData,
      ...(Object.keys(imageProps).length > 0 ? { props: imageProps } : {}),
    });

    if (!data) {
      // No artifact at this step (still loading, never logged, or a hash-less
      // point). Image cards hold the cell with an explicit unavailable pane;
      // every other type has no placeholder cairn-plot can render, so the run
      // stays out of the grid.
      const placeholder = placeholderData(input.objectType);
      return placeholder ? [plotNode(placeholder)] : [];
    }

    if (isImage && input.comparison) {
      const isReferencePane = binding.name === input.comparison.name &&
        binding.contextHash === input.comparison.contextHash;
      // A pane cannot be compared against itself; it shows its own image, and
      // keeps its cell, instead of being dropped from the grid.
      if (!isReferencePane) {
        // Resolve the selected reference tag independently inside this pane's
        // run. There is deliberately no global run reference.
        const referencePoint = resolveAtStep(
          input.referenceArtifactPoints[index] ?? [],
          input.referenceStep ?? input.currentStep,
          { nearest: true },
        );
        const referenceData = referencePoint ? visualData("image", referencePoint) : null;
        if (referenceData) {
          return [{
            kind: "compare",
            id,
            type: "image",
            presentation: input.compareOperation === "split" ? "split" : "difference",
            operands: [referenceData, data],
            strategy: "reference",
            referenceIndex: 0,
            settings: { "compare.operation": input.compareOperation },
            props: {
              labelA: `${input.comparison.name} · reference`,
              labelB: label,
              // Compare panes must keep the frame they already painted while
              // the next step resolves, exactly like the plain image panes.
              holdPreviousWhileLoading: true,
            },
          }];
        }
        // The reference operand has not arrived (or this run never logged it).
        // Fall through to the plain image pane rather than dropping the run.
      }
    }

    return [plotNode(data)];
  });

  if (children.length === 0) return null;
  return gridSpec(children, input);
}
