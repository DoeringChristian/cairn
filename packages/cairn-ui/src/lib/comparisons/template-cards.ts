// ---------------------------------------------------------------------------
// Template cards: what a template records about each card.
//
// Pure (no storage, no api, no react) so both template flavors — comparison
// templates (./templates.ts) and report templates (../reports/templates.ts) —
// and the matcher (./template-match.ts) share one definition.
// ---------------------------------------------------------------------------

import { isMultiRunCardType, type ComparisonCard } from "./types.ts";

export interface ComparisonTemplateCard {
  type: ComparisonCard["type"];
  /**
   * The metric keys this card displays, in the card's own series order —
   * `"<metricName>::<contextHash>"` (the `cardKeyOf` convention from
   * lib/run-layout.ts; `contextHash` may be "").
   *
   * A card is not a single reference: it can overlay several metrics (chip
   * drag-drop, the settings picker), and a template restores all of them.
   * Empty for multi-run cards (parallel/scatter/bar/tile), which span the
   * run set rather than naming metrics — they match on `type` alone.
   */
  keys: string[];
  settings?: Record<string, unknown>;
}

/** Build a template key from a series' metric name + context hash. */
export function templateKey(name: string, contextHash: string): string {
  return `${name}::${contextHash}`;
}

/**
 * Split a template key back into its parts. The separator is the FIRST `::`
 * — metric names may not contain it, context hashes never do.
 */
export function parseTemplateKey(key: string): { name: string; contextHash: string } {
  const sep = key.indexOf("::");
  if (sep === -1) return { name: key, contextHash: "" };
  return { name: key.slice(0, sep), contextHash: key.slice(sep + 2) };
}

/**
 * Capture a live card as a template card. Shared by every "save template"
 * entry point (comparisons and reports) so they agree on the key shape.
 */
export function templateCardOf(
  card: ComparisonCard,
  settings?: Record<string, unknown>,
): ComparisonTemplateCard {
  const keys = isMultiRunCardType(card.type)
    ? []
    : Array.from(new Set(card.series.map((s) => templateKey(s.name, s.context_hash))));
  return { type: card.type, keys, settings };
}

/**
 * Coerce a persisted template card into the current shape.
 *
 * Templates live in localStorage AND on the server (which stores the payload
 * opaquely), so both may still hold the pre-`keys` shape: a single
 * `metricName` + optional `contextHash`, with multi-run cards carrying their
 * UI label ("Parallel Coordinates") as `metricName`. Both normalize here, so
 * matching only ever sees `keys`.
 */
function normalizeTemplateCard(raw: unknown): ComparisonTemplateCard | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as {
    type?: unknown;
    keys?: unknown;
    metricName?: unknown;
    contextHash?: unknown;
    settings?: unknown;
  };
  if (typeof c.type !== "string" || c.type.length === 0) return null;
  // Any non-empty string is accepted as a type — same rule as
  // `isComparisonCard` in types.ts: a template saved by a newer UI (or an
  // older one) must not silently lose cards whose type this build doesn't
  // know. Unknown types simply render `UnknownTypeCard`.
  const type = c.type as ComparisonTemplateCard["type"];
  const settings =
    c.settings && typeof c.settings === "object"
      ? (c.settings as Record<string, unknown>)
      : undefined;

  if (Array.isArray(c.keys)) {
    return {
      type,
      keys: c.keys.filter((k): k is string => typeof k === "string"),
      settings,
    };
  }
  // Legacy shape.
  if (isMultiRunCardType(c.type) || typeof c.metricName !== "string" || !c.metricName) {
    return { type, keys: [], settings };
  }
  const ctx = typeof c.contextHash === "string" ? c.contextHash : "";
  return { type, keys: [templateKey(c.metricName, ctx)], settings };
}

/** Normalize every card of a persisted template (see `normalizeTemplateCard`). */
export function normalizeTemplateCards(cards: unknown[]): ComparisonTemplateCard[] {
  return cards
    .map(normalizeTemplateCard)
    .filter((c): c is ComparisonTemplateCard => c !== null);
}
