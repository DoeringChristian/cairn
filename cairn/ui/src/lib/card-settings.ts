/**
 * Per-card settings persisted to localStorage.
 *
 * Each card type owns its own TS interface (ScalarSettings, ImageSettings, …),
 * all carrying a `version: 1` discriminator. Settings are keyed by
 * (runId, metricName, contextHash) so two cards for the same metric but
 * different contexts (e.g. train/val) have independent settings.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type CardSettingsKey = {
  runId: string;
  metricName: string;
  contextHash: string;
};

export function cardSettingsStorageKey(key: CardSettingsKey): string {
  return `cairn:card-settings:${key.runId}:${key.metricName}:${key.contextHash}`;
}

export function loadCardSettings<T>(key: CardSettingsKey): T | null {
  try {
    const raw = localStorage.getItem(cardSettingsStorageKey(key));
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function saveCardSettings<T>(key: CardSettingsKey, value: T): void {
  try {
    localStorage.setItem(cardSettingsStorageKey(key), JSON.stringify(value));
  } catch {
    /* quota exceeded or disabled storage; silently drop */
  }
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
 * stable identity across renders (only change when the storage key changes).
 */
export function useCardSettings<T extends { version: number }>(
  key: CardSettingsKey,
  defaults: T,
): [T, (patch: Partial<T>) => void, () => void] {
  const storageKey = cardSettingsStorageKey(key);

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
      const next = { ...settingsRef.current, ...patch } as T;
      settingsRef.current = next;
      setSettings(next);
      saveCardSettings<T>(key, next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storageKey],
  );

  const reset = useCallback(
    () => {
      resetCardSettings(key);
      const fresh = { ...defaultsRef.current } as T;
      settingsRef.current = fresh;
      setSettings(fresh);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storageKey],
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
 */
export function resolveCardHeight(
  settings: { height?: number; height1?: number; height2?: number; heights?: Record<number, number>; colSpan?: number; collapsed?: boolean },
  fallback?: number,
): number | undefined {
  if (settings.collapsed) return undefined;
  const span = settings.colSpan ?? 3;

  // New path: per-span heights record
  if (settings.heights && settings.heights[span] != null) {
    return settings.heights[span];
  }

  // Legacy fallback: height1 (span 1) / height2 (span > 1)
  if (span > 1) return settings.height2 ?? settings.height ?? fallback;
  return settings.height1 ?? settings.height ?? fallback;
}

