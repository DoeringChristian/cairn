/**
 * Shared card renderer used by both the Metrics & Media tab (CardGrid)
 * and the Comparison view (ComparePage). One code path for all card types.
 */

import { Suspense, lazy, useMemo } from "react";
import type { SequenceMeta } from "../api/types";
import type { ComparisonSeriesRef, MultiRunCardType } from "../lib/comparisons";
import type { CardSettingsKey } from "../lib/card-settings";
import { useSequence } from "../api/hooks";
import { api } from "../api/client";
import { downloadArtifact, artifactFilename } from "../lib/download";
import ScalarPlotCard from "./ScalarPlotCard";
import ImageGalleryCard from "./ImageGalleryCard";
import AudioPlayerCard from "./AudioPlayerCard";
import VideoPlayerCard from "./VideoPlayerCard";
import HistogramCard from "./HistogramCard";
import TensorCard from "./TensorCard";
import TextViewerCard from "./TextViewerCard";
import ArtifactCard from "./ArtifactCard";

const FigureInteractiveCard = lazy(
  () => import("./FigureInteractiveCard"),
);

const PluginCard = lazy(() => import("./PluginCard"));

const ParallelCoordsCard = lazy(() => import("./ParallelCoordsCard"));

const ScatterPlotCard = lazy(() => import("./ScatterPlotCard"));

const TableCard = lazy(() => import("./TableCard"));

const HtmlCard = lazy(() => import("./HtmlCard"));

const MarkdownCard = lazy(() => import("./MarkdownCard"));

const BarChartCard = lazy(() => import("./BarChartCard"));

const ScalarTileCard = lazy(() => import("./ScalarTileCard"));

const PointCloudCard = lazy(() => import("./PointCloudCard"));

/**
 * Descriptor for the card CardRenderer should render.
 *
 * Two shapes:
 * - `series` (default): a single metric's card, optionally overlaid with
 *   extra cross-run series. This covers all 9 per-metric card types.
 * - `multi-run`: the parallel-coordinates / scatter cards, which take a set of
 *   run IDs rather than a single metric.
 *
 * `kind` is optional on the series variant so the common call sites
 * (`<CardRenderer runId=… metric=… />`) stay terse; it defaults to "series".
 */
export type CardDescriptor =
  | {
      kind?: "series";
      runId: string;
      metric: SequenceMeta;
      /** Extra series for cross-run overlays. */
      extraSeries?: ComparisonSeriesRef[];
      /** When true, ignore persisted metrics — always use props. */
      controlledSeries?: boolean;
      /** Override the settings localStorage key (used in comparisons). */
      settingsKeyOverride?: CardSettingsKey;
      /** Show a remove button in the card header. */
      onRemove?: () => void;
      /** Open the settings modal and scroll into view once on mount (e.g. just-added card). */
      autoOpenSettings?: boolean;
    }
  | {
      kind: "multi-run";
      cardType: MultiRunCardType;
      runIds: string[];
      /**
       * Settings storage key. Kept as a CardSettingsKey object (not a plain
       * string) so the string written to localStorage via
       * cardSettingsStorageKey() stays byte-identical to the legacy path.
       */
      settingsKey: CardSettingsKey;
      onRemove?: () => void;
      /** Open the settings modal and scroll into view once on mount (e.g. just-added card). */
      autoOpenSettings?: boolean;
    };

/** Loading placeholder shared by the lazily-loaded card variants. */
function LazyCardFallback({ label }: { label: string }) {
  return (
    <div data-cairn-card className="card p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="mono text-sm font-semibold">{" "}</h3>
        <span className="text-xs text-fg-subtle">{label}</span>
      </div>
      <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />
    </div>
  );
}

/** Fallback card for unknown object types — shows type info + download button. */
function UnknownTypeCard({ runId, metric }: { runId: string; metric: SequenceMeta }) {
  const q = useSequence(runId, metric.name, { context: metric.context_hash || undefined, maxPoints: 1 });
  const point = useMemo(() => (q.data?.points ?? [])[0], [q.data]);

  return (
    <div data-cairn-card className="card p-4 text-sm text-fg-muted">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="mono font-semibold">{metric.name}</div>
        <div className="flex items-center gap-1 text-xs">
          <span className="rounded bg-bg-hover px-1.5 py-0.5 text-[10px]">{metric.object_type}</span>
          {point?.artifact_hash && (
            <button
              type="button"
              onClick={() => downloadArtifact(api.artifactUrl(point.artifact_hash!), artifactFilename(metric.name, point.step, point.artifact_mime))}
              className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
              title="Download"
            >
              {"\u2193"}
            </button>
          )}
        </div>
      </div>
      <div>{metric.count} point{metric.count !== 1 ? "s" : ""} logged</div>
    </div>
  );
}

