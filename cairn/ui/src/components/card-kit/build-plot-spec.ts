import type { DataSpec, PlotNode, PlotSpec } from "@cairn-plot";
import type { SequencePoint } from "../../api/types";
import { artifactFormat } from "../../lib/artifact-format.ts";
import { resolveAtStep } from "./resolve-at-step.ts";

/**
 * Pure authored-spec construction for `CairnPlotCard`.
 *
 * It lives outside the `.tsx` card on purpose: `node --experimental-strip-types
 * --test` cannot load `.tsx`, and the rules this module encodes (one child per
 * binding, always; stable pane ids; never null the whole card while one run is
 * still loading; hold the previous frame in compare panes) are exactly the ones
 * that need regression tests.
 */

/**
 * cairn-plot's grid keys its cells by `child.id`, so a pane keeps its component
 * identity (and its decoded texture) when siblings appear, disappear or
 * reorder. `id?: string` landed on the spec in cairn-plot 30b1ffa; the
 * intersection keeps this module compiling against the vendored revision until
 * the submodule bump, and is a no-op afterwards.
 */
export type IdentifiedPlotNode = PlotNode & { id?: string };

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
 * Stable per-pane ids. The full series key, unconditionally: it is unique even
 * when one run contributes several series to a card, and — unlike a key that
 * only disambiguates on collision — it does not change when a sibling series is
 * added or removed. cairn-plot keys grid cells by this, so a stable value is
 * what stops a pane from being torn down and rebuilt.
 */
export function paneIds(bindings: readonly SeriesBinding[]): string[] {
  return bindings.map((b) => `${b.runId}:${b.name}:${b.contextHash}`);
}

/**
 * The "nothing to show for this binding" pane. cairn-plot's spec declares
 * `hash: string | null` and renders a null hash as "Image unavailable", so a
 * binding with no artifact at the selected step still occupies its grid cell
 * instead of collapsing the layout and re-keying every neighbour.
 */
function placeholderData(objectType: string): DataSpec | null {
  if (objectType === "image") return { kind: "image", hash: null };
  if (objectType === "pointcloud" || objectType === "mesh" || objectType === "volume" || objectType === "boxes3d") {
    return { kind: "npz", hash: null, objectType, meta: {} };
  }
  return null;
}

function gridSpec(children: IdentifiedPlotNode[], input: BuildPlotSpecInput): PlotSpec {
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
    key: `${input.bindings[index]?.runId}:${input.bindings[index]?.name}:${input.bindings[index]?.contextHash}`,
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
  const child: IdentifiedPlotNode = {
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
 * Every binding always produces exactly one child — a binding whose run has no
 * artifact at the selected step gets an explicit unavailable pane rather than
 * disappearing. The grid layout is therefore a pure function of the binding
 * list, so panes never reflow or re-key as data arrives.
 */
export function buildPlotSpec(input: BuildPlotSpecInput): PlotSpec | null {
  const ids = paneIds(input.bindings);
  const nothingYet = input.seriesPoints.every((points) => points.length === 0);
  if (nothingYet && input.anyLoading) return null;

  if (input.objectType === "scalar") return buildScalarSpec(input, ids);

  const isImage = input.objectType === "image";
  const children = input.bindings.flatMap<IdentifiedPlotNode>((binding, index) => {
    const id = ids[index] ?? `${binding.runId}:${binding.name}:${binding.contextHash}`;
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
    const plotNode = (nodeData: DataSpec): IdentifiedPlotNode => ({
      kind: "plot",
      id,
      type: input.objectType,
      data: nodeData,
      ...(Object.keys(imageProps).length > 0 ? { props: imageProps } : {}),
    });

    if (!data) {
      // No artifact at this step (still loading, never logged, or a hash-less
      // point). Hold the cell with an explicit unavailable pane.
      const placeholder = placeholderData(input.objectType);
      // Only an object type cairn-plot cannot render at all has no placeholder;
      // that is a card-level "unsupported", not a per-run gap.
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
