// ---------------------------------------------------------------------------
// Server sync — persist comparisons to the Cairn server
// ---------------------------------------------------------------------------

import { api } from "../../api/client";
import { cardSettingsStorageKey, loadCardSettings, type CardSettingsKey } from "../card-settings";
import { storageKeys } from "../storage";
import type { RunSelector } from "../run-selector";
import { isRunSelector } from "../run-selector";
import type { Comparison, ComparisonCard, SmartFilters } from "./types";
import { cardSettingsKeyForScope, compareRunId } from "./types";
import { loadComparisons, newId, saveComparisons } from "./store";

/**
 * The CardSettingsKey a comparison card's settings actually live under.
 * Thin wrapper around the shared `cardSettingsKeyForScope` — see its doc
 * comment in types.ts for the key-shape rules.
 */
export function cardSettingsKeyFor(comparisonId: string, card: ComparisonCard): CardSettingsKey {
  return cardSettingsKeyForScope(compareRunId(comparisonId), card);
}

/** Build the payload for server storage, including card settings. */
function buildPayload(cmp: Comparison): Record<string, unknown> {
  // Gather card settings from localStorage.
  const cardSettings: Record<string, unknown> = {};
  for (const card of cmp.cards) {
    const settings = loadCardSettings(cardSettingsKeyFor(cmp.id, card));
    if (settings) cardSettings[card.id] = settings;
  }
  return {
    cards: cmp.cards,
    runIds: cmp.runIds,
    smartFilters: cmp.smartFilters,
    runSelector: cmp.runSelector,
    cardSettings,
  };
}

/** Save a single comparison to the server (fire-and-forget). */
export function syncComparisonToServer(projectId: string, cmp: Comparison): void {
  const payload = buildPayload(cmp);
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
          localStorage.setItem(storageKeys.comparisons(projectId), JSON.stringify(updated));
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
          runSelector: isRunSelector(payload.runSelector) ? (payload.runSelector as RunSelector) : undefined,
        };
        local.push(cmp);
        changed = true;

        // Restore card settings from payload.
        const cardSettings = (payload.cardSettings ?? {}) as Record<string, unknown>;
        for (const [cardId, settings] of Object.entries(cardSettings)) {
          if (settings && typeof settings === "object") {
            const card = cmp.cards.find((k) => k.id === cardId);
            const key: CardSettingsKey = card
              ? cardSettingsKeyFor(cmp.id, card)
              : { runId: compareRunId(cmp.id), metricName: cardId, contextHash: "" };
            try {
              localStorage.setItem(cardSettingsStorageKey(key), JSON.stringify(settings));
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
