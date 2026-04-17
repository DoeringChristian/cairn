/**
 * Shared card renderer used by both the Metrics & Media tab (CardGrid)
 * and the Comparison view (ComparePage). One code path for all card types.
 */

import { Suspense, lazy } from "react";
import type { SequenceMeta } from "../api/types";
import type { ComparisonSeriesRef } from "../lib/comparisons";
import type { CardSettingsKey } from "../lib/card-settings";
import ScalarPlotCard from "./ScalarPlotCard";
import ImageGalleryCard from "./ImageGalleryCard";
import AudioPlayerCard from "./AudioPlayerCard";
import VideoPlayerCard from "./VideoPlayerCard";
import HistogramCard from "./HistogramCard";
import TextViewerCard from "./TextViewerCard";

const FigureInteractiveCard = lazy(
  () => import("./FigureInteractiveCard"),
);

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
      return <ImageGalleryCard {...baseProps} extraSeries={extraSeries} controlledSeries={controlledSeries} />;
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
          <FigureInteractiveCard {...baseProps} extraSeries={extraSeries} controlledSeries={controlledSeries} />
        </Suspense>
      );
    case "audio":
      return <AudioPlayerCard {...baseProps} extraSeries={extraSeries} controlledSeries={controlledSeries} />;
    case "video":
      return <VideoPlayerCard {...baseProps} extraSeries={extraSeries} controlledSeries={controlledSeries} />;
    case "histogram":
      return <HistogramCard {...baseProps} />;
    case "text":
      return <TextViewerCard {...baseProps} />;
    default:
      return (
        <div className="card p-4 text-sm text-fg-muted">
          <div className="mono mb-1 font-semibold">{metric.name}</div>
          <div>
            object_type <span className="mono">{metric.object_type}</span> has
            no dedicated renderer yet.
          </div>
        </div>
      );
  }
}
