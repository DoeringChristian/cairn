/**
 * Types for report documents (wandb-style reports: a vertical list of
 * markdown/cards blocks, persisted server-side).
 *
 * Forward-compat with WS-RX (dynamic run selectors + from-comparison flow):
 * `CardsBlock.runSelector` and `ReportPayload.runSelector` are typed but
 * never produced or interpreted by this workstream — they round-trip
 * unchanged through load/edit/save so a report authored by a later
 * workstream doesn't lose data when opened here.
 */

import type { ComparisonCard } from "../comparisons";

export interface MarkdownBlock {
  id: string;
  type: "markdown";
  text: string;
}

export interface CardsBlock {
  id: string;
  type: "cards";
  title?: string;
  /** Static run ids this block's cards are bound to (WS-RC scope). */
  runIds?: string[];
  /** Dynamic run selector (WS-RX) — carried through unchanged, not resolved here. */
  runSelector?: unknown;
  cards: ComparisonCard[];
}

export type ReportBlock = MarkdownBlock | CardsBlock;

export interface ReportPayload {
  blocks: ReportBlock[];
  /** Per-card settings, keyed by card.id — see lib/reports/payload.ts. */
  cardSettings?: Record<string, unknown>;
  /** Report-level dynamic run selector (WS-RX) — carried through unchanged. */
  runSelector?: unknown;
}

export function isMarkdownBlock(b: ReportBlock): b is MarkdownBlock {
  return b.type === "markdown";
}

export function isCardsBlock(b: ReportBlock): b is CardsBlock {
  return b.type === "cards";
}

/** Every ComparisonCard across every cards-block in a report, in order. */
export function allReportCards(blocks: ReportBlock[]): ComparisonCard[] {
  const out: ComparisonCard[] = [];
  for (const b of blocks) {
    if (isCardsBlock(b)) out.push(...b.cards);
  }
  return out;
}
