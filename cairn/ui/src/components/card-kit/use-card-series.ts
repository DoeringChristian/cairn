import { useMemo, useRef } from "react";
import type { SequenceMeta } from "../../api/types";
import type { ComparisonSeriesRef } from "../../lib/comparisons";
import { useCardSettings, type CardSettingsKey } from "../../lib/card-settings";
import { seriesKey } from "../../lib/series-utils";

export interface SeriesRef {
  runId?: string;
  name: string;
  context_hash: string;
}

export interface CardSeriesResult<TSettings> {
  /** Current merged settings (defaults + persisted overrides). */
  settings: TSettings;
  /** Shallow-merge a patch over current settings and persist. */
  updateSettings: (patch: Partial<TSettings>) => void;
  /** Series to render, canonical order (sorted by seriesKey). */
  effectiveMetrics: SeriesRef[];
  /** Distinct run ids across effectiveMetrics (always includes runId). */
  allRunIds: string[];
  multipleRuns: boolean;
}

/**
 * Canonical series-merge logic shared by every series card, owning the card's
 * settings persistence (`useCardSettings`).
 *
 * This is the reference (ScalarPlotCard) implementation, moved verbatim:
 *
 *  - default metrics = dedupe(seed ∪ extraSeries) sorted by `seriesKey`;
 *    the full defaults object is produced by the card's `makeDefaults`
 *    factory (read via a ref, so an inline arrow at the call site is fine).
 *  - settingsKey     = settingsKeyOverride ?? {runId, metricName, contextHash}.
 *  - effective       (controlled)   = props series first, then persisted
 *                                     metrics whose *name* is not among the
 *                                     prop series names, deduped by `seriesKey`.
 *                    (uncontrolled) = settings.metrics as-is.
 *  - identity        = the sorted-join string of extraSeries keys (the
 *                      `JSON.stringify` dep trick is centralised here, once).
 */
export function useCardSeries<
  TSettings extends { version: number; metrics: SeriesRef[] },
>(args: {
  runId: string;
  metric: SequenceMeta;
  extraSeries?: ComparisonSeriesRef[];
  controlledSeries?: boolean;
  settingsKeyOverride?: CardSettingsKey;
  /**
   * Card's defaults factory: given the seed metric and the merged+sorted
   * default metrics list, produce the full defaults object. Read via a ref
   * internally so an inline arrow at the call site is fine.
   */
  makeDefaults: (
    seed: { name: string; context_hash: string },
    metrics: SeriesRef[],
  ) => TSettings;
}): CardSeriesResult<TSettings> {
  const {
    runId,
    metric,
    extraSeries,
    controlledSeries = false,
    settingsKeyOverride,
    makeDefaults,
  } = args;

  const seed = useMemo(
    () => ({ name: metric.name, context_hash: metric.context_hash }),
    [metric.name, metric.context_hash],
  );

  const extraSeriesKey = useMemo(
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
      seed,
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
  }, [seed, extraSeriesKey]);

  // Read the factory via a ref so callers can pass an inline arrow without
  // invalidating the memo every render (mirrors useCardSettings' defaultsRef).
  const makeDefaultsRef = useRef(makeDefaults);
  makeDefaultsRef.current = makeDefaults;

  const defaults = useMemo<TSettings>(
    () => makeDefaultsRef.current(seed, defaultMetrics),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seed, extraSeriesKey],
  );

  const settingsKey = useMemo<CardSettingsKey>(
    () =>
      settingsKeyOverride ?? {
        runId,
        metricName: metric.name,
        contextHash: metric.context_hash,
      },
    [settingsKeyOverride, runId, metric.name, metric.context_hash],
  );

  const [settings, updateSettings] = useCardSettings<TSettings>(
    settingsKey,
    defaults,
  );

  const effectiveMetrics = useMemo<SeriesRef[]>(() => {
    if (!controlledSeries) return settings.metrics;
    const all: SeriesRef[] = [
      { name: metric.name, context_hash: metric.context_hash },
      ...(extraSeries ?? []).map((s) => ({
        runId: s.runId,
        name: s.name,
        context_hash: s.context_hash,
      })),
    ];
    const propsTagNames = new Set(all.map((m) => m.name));
    for (const sm of settings.metrics) {
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
  }, [controlledSeries, settings.metrics, metric.name, metric.context_hash, extraSeriesKey]);

  const allRunIds = useMemo(() => {
    const set = new Set<string>([runId]);
    for (const m of effectiveMetrics) set.add(m.runId ?? runId);
    return Array.from(set);
  }, [runId, effectiveMetrics]);
  const multipleRuns = allRunIds.length > 1;

  return {
    settings,
    updateSettings,
    effectiveMetrics,
    allRunIds,
    multipleRuns,
  };
}
