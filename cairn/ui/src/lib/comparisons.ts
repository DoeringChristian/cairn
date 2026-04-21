/**
 * Named, persisted multi-comparison storage.
 *
 * A comparison is a user-curated bag of cards (scalar-only in C1). Each card
 * references one or more (run, metric, context) series. Comparisons live in
 * localStorage under `cairn:comparisons:{projectId}` so they're durable across
 * page loads and sharable across tabs via the `storage` event.
 */

import { useCallback, useEffect, useState } from "react";

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
  type: "scalar" | "image" | "figure" | "audio" | "video" | "histogram" | "text" | "tensor" | "parallel" | "scatter";
  series: ComparisonSeriesRef[];
}

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
  /** When present, the comparison was created by the Smart Wizard and can be refreshed. */
  smartFilters?: SmartFilters;
}

function storageKey(projectId: string): string {
  return `cairn:comparisons:${projectId}`;
}

function isComparisonCard(x: unknown): x is ComparisonCard {
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

function isComparison(x: unknown): x is Comparison {
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

export function loadComparisons(projectId: string): Comparison[] {
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isComparison);
  } catch {
    return [];
  }
}

export function saveComparisons(
  projectId: string,
  list: Comparison[],
): void {
  try {
    localStorage.setItem(storageKey(projectId), JSON.stringify(list));
  } catch {
    /* quota exceeded or disabled storage; silently drop */
  }
  // Notify all useComparisons hooks in this tab that data changed.
  notifyChange(projectId);
}

function newId(): string {
  // crypto.randomUUID is widely supported in modern browsers/Node; fall back
  // to a timestamp+random string on the off chance it's missing.
  const c =
    typeof globalThis !== "undefined"
      ? (globalThis.crypto as Crypto | undefined)
      : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createComparison(
  projectId: string,
  name: string,
): Comparison {
  const list = loadComparisons(projectId);
  const cmp: Comparison = {
    id: newId(),
    name: name || "Untitled comparison",
    createdAt: new Date().toISOString(),
    cards: [],
  };
  list.push(cmp);
  saveComparisons(projectId, list);
  return cmp;
}

export function renameComparison(
  projectId: string,
  comparisonId: string,
  name: string,
): void {
  const list = loadComparisons(projectId);
  const next = list.map((c) =>
    c.id === comparisonId ? { ...c, name } : c,
  );
  saveComparisons(projectId, next);
}

export function deleteComparison(
  projectId: string,
  comparisonId: string,
): void {
  const list = loadComparisons(projectId);
  const next = list.filter((c) => c.id !== comparisonId);
  saveComparisons(projectId, next);
}

export function addCardToComparison(
  projectId: string,
  comparisonId: string,
  card: Omit<ComparisonCard, "id">,
): void {
  const list = loadComparisons(projectId);
  const next = list.map((c) => {
    if (c.id !== comparisonId) return c;
    const newCard: ComparisonCard = { id: newId(), ...card };
    return { ...c, cards: [...c.cards, newCard] };
  });
  saveComparisons(projectId, next);
}

export function removeCardFromComparison(
  projectId: string,
  comparisonId: string,
  cardId: string,
): void {
  const list = loadComparisons(projectId);
  const next = list.map((c) =>
    c.id === comparisonId
      ? { ...c, cards: c.cards.filter((k) => k.id !== cardId) }
      : c,
  );
  saveComparisons(projectId, next);
}

/**
 * Reactive view of the comparison list for a given project.
 *
 * Re-reads localStorage on mount + when `refresh()` is called. Also listens
 * for the cross-tab `storage` event so another tab's mutations propagate.
 */
// ---------------------------------------------------------------------------
// In-tab notification channel. StorageEvent only fires cross-tab; this
// EventTarget lets all useComparisons hooks in the SAME tab react when
// any component creates, renames, deletes, or adds a card to a comparison.
// ---------------------------------------------------------------------------
const comparisonsChanged = new EventTarget();

function notifyChange(projectId: string) {
  comparisonsChanged.dispatchEvent(new CustomEvent("change", { detail: projectId }));
}

export function useComparisons(projectId: string): {
  comparisons: Comparison[];
  refresh: () => void;
} {
  const [comparisons, setComparisons] = useState<Comparison[]>(() =>
    loadComparisons(projectId),
  );

  const refresh = useCallback(() => {
    setComparisons(loadComparisons(projectId));
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Cross-tab: StorageEvent fires when another tab writes.
  useEffect(() => {
    const key = storageKey(projectId);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key) return;
      setComparisons(loadComparisons(projectId));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [projectId]);

  // Same-tab: listen for writes from other components in this tab.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail === projectId) {
        setComparisons(loadComparisons(projectId));
      }
    };
    comparisonsChanged.addEventListener("change", handler);
    return () => comparisonsChanged.removeEventListener("change", handler);
  }, [projectId]);

  return { comparisons, refresh };
}
