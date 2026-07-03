// ---------------------------------------------------------------------------
// Apply a comparison template to a set of runs.
//
// Shared by RunsTablePage's "From template" bulk action and ComparePage's
// TemplateSidebar ("New comparison from template"), so both entry points
// get the same matching semantics and the same "don't create an empty
// comparison" guarantee.
// ---------------------------------------------------------------------------

import { api } from "../../api/client";
import { saveCardSettings } from "../card-settings";
import { addCardsToComparison, createComparison, loadComparisons } from "./store";
import { cardSettingsKeyFor } from "./sync";
import { isMultiRunCardType, MULTI_RUN_CARD_LABELS } from "./types";
import type { ComparisonCard } from "./types";
import type { ComparisonTemplate, ComparisonTemplateCard } from "./templates";

export interface SeriesEntry {
  runId: string;
  name: string;
  context_hash: string;
}

export interface MatchedTemplateCard {
  tc: ComparisonTemplateCard;
  series: SeriesEntry[];
}

/** metric name -> series entries available across the given runs. */
export type SeqMap = Map<string, SeriesEntry[]>;

/** Fetch sequences for `runIds` and build the metric-name -> series map used by `matchTemplateCards`. */
export async function buildSeqMap(runIds: string[]): Promise<SeqMap> {
  const seqResults = await Promise.all(runIds.map((rid) => api.sequences(rid)));
  const seqMap: SeqMap = new Map();
  seqResults.forEach((result, idx) => {
    const runId = runIds[idx]!;
    for (const seq of result.sequences) {
      const entry: SeriesEntry = { runId, name: seq.name, context_hash: seq.context_hash };
      const existing = seqMap.get(seq.name);
      if (existing) {
        if (!existing.some((s) => s.runId === runId)) existing.push(entry);
      } else {
        seqMap.set(seq.name, [entry]);
      }
    }
  });
  return seqMap;
}

/**
 * Pure matching: decide which template cards can be reconstructed from
 * `runIds` given `seqMap` (see `buildSeqMap`).
 *
 * - Multi-run cards (parallel/scatter/bar/tile) span the run set directly —
 *   they don't correspond to a metric name, so they always match as long as
 *   at least one run is given. This is also what makes templates saved by
 *   the old code backward-compatible: the old save-template path stored
 *   `metricName` as the card's UI label ("Parallel Coordinates", etc, from
 *   AddCardModal's synthetic entry), which is ignored here since we branch
 *   on `tc.type` — never on `metricName` — for multi-run cards.
 * - Per-metric cards match when `metricName` has at least one series in
 *   `seqMap`. When the template recorded a `contextHash` (added cards save
 *   it; older templates omit it), series under that exact context are
 *   preferred — falling back to any context so older/partial data still
 *   matches.
 */
export function matchTemplateCards(
  template: ComparisonTemplate,
  runIds: string[],
  seqMap: SeqMap,
): MatchedTemplateCard[] {
  const matched: MatchedTemplateCard[] = [];
  for (const tc of template.cards) {
    if (isMultiRunCardType(tc.type)) {
      if (runIds.length === 0) continue;
      const label = MULTI_RUN_CARD_LABELS[tc.type];
      matched.push({
        tc,
        series: runIds.map((runId) => ({
          runId,
          name: label,
          context_hash: "",
        })),
      });
      continue;
    }

    if (tc.metricName.startsWith("system.")) continue;
    const candidates = seqMap.get(tc.metricName);
    if (!candidates?.length) continue;

    let series = candidates;
    if (tc.contextHash) {
      const inContext = candidates.filter((s) => s.context_hash === tc.contextHash);
      if (inContext.length > 0) series = inContext;
    }
    matched.push({ tc, series });
  }
  return matched;
}

export interface ApplyTemplateResult {
  /** Newly created comparison's id, or null when nothing matched (no comparison was created). */
  comparisonId: string | null;
  matchedCount: number;
  totalCount: number;
}

/**
 * Apply `template` to `runIds`.
 *
 * Cards are matched BEFORE the comparison is created — a zero-match apply
 * never leaves behind an empty comparison. On a partial match, only the
 * matched cards are added; callers should surface `matchedCount`/
 * `totalCount` to the user ("restored N of M cards").
 */
export async function applyTemplateToRuns(
  projectId: string,
  template: ComparisonTemplate,
  runIds: string[],
): Promise<ApplyTemplateResult> {
  const totalCount = template.cards.length;
  const seqMap = await buildSeqMap(runIds);
  const matched = matchTemplateCards(template, runIds, seqMap);

  if (matched.length === 0) {
    return { comparisonId: null, matchedCount: 0, totalCount };
  }

  const cmp = createComparison(projectId, template.name, runIds.length > 0 ? runIds : undefined);
  addCardsToComparison(
    projectId,
    cmp.id,
    matched.map((m): Omit<ComparisonCard, "id"> => ({ type: m.tc.type, series: m.series })),
  );

  // Restore saved settings from the template.
  const updated = loadComparisons(projectId).find((c) => c.id === cmp.id);
  if (updated) {
    const baseIdx = updated.cards.length - matched.length;
    matched.forEach((m, i) => {
      if (m.tc.settings) {
        const card = updated.cards[baseIdx + i];
        if (card) {
          saveCardSettings(cardSettingsKeyFor(cmp.id, card), m.tc.settings);
        }
      }
    });
  }

  return { comparisonId: cmp.id, matchedCount: matched.length, totalCount };
}
