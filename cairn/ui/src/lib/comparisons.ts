/**
 * Named, persisted multi-comparison storage.
 *
 * Comparisons are stored in both localStorage (for instant UI) and on the
 * server (for cross-browser persistence). The localStorage copy acts as the
 * working copy; server sync happens in the background.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { loadCardSettings, type CardSettingsKey } from "./card-settings";

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
  /** Explicit run IDs for this comparison (used by AddCardModal when no cards exist yet). */
  runIds?: string[];
  /** When present, the comparison was created by the Smart Wizard and can be refreshed. */
  smartFilters?: SmartFilters;
  /** Server-side ID (set after first save to server). */
  serverId?: string;
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
  const cmp = next.find((c) => c.id === comparisonId);
  if (cmp) syncComparisonToServer(projectId, cmp);
}

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
): void {
  const list = loadComparisons(projectId);
  const next = list.map((c) => {
    if (c.id !== comparisonId) return c;
    const newCard: ComparisonCard = { id: newId(), ...card };
    return { ...c, cards: [...c.cards, newCard] };
  });
  saveComparisons(projectId, next);
  const cmp = next.find((c) => c.id === comparisonId);
  if (cmp) syncComparisonToServer(projectId, cmp);
}

export function addRunsToComparison(
  projectId: string,
  comparisonId: string,
  runIds: string[],
): void {
  if (runIds.length === 0) return;
  const list = loadComparisons(projectId);
  const next = list.map((c) => {
    if (c.id !== comparisonId) return c;
    const existing = new Set(c.runIds ?? []);
    for (const id of runIds) existing.add(id);
    return { ...c, runIds: Array.from(existing) };
  });
  saveComparisons(projectId, next);
  const cmp = next.find((c) => c.id === comparisonId);
  if (cmp) syncComparisonToServer(projectId, cmp);
}

export function removeRunFromComparison(
  projectId: string,
  comparisonId: string,
  runId: string,
): void {
  const list = loadComparisons(projectId);
  const next = list.map((c) => {
    if (c.id !== comparisonId) return c;
    const filteredRunIds = (c.runIds ?? []).filter((id) => id !== runId);
    // Also remove the run's series from every card.
    const filteredCards = c.cards.map((card) => ({
      ...card,
      series: card.series.filter((s) => s.runId !== runId),
    }));
    return { ...c, runIds: filteredRunIds, cards: filteredCards };
  });
  saveComparisons(projectId, next);
  const cmp = next.find((c) => c.id === comparisonId);
  if (cmp) syncComparisonToServer(projectId, cmp);
}

export function reorderComparisonCards(
  projectId: string,
  comparisonId: string,
  fromId: string,
  toId: string,
): void {
  const list = loadComparisons(projectId);
  const next = list.map((c) => {
    if (c.id !== comparisonId) return c;
    const cards = [...c.cards];
    const fromIdx = cards.findIndex((k) => k.id === fromId);
    const toIdx = cards.findIndex((k) => k.id === toId);
    if (fromIdx < 0 || toIdx < 0) return c;
    const [moved] = cards.splice(fromIdx, 1);
    cards.splice(toIdx, 0, moved!);
    return { ...c, cards };
  });
  saveComparisons(projectId, next);
  const cmp = next.find((c) => c.id === comparisonId);
  if (cmp) syncComparisonToServer(projectId, cmp);
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
  const cmp = next.find((c) => c.id === comparisonId);
  if (cmp) syncComparisonToServer(projectId, cmp);
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

// ---------------------------------------------------------------------------
// Comparison Templates
// ---------------------------------------------------------------------------

export interface ComparisonTemplateCard {
  type: ComparisonCard["type"];
  metricName: string;
  settings?: Record<string, unknown>;
}

export interface ComparisonTemplate {
  id: string;
  name: string;
  createdAt: string;
  cards: ComparisonTemplateCard[];
}

function templateStorageKey(projectId: string): string {
  return `cairn:comparison-templates:${projectId}`;
}

export function loadTemplates(projectId: string): ComparisonTemplate[] {
  try {
    const raw = localStorage.getItem(templateStorageKey(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is ComparisonTemplate =>
        !!t &&
        typeof t === "object" &&
        typeof t.id === "string" &&
        typeof t.name === "string" &&
        Array.isArray(t.cards),
    );
  } catch {
    return [];
  }
}

export function saveTemplates(
  projectId: string,
  list: ComparisonTemplate[],
): void {
  try {
    localStorage.setItem(templateStorageKey(projectId), JSON.stringify(list));
  } catch {
    /* quota exceeded */
  }
  templatesChanged.dispatchEvent(new CustomEvent("change", { detail: projectId }));
}

export function createTemplate(
  projectId: string,
  name: string,
  cards: ComparisonTemplateCard[],
): ComparisonTemplate {
  const list = loadTemplates(projectId);
  const tmpl: ComparisonTemplate = {
    id: newId(),
    name: name || "Untitled template",
    createdAt: new Date().toISOString(),
    cards,
  };
  list.push(tmpl);
  saveTemplates(projectId, list);
  return tmpl;
}

export function deleteTemplate(
  projectId: string,
  templateId: string,
): void {
  const list = loadTemplates(projectId);
  saveTemplates(projectId, list.filter((t) => t.id !== templateId));
}

const templatesChanged = new EventTarget();

export function useTemplates(projectId: string): {
  templates: ComparisonTemplate[];
  refresh: () => void;
} {
  const [templates, setTemplates] = useState<ComparisonTemplate[]>(() =>
    loadTemplates(projectId),
  );

  const refresh = useCallback(() => {
    setTemplates(loadTemplates(projectId));
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail === projectId) setTemplates(loadTemplates(projectId));
    };
    templatesChanged.addEventListener("change", handler);
    return () => templatesChanged.removeEventListener("change", handler);
  }, [projectId]);

  return { templates, refresh };
}

