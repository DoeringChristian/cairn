import type { DataSpec, PlotNode, PlotSpec } from "@cairn-plot";
import type { SequencePoint } from "../../api/types";
import { artifactFormat } from "../../lib/artifact-format.ts";
import { resolveAtStep } from "./resolve-at-step.ts";

/**
 * Pure authored-spec construction for `CairnPlotCard`.
 *
 * It lives outside the `.tsx` card on purpose: `node --experimental-strip-types
 * --test` cannot load `.tsx`, and the rules this module encodes (never drop a
 * pane that has data, never null the whole card while one run is still
 * loading, hold the previous frame in compare panes) are exactly the ones that
 * need regression tests.
 */

/** cairn-plot's spec has no `id` field; the runtime passes it through and the
 *  grid keys cells by it, so a pane keeps its component identity when siblings
 *  appear, disappear or reorder. */
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

export function visualData(type: string, point: SequencePoint): DataSpec | null {
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

export function latestArtifact(points: readonly SequencePoint[]): SequencePoint | undefined {
  for (let index = points.length - 1; index >= 0; index--) {
    if (points[index]?.artifact_hash) return points[index];
  }
  return undefined;
}

/**
 * Stable per-pane ids. A pane is a run, so the id is the run id; a card that
 * shows two series of the *same* run would otherwise collide, so those (and
 * only those) fall back to the full series key. The disambiguation reads the
 * whole binding list, never the surviving children, so an id does not change
 * when a sibling pane appears or disappears.
 */
export function paneIds(bindings: readonly SeriesBinding[]): string[] {
  const counts = new Map<string, number>();
  for (const binding of bindings) {
    counts.set(binding.runId, (counts.get(binding.runId) ?? 0) + 1);
  }
  return bindings.map((binding) => (counts.get(binding.runId) ?? 0) > 1
    ? `${binding.runId}:${binding.name}:${binding.contextHash}`
    : binding.runId);
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
 * yet (no run has delivered a single point). A run that is still loading while
 * another already has data is simply absent from the grid — the card must not
 * unmount the whole plot host underneath the runs that do have data.
 */
export function buildPlotSpec(input: BuildPlotSpecInput): PlotSpec | null {
  const ids = paneIds(input.bindings);
  const nothingYet = input.seriesPoints.every((points) => points.length === 0);
  if (nothingYet && input.anyLoading) return null;

  if (input.objectType === "scalar") return buildScalarSpec(input, ids);

  const isImage = input.objectType === "image";
  const children = input.bindings.flatMap<IdentifiedPlotNode>((binding, index) => {
    const id = ids[index] ?? binding.runId;
    const point = isImage
      // Nearest, not "≤ step or nothing": a run whose first artifact lands
      // after the slider position keeps its pane instead of vanishing.
      ? resolveAtStep(input.artifactPoints[index] ?? [], input.currentStep)
      : latestArtifact(input.seriesPoints[index] ?? []);
    // `null` here means the run has no artifact at all (still loading, or
    // never logged one). cairn-plot's spec has no message/placeholder node
    // kind, so such a run stays out of the grid — but it never nulls the card.
    if (!point) return [];
    const data = visualData(input.objectType, point);
    if (!data) return [];

    if (isImage && input.comparison) {
      const item = input.bindings[index];
      const isReferencePane = item?.name === input.comparison.name &&
        item.contextHash === input.comparison.contextHash;
      // A pane cannot be compared against itself.
      if (isReferencePane) return [];
      // Resolve the selected reference tag independently inside this pane's
      // run. There is deliberately no global run reference.
      const referencePoint = resolveAtStep(
        input.referenceArtifactPoints[index] ?? [],
        input.referenceStep ?? input.currentStep,
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
            labelB: input.labels[index] ?? input.metricName,
            // Compare panes must keep the frame they already painted while the
            // next step resolves, exactly like the plain image panes below.
            holdPreviousWhileLoading: true,
          },
        }];
      }
      // The reference operand has not arrived (or this run never logged it).
      // Fall through to the plain image pane rather than dropping the run.
    }

    const props = {
      ...(input.showLabels ? { label: input.labels[index] ?? input.metricName } : {}),
      ...(isImage ? { holdPreviousWhileLoading: true } : {}),
    };
    return [{
      kind: "plot",
      id,
      type: input.objectType,
      data,
      ...(Object.keys(props).length > 0 ? { props } : {}),
    }];
  });

  if (children.length === 0) return null;
  return gridSpec(children, input);
}
