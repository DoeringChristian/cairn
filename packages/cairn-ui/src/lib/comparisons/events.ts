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

import { useCallback, useEffect, useState } from "react";
import { storageKeys } from "../storage";
import type { Comparison } from "./types";
import { loadComparisons } from "./store";

const comparisonsChanged = new EventTarget();

export function notifyChange(projectId: string) {
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
    const key = storageKeys.comparisons(projectId);
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
