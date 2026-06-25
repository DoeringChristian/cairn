import { SERIES_COLORS } from "../lib/colors";
import { seriesKey, seriesLabel } from "../lib/series-utils";
import SeriesChip, { type SeriesRef } from "./SeriesChip";

type MetricEntry = { runId?: string; name: string; context_hash: string };

interface Props {
  metrics: MetricEntry[];
  controlledSeries?: boolean;
  runId: string;
  allRunIds: string[];
  onMetricsChange: (next: MetricEntry[]) => void;
  labelFn?: (
    m: MetricEntry,
    runId: string,
    multipleRuns: boolean,
    allRunIds: string[],
  ) => string;
  className?: string;
}

function defaultLabel(
  m: MetricEntry,
  _runId: string,
  multipleRuns: boolean,
  allRunIds: string[],
): string {
  return seriesLabel(m.name, m.context_hash, m.runId, multipleRuns, allRunIds);
}

export default function SeriesChipStrip({
  metrics,
  controlledSeries,
  runId,
  allRunIds,
  onMetricsChange,
  labelFn = defaultLabel,
  className,
}: Props) {
  const multipleRuns = allRunIds.length > 1;

  return (
    <div className={`mt-2 flex flex-wrap gap-1.5${className ? ` ${className}` : ""}`}>
      {controlledSeries
        ? (() => {
            const seen = new Set<string>();
            const tags: Array<{ name: string; color: string; firstIdx: number }> = [];
            for (let i = 0; i < metrics.length; i++) {
              const m = metrics[i]!;
              if (seen.has(m.name)) continue;
              seen.add(m.name);
              tags.push({
                name: m.name,
                color: SERIES_COLORS[tags.length % SERIES_COLORS.length]!,
                firstIdx: i,
              });
            }
            return tags.map((tag) => {
              const m = metrics[tag.firstIdx]!;
              const ref: SeriesRef = {
                runId: m.runId,
                name: m.name,
                context_hash: m.context_hash,
              };
              return (
                <SeriesChip
                  key={tag.name}
                  series={ref}
                  color={tag.color}
                  label={tag.name}
                  runId={runId}
                  onRemove={
                    tags.length > 1
                      ? () => onMetricsChange(metrics.filter((x) => x.name !== tag.name))
                      : undefined
                  }
                />
              );
            });
          })()
        : metrics.map((m, i) => {
            const ref: SeriesRef = {
              runId: m.runId,
              name: m.name,
              context_hash: m.context_hash,
            };
            return (
              <SeriesChip
                key={seriesKey(m)}
                series={ref}
                color={SERIES_COLORS[i % SERIES_COLORS.length]!}
                label={labelFn(m, runId, multipleRuns, allRunIds)}
                runId={runId}
                onRemove={
                  metrics.length > 1
                    ? () => onMetricsChange(metrics.filter((_, j) => j !== i))
                    : undefined
                }
              />
            );
          })}
    </div>
  );
}
