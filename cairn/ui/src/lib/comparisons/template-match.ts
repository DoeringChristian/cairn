// ---------------------------------------------------------------------------
// Template matching: which template cards can be reconstructed from a run set.
//
// Pure (no api, no storage) — `apply-template.ts` fetches the sequences and
// builds the comparison; this decides what the template resolves to. Report
// templates reuse it verbatim (see lib/reports/apply-template.ts).
// ---------------------------------------------------------------------------

import { isMultiRunCardType, MULTI_RUN_CARD_LABELS } from "./types.ts";
import { parseTemplateKey, type ComparisonTemplateCard } from "./template-cards.ts";

export interface SeriesEntry {
  runId: string;
  name: string;
  context_hash: string;
}

export interface MatchedTemplateCard {
  tc: ComparisonTemplateCard;
  series: SeriesEntry[];
}

/**
 * metric name -> series entries available across the given runs, one entry per
 * (run, context) — see `buildSeqMap` in apply-template.ts.
 */
export type SeqMap = Map<string, SeriesEntry[]>;

/** A template minus everything matching doesn't look at. */
export interface MatchableTemplate {
  cards: ComparisonTemplateCard[];
}

/**
 * Decide which template cards can be reconstructed from `runIds` given
 * `seqMap`.
 *
 * - Multi-run cards (parallel/scatter/bar/tile) span the run set directly —
 *   they don't correspond to a metric name, so they always match as long as
 *   at least one run is given (they carry no `keys`; we branch on `tc.type`).
 *   Templates saved by the pre-`keys` code are normalized on load — see
 *   `normalizeTemplateCards` in template-cards.ts.
 * - Per-metric cards resolve each of their `keys` (`"<name>::<contextHash>"`)
 *   against `seqMap`, concatenating the resulting series — a card that
 *   overlaid several metrics is restored as an overlay, not just its first
 *   series. A key with a context hash prefers series under that exact
 *   context; without one (or when no run has it) it falls back to any
 *   context, one series per run, so older/partial data still matches.
 *   The card matches when at least one key resolves.
 */
export function matchTemplateCards(
  template: MatchableTemplate,
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
        series: runIds.map((runId) => ({ runId, name: label, context_hash: "" })),
      });
      continue;
    }

    const series: SeriesEntry[] = [];
    const seen = new Set<string>();
    for (const key of tc.keys) {
      const { name, contextHash } = parseTemplateKey(key);
      if (name.startsWith("system.")) continue;
      const candidates = seqMap.get(name);
      if (!candidates?.length) continue;

      const inContext = contextHash
        ? candidates.filter((s) => s.context_hash === contextHash)
        : [];
      // No context preference (or none of the runs have it): one series per
      // run, first context wins — the pre-`keys` behavior.
      const chosen = inContext.length > 0 ? inContext : firstPerRun(candidates);
      for (const s of chosen) {
        const id = `${s.runId}::${s.name}::${s.context_hash}`;
        if (seen.has(id)) continue;
        seen.add(id);
        series.push(s);
      }
    }
    if (series.length === 0) continue;
    matched.push({ tc, series });
  }
  return matched;
}

/** Keep the first series of each run, in encounter order. */
function firstPerRun(entries: SeriesEntry[]): SeriesEntry[] {
  const byRun = new Set<string>();
  return entries.filter((s) => {
    if (byRun.has(s.runId)) return false;
    byRun.add(s.runId);
    return true;
  });
}
