/**
 * `AddCardSelection` → `ComparisonCard` construction — the one fan-out used
 * by both the report cards-block editor (`ReportCardsBlock`'s "Add card"
 * button, via `AddCardModal`) and the declarative ```cairn dialect
 * interpreter (`lib/reports/cairn-block.ts`), so the two authoring paths
 * never diverge (see docs/superpowers/specs/2026-07-04-ai-authored-reports.md
 * §9.1.1).
 *
 * Moved here from `components/AddCardModal.tsx` (which re-exports the type
 * for existing importers) because this is pure data shaping with no UI
 * dependency — `lib/reports` is the natural home for card-construction logic
 * shared by both a component and a non-UI parser.
 */

import { type ComparisonCard, type ComparisonSeriesRef, type MultiRunCardType } from "../comparisons";
import { newId } from "./ids";

/** One entry per run that has a given metric. */
export type SelectionRuns = Array<{ runId: string; context_hash: string }>;

/**
 * Result of picking a card to add — from a user's `AddCardModal` choice or
 * from a ```cairn spec's per-card entry. Mirrors `CardDescriptor`'s
 * discriminant: `series` for a real per-metric card, `multi-run` for the
 * parallel/scatter/bar/tile cards that span a run set rather than one
 * metric.
 *
 * `manual-series` is the "custom overlay" escape hatch: an explicit list of
 * (run, metric) pairs, rather than one metric name applied across every
 * run — the two can carry *different* metric names (e.g. run-a's `loss`
 * overlaid with run-b's `accuracy`). `ComparisonCard.series` already
 * supports this shape end to end (each entry carries its own name).
 */
export type AddCardSelection =
  | { kind: "series"; name: string; object_type: string; runs: SelectionRuns }
  | { kind: "multi-run"; cardType: MultiRunCardType; name: string; runs: SelectionRuns }
  | { kind: "manual-series"; object_type: string; series: ComparisonSeriesRef[] };

/**
 * Build a fresh `ComparisonCard` (with a new id) from a selection. The
 * single source of truth for this construction — do not re-implement the
 * three-branch fan-out at a call site; call this instead.
 */
export function cardFromSpec(sel: AddCardSelection): ComparisonCard {
  if (sel.kind === "manual-series") {
    // Custom overlay: series already carry their own (runId, name,
    // context_hash) — no shared `name` to fan out across runs.
    return { id: newId(), type: sel.object_type as ComparisonCard["type"], series: sel.series };
  }
  const type: ComparisonCard["type"] =
    sel.kind === "multi-run" ? sel.cardType : (sel.object_type as ComparisonCard["type"]);
  return {
    id: newId(),
    type,
    series: sel.runs.map((r) => ({ runId: r.runId, name: sel.name, context_hash: r.context_hash })),
  };
}
