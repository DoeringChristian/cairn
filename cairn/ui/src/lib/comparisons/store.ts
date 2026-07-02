/**
 * Named, persisted multi-comparison storage.
 *
 * Comparisons are stored in both localStorage (for instant UI) and on the
 * server (for cross-browser persistence). The localStorage copy acts as the
 * working copy; server sync happens in the background — see sync.ts.
 */

import { loadJson, saveJson, storageKeys } from "../storage";
import type { Comparison, ComparisonCard } from "./types";
import { isComparison } from "./types";
import { notifyChange } from "./events";
import { deleteComparisonFromServer, syncComparisonToServer } from "./sync";

export function newId(): string {
  // crypto.randomUUID is widely supported in modern browsers/Node; fall back
  // to a timestamp+random string on the off chance it's missing.
  const c =
    typeof globalThis !== "undefined"
      ? (globalThis.crypto as Crypto | undefined)
      : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function loadComparisons(projectId: string): Comparison[] {
  const parsed = loadJson<unknown[]>(localStorage, storageKeys.comparisons(projectId));
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isComparison);
}

export function saveComparisons(
  projectId: string,
  list: Comparison[],
): void {
  saveJson(localStorage, storageKeys.comparisons(projectId), list);
  // Notify all useComparisons hooks in this tab that data changed.
  notifyChange(projectId);
}

export function createComparison(
  projectId: string,
  name: string,
  runIds?: string[],
): Comparison {
  const list = loadComparisons(projectId);
  const cmp: Comparison = {
    id: newId(),
    name: name || "Untitled comparison",
    createdAt: new Date().toISOString(),
    cards: [],
    runIds,
  };
  list.push(cmp);
  saveComparisons(projectId, list);
  return cmp;
}

/**
 * Load the comparison list, map the comparison with id `id` through `fn`,
 * save, then fire-and-forget sync the updated comparison to the server.
 *
 * Collapses the load→map→save→find→sync sequence shared by the field-level
 * mutators below. If `id` isn't found, `fn` is never invoked, the list is
 * saved unchanged, and no server sync happens — matching the original
 * per-mutator silent no-op behavior for an unknown id.
 */
export function updateComparison(
  projectId: string,
  id: string,
  fn: (c: Comparison) => Comparison,
): Comparison | null {
  const list = loadComparisons(projectId);
  const next = list.map((c) => (c.id === id ? fn(c) : c));
  saveComparisons(projectId, next);
  const cmp = next.find((c) => c.id === id) ?? null;
  if (cmp) syncComparisonToServer(projectId, cmp);
  return cmp;
}

export function renameComparison(
  projectId: string,
  comparisonId: string,
  name: string,
): void {
  updateComparison(projectId, comparisonId, (c) => ({ ...c, name }));
}

// deleteComparison removes an entry from the list rather than mapping one in
// place, so it doesn't fit updateComparison's (load→map→save) shape — kept
// as its own implementation.
export function deleteComparison(
  projectId: string,
  comparisonId: string,
): void {
  const list = loadComparisons(projectId);
  const cmp = list.find((c) => c.id === comparisonId);
  if (cmp?.serverId) deleteComparisonFromServer(projectId, cmp.serverId);
  const next = list.filter((c) => c.id !== comparisonId);
  saveComparisons(projectId, next);
}

export function addCardToComparison(
  projectId: string,
  comparisonId: string,
  card: Omit<ComparisonCard, "id">,
): string {
  const newCard: ComparisonCard = { id: newId(), ...card };
  updateComparison(projectId, comparisonId, (c) => ({
    ...c,
    cards: [...c.cards, newCard],
  }));
  return newCard.id;
}

export function addCardsToComparison(
  projectId: string,
  comparisonId: string,
  cards: Omit<ComparisonCard, "id">[],
): void {
  updateComparison(projectId, comparisonId, (c) => {
    const newCards = cards.map((card) => ({ id: newId(), ...card }));
    return { ...c, cards: [...c.cards, ...newCards] };
  });
}

export function addRunsToComparison(
  projectId: string,
  comparisonId: string,
  runIds: string[],
): void {
  if (runIds.length === 0) return;
  updateComparison(projectId, comparisonId, (c) => {
    const existing = new Set(c.runIds ?? []);
    for (const id of runIds) existing.add(id);
    return { ...c, runIds: Array.from(existing) };
  });
}

export function removeRunFromComparison(
  projectId: string,
  comparisonId: string,
  runId: string,
): void {
  updateComparison(projectId, comparisonId, (c) => {
    const filteredRunIds = (c.runIds ?? []).filter((id) => id !== runId);
    // Also remove the run's series from every card.
    const filteredCards = c.cards.map((card) => ({
      ...card,
      series: card.series.filter((s) => s.runId !== runId),
    }));
    return { ...c, runIds: filteredRunIds, cards: filteredCards };
  });
}

export function reorderComparisonCards(
  projectId: string,
  comparisonId: string,
  fromId: string,
  toId: string,
): void {
  updateComparison(projectId, comparisonId, (c) => {
    const cards = [...c.cards];
    const fromIdx = cards.findIndex((k) => k.id === fromId);
    const toIdx = cards.findIndex((k) => k.id === toId);
    if (fromIdx < 0 || toIdx < 0) return c;
    const [moved] = cards.splice(fromIdx, 1);
    cards.splice(toIdx, 0, moved!);
    return { ...c, cards };
  });
}

export function removeCardFromComparison(
  projectId: string,
  comparisonId: string,
  cardId: string,
): void {
  updateComparison(projectId, comparisonId, (c) => ({
    ...c,
    cards: c.cards.filter((k) => k.id !== cardId),
  }));
}
