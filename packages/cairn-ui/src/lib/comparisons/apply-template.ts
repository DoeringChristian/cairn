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
import type { ComparisonCard } from "./types";
import { matchTemplateCards } from "./template-match";
import type { MatchedTemplateCard, SeqMap, SeriesEntry } from "./template-match";
import type { ComparisonTemplate } from "./templates";

// Matching itself lives in ./template-match.ts (pure); re-exported here so
// the historical import site keeps working.
export { matchTemplateCards };
export type { SeriesEntry, MatchedTemplateCard, SeqMap };

/**
 * Fetch sequences for `runIds` and build the metric-name -> series map used by
 * `matchTemplateCards`.
 *
 * One entry per (run, context) — a run emitting the same metric under several
 * contexts (train/val) contributes one entry per context, so a template key
 * that recorded a context can actually prefer it. `matchTemplateCards` narrows
 * back to one series per run when the key expresses no context preference.
 */
export async function buildSeqMap(runIds: string[]): Promise<SeqMap> {
  const seqResults = await Promise.all(runIds.map((rid) => api.sequences(rid)));
  const seqMap: SeqMap = new Map();
  seqResults.forEach((result, idx) => {
    const runId = runIds[idx]!;
    for (const seq of result.sequences) {
      const entry: SeriesEntry = { runId, name: seq.name, context_hash: seq.context_hash };
      const existing = seqMap.get(seq.name);
      if (existing) {
        if (!existing.some((s) => s.runId === runId && s.context_hash === seq.context_hash)) {
          existing.push(entry);
        }
      } else {
        seqMap.set(seq.name, [entry]);
      }
    }
  });
  return seqMap;
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
