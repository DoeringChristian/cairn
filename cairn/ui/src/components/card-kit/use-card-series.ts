import { useMemo } from "react";
import type { SequenceMeta } from "../../api/types";
import type { ComparisonSeriesRef } from "../../lib/comparisons";
import type { CardSettingsKey } from "../../lib/card-settings";
import { seriesKey } from "../../lib/series-utils";

export interface SeriesRef {
  runId?: string;
  name: string;
  context_hash: string;
}

export interface CardSeriesResult {
  /** Series to render, canonical order (sorted by seriesKey). */
  effectiveMetrics: SeriesRef[];
  /** Defaults object fragment: `{ metrics: SeriesRef[] }` merged into card defaults. */
  defaultMetrics: SeriesRef[];
  /** Stable identity key for memo deps (sorted, joined). */
  seriesIdentityKey: string;
  /** Distinct run ids across effectiveMetrics (always includes runId). */
  allRunIds: string[];
  multipleRuns: boolean;
  /** Resolved settings key ({runId, metricName, contextHash} or the override). */
  settingsKey: CardSettingsKey;
}

/**
 * Canonical series-merge logic shared by every series card.
 *
 * This is the reference (ScalarPlotCard) implementation, moved verbatim:
 *
 *  - defaults      = dedupe(seed ∪ extraSeries) sorted by `seriesKey`.
 *  - effective     (controlled)   = props series first, then persisted metrics
 *                                   whose *name* is not among the prop series
 *                                   names, deduped by `seriesKey`.
 *                  (uncontrolled) = persistedMetrics as-is.
 *  - identity      = the sorted-join string of extraSeries keys (the
 *                    `JSON.stringify` dep trick is centralised here, once).
 *
 * The hook does NOT own settings persistence — the card calls `useCardSettings`
 * itself (to keep its per-card settings type) and passes `settings.metrics` in
 * as `persistedMetrics`.
 */
export function useCardSeries(args: {
  runId: string;
  metric: SequenceMeta;
  extraSeries?: ComparisonSeriesRef[];
  controlledSeries?: boolean;
  settingsKeyOverride?: CardSettingsKey;
  /** The card's persisted settings.metrics (pass settings.metrics). */
  persistedMetrics: SeriesRef[];
}): CardSeriesResult {
  const {
    runId,
    metric,
    extraSeries,
    controlledSeries = false,
    settingsKeyOverride,
    persistedMetrics,
  } = args;

  const seriesIdentityKey = useMemo(
    () =>
      (extraSeries ?? [])
        .map((s) => `${s.runId}::${s.name}::${s.context_hash}`)
        .sort()
        .join("|"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify((extraSeries ?? []).map((s) => [s.runId, s.name, s.context_hash]).sort())],
  );

  const defaultMetrics = useMemo<SeriesRef[]>(() => {
    const all: SeriesRef[] = [
      { name: metric.name, context_hash: metric.context_hash },
      ...(extraSeries ?? []).map((s) => ({
        runId: s.runId,
        name: s.name,
        context_hash: s.context_hash,
      })),
    ];
    const seen = new Set<string>();
    const unique = all.filter((m) => {
      const k = seriesKey(m);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    unique.sort((a, b) => seriesKey(a).localeCompare(seriesKey(b)));
    return unique;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric.name, metric.context_hash, seriesIdentityKey]);

  const settingsKey = useMemo<CardSettingsKey>(
    () =>
      settingsKeyOverride ?? {
        runId,
        metricName: metric.name,
        contextHash: metric.context_hash,
      },
    [settingsKeyOverride, runId, metric.name, metric.context_hash],
  );

  const effectiveMetrics = useMemo<SeriesRef[]>(() => {
    if (!controlledSeries) return persistedMetrics;
    const all: SeriesRef[] = [
      { name: metric.name, context_hash: metric.context_hash },
      ...(extraSeries ?? []).map((s) => ({
        runId: s.runId,
        name: s.name,
        context_hash: s.context_hash,
      })),
    ];
    const propsTagNames = new Set(all.map((m) => m.name));
    for (const sm of persistedMetrics) {
      if (!propsTagNames.has(sm.name)) {
        all.push(sm);
      }
    }
    const seen = new Set<string>();
    return all.filter((m) => {
      const k = seriesKey(m);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlledSeries, persistedMetrics, metric.name, metric.context_hash, seriesIdentityKey]);

  const allRunIds = useMemo(() => {
    const set = new Set<string>([runId]);
    for (const m of effectiveMetrics) set.add(m.runId ?? runId);
    return Array.from(set);
  }, [runId, effectiveMetrics]);
  const multipleRuns = allRunIds.length > 1;

  return {
    effectiveMetrics,
    defaultMetrics,
    seriesIdentityKey,
    allRunIds,
    multipleRuns,
    settingsKey,
  };
}
