/**
 * The pseudo-run id under which a report's cards scope their settings —
 * exactly parallel to `compareRunId` in lib/comparisons/types.ts (see
 * lib/storage.ts's `report:`-prefix handling in run-scoped key GC).
 */

import type { CardSettingsKey } from "../card-settings";
import { cardSettingsKeyForScope, type ComparisonCard } from "../comparisons";

export function reportRunId(reportId: string): string {
  return `report:${reportId}`;
}

/**
 * The CardSettingsKey a report card's settings actually live under. Thin
 * wrapper around the same `cardSettingsKeyForScope` comparisons use — do not
 * fork the key-shape convention, see its doc comment in
 * lib/comparisons/types.ts.
 */
export function cardSettingsKeyForReport(reportId: string, card: ComparisonCard): CardSettingsKey {
  return cardSettingsKeyForScope(reportRunId(reportId), card);
}
