/**
 * Shared card renderer used by both the Metrics & Media tab (CardGrid)
 * and the Comparison view (ComparePage). One code path for all card types.
 */

import { Suspense, lazy, useMemo } from "react";
import type { SequenceMeta } from "../api/types";
import type { ComparisonSeriesRef } from "../lib/comparisons";
import type { CardSettingsKey } from "../lib/card-settings";
import { useSequence } from "../api/hooks";
import { api } from "../api/client";
import { downloadArtifact, artifactFilename } from "../lib/download";
import ScalarPlotCard from "./ScalarPlotCard";
import ImageGalleryCard from "./ImageGalleryCard";
import AudioPlayerCard from "./AudioPlayerCard";
import VideoPlayerCard from "./VideoPlayerCard";
import HistogramCard from "./HistogramCard";
import TextViewerCard from "./TextViewerCard";
import ArtifactCard from "./ArtifactCard";

const FigureInteractiveCard = lazy(
  () => import("./FigureInteractiveCard"),
);

const PluginCard = lazy(() => import("./PluginCard"));

export interface CardRendererProps {
  runId: string;
  metric: SequenceMeta;
  /** Extra series for cross-run overlays. */
  extraSeries?: ComparisonSeriesRef[];
  /** Override the settings localStorage key (used in comparisons). */
  settingsKeyOverride?: CardSettingsKey;
  /** Show a remove button in the card header (scalar only for now). */
  onRemove?: () => void;
  /** When true, ignore persisted metrics — always use props. */
  controlledSeries?: boolean;
}

/** Fallback card for unknown object types — shows type info + download button. */
function UnknownTypeCard({ runId, metric }: { runId: string; metric: SequenceMeta }) {
  const q = useSequence(runId, metric.name, { context: metric.context_hash || undefined, maxPoints: 1 });
  const point = useMemo(() => (q.data?.points ?? [])[0], [q.data]);

  return (
    <div className="card p-4 text-sm text-fg-muted">
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

export default function CardRenderer({
  runId,
  metric,
  extraSeries,
  settingsKeyOverride,
  onRemove,
  controlledSeries,
}: CardRendererProps) {
  const baseProps = { runId, metric };

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
            <div className="card p-4">
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
    case "text":
      return <TextViewerCard {...baseProps} onRemove={onRemove} settingsKeyOverride={settingsKeyOverride} />;
    case "artifact":
      return <ArtifactCard {...baseProps} onRemove={onRemove} settingsKeyOverride={settingsKeyOverride} />;
    case "plugin":
      return (
        <Suspense
          fallback={
            <div className="card p-4">
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
