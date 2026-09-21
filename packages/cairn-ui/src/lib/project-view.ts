/**
 * Per-project default view of the Metrics & Media tab.
 *
 * The card set of a run is derived from what it logged, so "customizing the
 * view" means choosing which of those cards the project shows by default.
 * That choice is scoped to the PROJECT, not the run: removing e.g. the
 * full-dataset card while looking at one run means the next run you open in
 * the same project doesn't show it either.
 *
 * Browser-local (localStorage), like card settings and run layouts — it's a
 * per-viewer preference, not project data.
 *
 * Cards are identified by the `cardKey` convention from lib/run-layout.ts
 * (`"<metricName>::<contextHash>"`), which is stable across runs: the same
 * metric logged under the same context has the same key in every run.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { loadJson, saveJson, storageKeys } from "./storage.ts";

export interface ProjectView {
  version: 1;
  /** cardKeys removed from the default view. */
  hidden: string[];
}

export const EMPTY_PROJECT_VIEW: ProjectView = { version: 1, hidden: [] };

export function loadProjectView(projectId: string): ProjectView {
  const parsed = loadJson<Partial<ProjectView>>(localStorage, storageKeys.projectView(projectId));
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.hidden)) {
    return { ...EMPTY_PROJECT_VIEW };
  }
  return {
    version: 1,
    hidden: parsed.hidden.filter((k): k is string => typeof k === "string"),
  };
}

const viewChanged = new EventTarget();

export function saveProjectView(projectId: string, view: ProjectView): void {
  saveJson(localStorage, storageKeys.projectView(projectId), view);
  viewChanged.dispatchEvent(new CustomEvent("change", { detail: projectId }));
}

/** Remove a card from the project's default view. Returns the new view. */
export function hideCard(projectId: string, cardKey: string): ProjectView {
  const current = loadProjectView(projectId);
  if (current.hidden.includes(cardKey)) return current;
  const next: ProjectView = { version: 1, hidden: [...current.hidden, cardKey] };
  saveProjectView(projectId, next);
  return next;
}

/** Add a previously-removed card back. Returns the new view. */
export function showCard(projectId: string, cardKey: string): ProjectView {
  const current = loadProjectView(projectId);
  if (!current.hidden.includes(cardKey)) return current;
  const next: ProjectView = { version: 1, hidden: current.hidden.filter((k) => k !== cardKey) };
  saveProjectView(projectId, next);
  return next;
}

/** Restore the full default view. Returns the new view. */
export function showAllCards(projectId: string): ProjectView {
  const next: ProjectView = { ...EMPTY_PROJECT_VIEW };
  saveProjectView(projectId, next);
  return next;
}

export interface UseProjectView {
  /** Hidden cardKeys, as a set for render-time lookups. */
  hidden: Set<string>;
  /** null when there's no ambient project (the view can't be customized). */
  hide: ((cardKey: string) => void) | null;
  show: (cardKey: string) => void;
  showAll: () => void;
}

/**
 * Read/write the project's default view, staying in sync with other
 * components in this tab (EventTarget) and other tabs (StorageEvent) — the
 * same pattern comparison templates use.
 */
export function useProjectView(projectId: string | null): UseProjectView {
  const [view, setView] = useState<ProjectView>(() =>
    projectId ? loadProjectView(projectId) : { ...EMPTY_PROJECT_VIEW },
  );

  useEffect(() => {
    setView(projectId ? loadProjectView(projectId) : { ...EMPTY_PROJECT_VIEW });
  }, [projectId]);

  // Same-tab: another component (or another CardGrid) changed the view.
  useEffect(() => {
    if (!projectId) return;
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail === projectId) setView(loadProjectView(projectId));
    };
    viewChanged.addEventListener("change", handler);
    return () => viewChanged.removeEventListener("change", handler);
  }, [projectId]);

  // Cross-tab.
  useEffect(() => {
    if (!projectId) return;
    const key = storageKeys.projectView(projectId);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key) return;
      setView(loadProjectView(projectId));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [projectId]);

  const hide = useCallback(
    (cardKey: string) => {
      if (!projectId) return;
      setView(hideCard(projectId, cardKey));
    },
    [projectId],
  );

  const show = useCallback(
    (cardKey: string) => {
      if (!projectId) return;
      setView(showCard(projectId, cardKey));
    },
    [projectId],
  );

  const showAll = useCallback(() => {
    if (!projectId) return;
    setView(showAllCards(projectId));
  }, [projectId]);

  const hidden = useMemo(() => new Set(view.hidden), [view]);

  return { hidden, hide: projectId ? hide : null, show, showAll };
}
