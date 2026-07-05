/**
 * Per-card settings persisted to localStorage.
 *
 * Each card type owns its own TS interface (ScalarSettings, ImageSettings, …),
 * all carrying a `version: 1` discriminator. Settings are keyed by
 * (runId, metricName, contextHash) so two cards for the same metric but
 * different contexts (e.g. train/val) have independent settings.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { loadJson, saveJson, storageKeys } from "./storage";

/**
 * WS-NR1 deliverable 2 (bug (c) / B7): whether the card tree currently
 * mounted under this context may mutate its own persisted settings —
 * step/iteration, compare mode, yScale, smoothing, collapse/resize, … all
 * flow through the *one* choke point below (`useCardSettings`'s
 * `updateSettings`/`reset`), so gating it here freezes a card's entire
 * saved config in one place instead of threading a `readOnly`/`editMode`
 * prop through every one of the ~20 individual card components.
 *
 * Default `true` (mutable) — every existing call site (the Metrics & Media
 * tab, ComparePage, …) that never wraps its tree in a
 * `<CardMutationContext.Provider>` keeps behaving exactly as before. Only
 * report surfaces (`ReportCardsBlock`/`CairnFenceCard`) provide `false` for
 * a card rendered in VIEW mode — see their docs for why this is the fix for
 * "interactive controls write localStorage in view mode, and the next
 * `restoreReportCardSettings` silently clobbers the change anyway."
 *
 * Two hooks that maintain settings-shaped local UI state *outside*
 * `useCardSettings` itself also read this directly, so their own local
 * mirror state freezes in lockstep (a no-op `updateSettings` alone isn't
 * enough for them — see each's doc): `card-kit/use-step-slider.ts` and
 * `ArtifactCard.tsx`'s bespoke slider index.
 */
export const CardMutationContext = createContext<boolean>(true);

export type CardSettingsKey = {
  runId: string;
  metricName: string;
  contextHash: string;
};

export function cardSettingsStorageKey(key: CardSettingsKey): string {
  return storageKeys.cardSettings(key.runId, key.metricName, key.contextHash);
}

/**
 * Load persisted card settings, discarding anything not tagged with the
 * current `version: 1`. Every historical write includes `version: 1` (see
 * each card's `DEFAULT_SETTINGS`, which `useCardSettings` always merges
 * under persisted overrides before saving), so this check is a no-op for
 * real data — it only guards against a future version bump or corrupted
 * storage.
 */
export function loadCardSettings<T>(key: CardSettingsKey): T | null {
  const parsed = loadJson<{ version?: unknown }>(localStorage, cardSettingsStorageKey(key));
  if (parsed === null || parsed.version !== 1) return null;
  return parsed as T;
}

export function saveCardSettings<T>(key: CardSettingsKey, value: T): void {
  saveJson(localStorage, cardSettingsStorageKey(key), value);
}

export function resetCardSettings(key: CardSettingsKey): void {
  try {
    localStorage.removeItem(cardSettingsStorageKey(key));
  } catch {
    /* ignore */
  }
}

/**
 * Hook that synchronizes a card's settings with localStorage.
 *
 * Returns:
 *   [settings, updateSettings, resetSettings]
 *
 * - settings: current merged settings (defaults + persisted overrides).
 * - updateSettings(patch): shallow merge the patch over current settings and save.
 * - resetSettings(): clear localStorage and revert to defaults.
 *
 * Re-renders when the settings change. The returned updater/resetter have
 * stable identity across renders (only change when the storage key or the
 * mutation gate changes — see `CardMutationContext`).
 *
 * When `CardMutationContext` reads `false` (a report card in VIEW mode),
 * `updateSettings`/`reset` become no-ops: they neither touch localStorage
 * nor update local state, so the card stays visually fixed at its loaded
 * settings regardless of what an interactive control tries to write.
 */
export function useCardSettings<T extends { version: number }>(
  key: CardSettingsKey,
  defaults: T,
): [T, (patch: Partial<T>) => void, () => void] {
  const storageKey = cardSettingsStorageKey(key);
  const mutable = useContext(CardMutationContext);

  // Keep the latest `defaults` in a ref so we can merge on load without
  // adding `defaults` as an effect dep (which would thrash on every render
  // given most callers pass a fresh object literal).
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;

  // Keep the latest `settings` in a ref so the updater can shallow-merge
  // against it without listing it as a dep.
  const settingsRef = useRef<T>({
    ...defaults,
    ...(loadCardSettings<Partial<T>>(key) ?? {}),
  });

  const [settings, setSettings] = useState<T>(() => settingsRef.current);

  // Reload from storage whenever the storage key changes (e.g. the card
  // switched metrics). Don't include `defaults` in deps — only a key change
  // should trigger a reload.
  useEffect(() => {
    const loaded = loadCardSettings<Partial<T>>(key);
    const merged = { ...defaultsRef.current, ...(loaded ?? {}) } as T;
    settingsRef.current = merged;
    setSettings(merged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const updateSettings = useCallback(
    (patch: Partial<T>) => {
      if (!mutable) return;
      const next = { ...settingsRef.current, ...patch } as T;
      settingsRef.current = next;
      setSettings(next);
      saveCardSettings<T>(key, next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storageKey, mutable],
  );

  const reset = useCallback(
    () => {
      if (!mutable) return;
      resetCardSettings(key);
      const fresh = { ...defaultsRef.current } as T;
      settingsRef.current = fresh;
      setSettings(fresh);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storageKey, mutable],
  );

  return [settings, updateSettings, reset];
}

/**
 * Resolve the effective card height for the current colSpan.
 *
 * Cards store per-colSpan heights in a `heights` record keyed by span
 * (e.g. `{ 3: 350, 6: 500 }`). The legacy `height`, `height1`, and
 * `height2` fields are used as fallbacks for backward compatibility.
 *
 * @param settings  - card settings object
 * @param fallback  - default height when nothing is set (e.g. 300, 350, undefined)
 * @param minHeight - optional per-card-type minimum; when given, a resolved
 *   (non-undefined) height is clamped up to it. This is the SINGLE own-min
 *   read-time clamp — CardShell (outer box) and any inner content that reads
 *   the same height must pass the same value so they agree (guards a stale /
 *   undersized persisted height). Callers get the min from
 *   card-kit/card-min-sizes::cardMinSize; this module stays kind-agnostic.
 */
export function resolveCardHeight(
  settings: { height?: number; height1?: number; height2?: number; heights?: Record<number, number>; colSpan?: number; collapsed?: boolean },
  fallback?: number,
  minHeight?: number,
): number | undefined {
  if (settings.collapsed) return undefined;
  const span = settings.colSpan ?? 3;

  // New path: per-span heights record
  let resolved: number | undefined;
  if (settings.heights && settings.heights[span] != null) {
    resolved = settings.heights[span];
  } else if (span > 1) {
    // Legacy fallback: height2 (span > 1) / height1 (span 1)
    resolved = settings.height2 ?? settings.height ?? fallback;
  } else {
    resolved = settings.height1 ?? settings.height ?? fallback;
  }

  if (resolved == null) return undefined;
  return minHeight != null ? Math.max(resolved, minHeight) : resolved;
}

