/**
 * Report payload build/restore — mirrors lib/comparisons/sync.ts's
 * buildPayload (:31-44) and the card-settings restore loop in
 * syncComparisonsFromServer (:102-114), adapted for reports' server-native
 * (not local-first) persistence: a report's payload is built right before a
 * PUT and restored right after a GET, rather than synced in the background.
 */

import { cardSettingsStorageKey, loadCardSettings } from "../card-settings";
import { allReportCards, type ReportBlock, type ReportPayload } from "./types";
import { cardSettingsKeyForReport } from "./scope";

/** Build the payload for server storage, including per-card settings. */
export function buildReportPayload(reportId: string, blocks: ReportBlock[]): ReportPayload {
  const cardSettings: Record<string, unknown> = {};
  for (const card of allReportCards(blocks)) {
    const settings = loadCardSettings(cardSettingsKeyForReport(reportId, card));
    if (settings) cardSettings[card.id] = settings;
  }
  return { blocks, cardSettings };
}

/** Restore a loaded report's per-card settings into localStorage under the report's scope. */
export function restoreReportCardSettings(reportId: string, payload: ReportPayload): void {
  const cardSettings = payload.cardSettings ?? {};
  for (const card of allReportCards(payload.blocks ?? [])) {
    const settings = cardSettings[card.id];
    if (settings && typeof settings === "object") {
      const key = cardSettingsKeyForReport(reportId, card);
      try {
        localStorage.setItem(cardSettingsStorageKey(key), JSON.stringify(settings));
      } catch {
        /* ignore */
      }
    }
  }
}