export default function CardRenderer(props: CardDescriptor) {
  if (props.kind === "multi-run") {
    const { cardType, runIds, settingsKey, onRemove, autoOpenSettings } = props;
    if (cardType === "parallel") {
      return (
        <Suspense fallback={<LazyCardFallback label="loading parallel coords…" />}>
          <ParallelCoordsCard runIds={runIds} settingsKey={settingsKey} onRemove={onRemove} autoOpenSettings={autoOpenSettings} />
        </Suspense>
      );
    }
    if (cardType === "bar") {
      return (
        <Suspense fallback={<LazyCardFallback label="loading bar chart…" />}>
          <BarChartCard runIds={runIds} settingsKey={settingsKey} onRemove={onRemove} autoOpenSettings={autoOpenSettings} />
        </Suspense>
      );
    }
    if (cardType === "tile") {
      return (
        <Suspense fallback={<LazyCardFallback label="loading tile…" />}>
          <ScalarTileCard runIds={runIds} settingsKey={settingsKey} onRemove={onRemove} autoOpenSettings={autoOpenSettings} />
        </Suspense>
      );
    }
    return (
      <Suspense fallback={<LazyCardFallback label="loading scatter…" />}>
        <ScatterPlotCard runIds={runIds} settingsKey={settingsKey} onRemove={onRemove} autoOpenSettings={autoOpenSettings} />
      </Suspense>
    );
  }

  const {
    runId,
    metric,
    extraSeries,
    settingsKeyOverride,
    onRemove,
    controlledSeries,
    autoOpenSettings,
  } = props;
  const baseProps = { runId, metric, autoOpenSettings };

  switch (metric.object_type) {
    case "scalar":
      return (
        <ScalarPlotCard
          {...baseProps}
          extraSeries={extraSeries}
          controlledSeries={controlledSeries}
          settingsKeyOverride={settingsKeyOverride}
          onRemove={onRemove}
        />
      );
    case "image":
      return <ImageGalleryCard {...baseProps} extraSeries={extraSeries} controlledSeries={controlledSeries} onRemove={onRemove} settingsKeyOverride={settingsKeyOverride} />;
    case "figure":
      return (
        <Suspense
          fallback={
            <div data-cairn-card className="card p-4">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h3 className="mono text-sm font-semibold">{metric.name}</h3>
                <span className="text-xs text-fg-subtle">loading plotly…</span>
              </div>
              <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />
            </div>
          }
        >
          <FigureInteractiveCard {...baseProps} extraSeries={extraSeries} controlledSeries={controlledSeries} onRemove={onRemove} settingsKeyOverride={settingsKeyOverride} />
        </Suspense>
      );
    case "audio":
      return <AudioPlayerCard {...baseProps} extraSeries={extraSeries} controlledSeries={controlledSeries} onRemove={onRemove} settingsKeyOverride={settingsKeyOverride} />;
    case "video":
      return <VideoPlayerCard {...baseProps} extraSeries={extraSeries} controlledSeries={controlledSeries} onRemove={onRemove} settingsKeyOverride={settingsKeyOverride} />;
    case "histogram":
      return <HistogramCard {...baseProps} onRemove={onRemove} settingsKeyOverride={settingsKeyOverride} />;
    case "tensor":
      return <TensorCard {...baseProps} onRemove={onRemove} settingsKeyOverride={settingsKeyOverride} />;
    case "text":
      return <TextViewerCard {...baseProps} onRemove={onRemove} settingsKeyOverride={settingsKeyOverride} />;
    case "table":
      return (
        <Suspense fallback={<LazyCardFallback label="loading table…" />}>
          <TableCard {...baseProps} extraSeries={extraSeries} controlledSeries={controlledSeries} onRemove={onRemove} settingsKeyOverride={settingsKeyOverride} />
        </Suspense>
      );
    case "html":
      return (
        <Suspense
          fallback={<LazyCardFallback label="loading html…" />}
        >
          <HtmlCard {...baseProps} extraSeries={extraSeries} controlledSeries={controlledSeries} onRemove={onRemove} settingsKeyOverride={settingsKeyOverride} />
        </Suspense>
      );
    case "markdown":
      return (
        <Suspense
          fallback={<LazyCardFallback label="loading markdown…" />}
        >
          <MarkdownCard {...baseProps} extraSeries={extraSeries} controlledSeries={controlledSeries} onRemove={onRemove} settingsKeyOverride={settingsKeyOverride} />
        </Suspense>
      );
    case "artifact":
      return <ArtifactCard {...baseProps} onRemove={onRemove} settingsKeyOverride={settingsKeyOverride} />;
    case "pointcloud":
      return (
        <Suspense
          fallback={
            <div data-cairn-card className="card p-4">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h3 className="mono text-sm font-semibold">{metric.name}</h3>
                <span className="text-xs text-fg-subtle">loading three.js…</span>
              </div>
              <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />
            </div>
          }
        >
          <PointCloudCard {...baseProps} extraSeries={extraSeries} controlledSeries={controlledSeries} onRemove={onRemove} settingsKeyOverride={settingsKeyOverride} />
        </Suspense>
      );
    case "plugin":
      return (
        <Suspense
          fallback={
            <div data-cairn-card className="card p-4">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h3 className="mono text-sm font-semibold">{metric.name}</h3>
                <span className="text-xs text-fg-subtle">loading plugin…</span>
              </div>
              <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />
            </div>
          }
        >
          <PluginCard {...baseProps} extraSeries={extraSeries} controlledSeries={controlledSeries} onRemove={onRemove} settingsKeyOverride={settingsKeyOverride} />
        </Suspense>
      );
    default:
      return <UnknownTypeCard {...baseProps} />;
  }
}
