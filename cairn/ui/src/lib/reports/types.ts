/**
 * Types for report documents (wandb-style reports: a vertical list of
 * markdown/cards blocks, persisted server-side).
 *
 * WS-RX: `CardsBlock.runSelector` is now a real `RunSelector` (see
 * lib/run-selector.ts) — when present, the block's effective run set is
 * resolved live instead of read from `runIds` (see ReportCardsBlock.tsx).
 */

import type { ComparisonCard } from "../comparisons";
import type { RunSelector } from "../run-selector";

export interface MarkdownBlock {
  id: string;
  type: "markdown";
  text: string;
}

export interface CardsBlock {
  id: string;
  type: "cards";
  title?: string;
  /** Static run ids this block's cards are bound to (used when `runSelector` is absent). */
  runIds?: string[];
  /** Dynamic run selector (WS-RX) — when present, takes precedence over `runIds`. */
  runSelector?: RunSelector;
  cards: ComparisonCard[];
}

export type ReportBlock = MarkdownBlock | CardsBlock;

export interface ReportPayload {
  blocks: ReportBlock[];
  /** Per-card settings, keyed by card.id — see lib/reports/payload.ts. */
  cardSettings?: Record<string, unknown>;
  /** Report-level dynamic run selector — currently unused (per-block `CardsBlock.runSelector` is what's resolved); carried through unchanged. */
  runSelector?: RunSelector;
  /**
   * WS-AR1: the canonical markdown serialization (prose + ```cairn fences —
   * see lib/reports/markdown-source.ts), written alongside `blocks` on every
   * save. Additive-only field — older reports persisted before this field
   * existed simply have no `source`, and load from `blocks` unchanged (see
   * ReportEditorPage's hydrate effect). When present, `source` is treated as
   * authoritative on load (`blocks` is its parse cache); `blocks` remains
   * the persisted shape everything else reads, per the design doc's D6
   * ("no migration").
   */
  source?: string;
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
