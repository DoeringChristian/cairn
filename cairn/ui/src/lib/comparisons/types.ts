/**
 * Types and validation guards for named, persisted comparisons.
 */

import type { CardSettingsKey } from "../card-settings";

export interface ComparisonSeriesRef {
  runId: string;
  /** Metric name. */
  name: string;
  /** "" for "no context"; otherwise the context hash returned by /sequences. */
  context_hash: string;
}

export interface ComparisonCard {
  /** Stable uuid. Distinct from the settings storage key — see lib/card-settings.ts. */
  id: string;
  type: "scalar" | "image" | "figure" | "audio" | "video" | "histogram" | "text" | "tensor" | "parallel" | "scatter" | "bar" | "tile" | "pointcloud" | "mesh" | "boxes3d" | "volume";
  series: ComparisonSeriesRef[];
}

/**
 * Card types that render as a workspace-level "multi-run" card — a *set of
 * runs* rather than a single metric. They flow through CardRenderer's
 * `kind: "multi-run"` union and key their settings on `card.type` (see
 * `cardSettingsKeyFor`), unlike per-metric cards which key on `card.id`.
 *
 * Centralized here so every dispatch site (CardRenderer, ComparePage,
 * AddCardModal, sync.cardSettingsKeyFor) agrees on the same list.
 */
export const MULTI_RUN_CARD_TYPES = ["parallel", "scatter", "bar", "tile"] as const;
export type MultiRunCardType = (typeof MULTI_RUN_CARD_TYPES)[number];
export function isMultiRunCardType(t: string): t is MultiRunCardType {
  return (MULTI_RUN_CARD_TYPES as readonly string[]).includes(t);
}

/**
 * Human label per multi-run card type — mirrors AddCardModal's
 * `multiRunDefaults` fallback entries. Used when reconstructing a
 * multi-run card's series (e.g. applying a comparison template), where
 * there's no real metric name to draw from.
 */
export const MULTI_RUN_CARD_LABELS: Record<MultiRunCardType, string> = {
  parallel: "Parallel Coordinates",
  scatter: "Scatter Plot",
  bar: "Bar Chart",
  tile: "Scalar Tile",
};

export interface SmartFilterEntry {
  key: string;
  mode: "values" | "regex";
  /** Selected values when mode is "values". */
  values: string[];
  /** Regex pattern when mode is "regex". */
  regex: string;
}

export interface SmartFilters {
  projectId: string;
  strategy: "latest" | "all";
  filters: SmartFilterEntry[];
}

export interface Comparison {
  id: string;
  name: string;
  createdAt: string; // ISO
  cards: ComparisonCard[];
  /** Explicit run IDs for this comparison (used by AddCardModal when no cards exist yet). */
  runIds?: string[];
  /** When present, the comparison was created by the Smart Wizard and can be refreshed. */
  smartFilters?: SmartFilters;
  /** Server-side ID (set after first save to server). */
  serverId?: string;
}

/**
 * The pseudo-run id under which a comparison's cards scope their settings
 * (see lib/card-settings.ts and lib/storage.ts's `compare:`-prefix handling
 * in run-scoped key GC). Centralized here so every call site — the cards
 * themselves, server sync, and template restore — agrees on the format.
 */
export function compareRunId(comparisonId: string): string {
  return `compare:${comparisonId}`;
}

/**
 * The CardSettingsKey shape a card's settings live under, given the
 * pseudo-run id of its scope (a comparison via `compareRunId`, or a report
 * via `reportRunId` in lib/reports).
 *
 * Multi-run cards (parallel/scatter/bar/tile, rendered via CardRenderer's
 * "multi-run" kind) key on `{runId: scopeRunId, metricName: card.type,
 * contextHash: card.id}`; every other card type keys on `{runId: scopeRunId,
 * metricName: card.id, contextHash: ""}` (the `settingsKeyOverride` shape).
 *
 * Single source of truth for this key-shape so every scope (comparisons,
 * reports, future scopes) agrees on the same convention — see
 * `comparisons/sync.ts`'s `cardSettingsKeyFor` and `lib/reports`'s
 * `cardSettingsKeyForReport`, both thin wrappers around this function.
 */
export function cardSettingsKeyForScope(scopeRunId: string, card: ComparisonCard): CardSettingsKey {
  if (isMultiRunCardType(card.type)) {
    return { runId: scopeRunId, metricName: card.type, contextHash: card.id };
  }
  return { runId: scopeRunId, metricName: card.id, contextHash: "" };
}

export function isComparisonCard(x: unknown): x is ComparisonCard {
  if (!x || typeof x !== "object") return false;
  const c = x as Partial<ComparisonCard>;
  if (typeof c.id !== "string") return false;
  // Accept any non-empty string as type — don't hardcode a set that
  // silently drops entire comparisons when a new card type is added.
  if (typeof c.type !== "string" || c.type.length === 0) return false;
  if (!Array.isArray(c.series)) return false;
  return c.series.every((s) => {
    if (!s || typeof s !== "object") return false;
    const r = s as Partial<ComparisonSeriesRef>;
    return (
      typeof r.runId === "string" &&
      typeof r.name === "string" &&
      typeof r.context_hash === "string"
    );
  });
}

export function isComparison(x: unknown): x is Comparison {
  if (!x || typeof x !== "object") return false;
  const c = x as Partial<Comparison>;
  return (
    typeof c.id === "string" &&
    typeof c.name === "string" &&
    typeof c.createdAt === "string" &&
    Array.isArray(c.cards) &&
    c.cards.every(isComparisonCard)
  );
}