// ---------------------------------------------------------------------------
// Server sync — persist comparisons to the Cairn server
// ---------------------------------------------------------------------------

/** Build the payload for server storage, including card settings. */
function buildPayload(projectId: string, cmp: Comparison): Record<string, unknown> {
  // Gather card settings from localStorage.
  const cardSettings: Record<string, unknown> = {};
  for (const card of cmp.cards) {
    const key: CardSettingsKey = {
      runId: `compare:${cmp.id}`,
      metricName: card.id,
      contextHash: "",
    };
    const settings = loadCardSettings(key);
    if (settings) cardSettings[card.id] = settings;
  }
  return {
    cards: cmp.cards,
    runIds: cmp.runIds,
    smartFilters: cmp.smartFilters,
    cardSettings,
  };
}

/** Save a single comparison to the server (fire-and-forget). */
export function syncComparisonToServer(projectId: string, cmp: Comparison): void {
  const payload = buildPayload(projectId, cmp);
  if (cmp.serverId) {
    api.updateServerComparison(projectId, cmp.serverId, { name: cmp.name, payload }).catch(() => {});
  } else {
    api.createServerComparison(projectId, cmp.name, payload)
      .then((res) => {
        // Store the server ID back into localStorage.
        const list = loadComparisons(projectId);
        const updated = list.map((c) =>
          c.id === cmp.id ? { ...c, serverId: res.id } : c,
        );
        try {
          localStorage.setItem(storageKey(projectId), JSON.stringify(updated));
        } catch { /* ignore */ }
      })
      .catch(() => {});
  }
}

/** Delete a comparison from the server. */
export function deleteComparisonFromServer(projectId: string, serverId: string): void {
  api.deleteServerComparison(projectId, serverId).catch(() => {});
}

/** Pull all comparisons from the server and merge with localStorage.
 *  Server comparisons that don't exist locally are added.
 *  Local comparisons without a serverId are pushed to the server. */
export async function syncComparisonsFromServer(projectId: string): Promise<void> {
  try {
    const { comparisons: serverList } = await api.comparisons(projectId);
    const local = loadComparisons(projectId);
    const localServerIds = new Set(local.map((c) => c.serverId).filter(Boolean));
    let changed = false;

    // Add server-only comparisons to local.
    for (const sc of serverList) {
      if (localServerIds.has(sc.id)) continue;
      // Fetch full payload.
      try {
        const full = await api.comparison(projectId, sc.id);
        const payload = full.payload as Record<string, unknown>;
        const cards = (payload.cards ?? []) as ComparisonCard[];
        const cmp: Comparison = {
          id: newId(),
          serverId: sc.id,
          name: sc.name,
          createdAt: sc.created_at,
          cards,
          runIds: payload.runIds as string[] | undefined,
          smartFilters: payload.smartFilters as SmartFilters | undefined,
        };
        local.push(cmp);
        changed = true;

        // Restore card settings from payload.
        const cardSettings = (payload.cardSettings ?? {}) as Record<string, unknown>;
        for (const [cardId, settings] of Object.entries(cardSettings)) {
          if (settings && typeof settings === "object") {
            const key: CardSettingsKey = {
              runId: `compare:${cmp.id}`,
              metricName: cardId,
              contextHash: "",
            };
            try {
              localStorage.setItem(
                `cairn:card-settings:${key.runId}:${key.metricName}:${key.contextHash}`,
                JSON.stringify(settings),
              );
            } catch { /* ignore */ }
          }
        }
      } catch { /* skip failed fetches */ }
    }

    // Push local-only comparisons to server.
    for (const c of local) {
      if (!c.serverId) {
        syncComparisonToServer(projectId, c);
      }
    }

    if (changed) {
      saveComparisons(projectId, local);
    }
  } catch {
    // Server unavailable — work offline from localStorage.
  }
}
