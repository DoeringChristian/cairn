// ---------------------------------------------------------------------------
// Comparison Templates
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { loadJson, saveJson, storageKeys } from "../storage";
import type { ComparisonCard } from "./types";
import { newId } from "./store";
import { deleteTemplateFromServer, syncTemplateToServer, syncTemplatesFromServer } from "./template-sync";

export interface ComparisonTemplateCard {
  type: ComparisonCard["type"];
  metricName: string;
  /**
   * Context hash of the original card's primary series ("" = no context).
   * Lets `matchTemplateCards` prefer the same context when a run emits the
   * same metric name under several contexts (e.g. train/val). Absent on
   * templates saved before this field existed or on multi-run cards, where
   * it's meaningless — both are treated as "no preference".
   */
  contextHash?: string;
  settings?: Record<string, unknown>;
}

export interface ComparisonTemplate {
  id: string;
  name: string;
  createdAt: string;
  cards: ComparisonTemplateCard[];
  /** Server-side ID (set after first save to server). */
  serverId?: string;
}

function isComparisonTemplate(x: unknown): x is ComparisonTemplate {
  if (!x || typeof x !== "object") return false;
  const t = x as Partial<ComparisonTemplate>;
  return (
    typeof t.id === "string" &&
    typeof t.name === "string" &&
    Array.isArray(t.cards)
  );
}

export function loadTemplates(projectId: string): ComparisonTemplate[] {
  const parsed = loadJson<unknown[]>(localStorage, storageKeys.comparisonTemplates(projectId));
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isComparisonTemplate);
}

export function saveTemplates(
  projectId: string,
  list: ComparisonTemplate[],
): void {
  saveJson(localStorage, storageKeys.comparisonTemplates(projectId), list);
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
  syncTemplateToServer(projectId, tmpl);
  return tmpl;
}

export function deleteTemplate(
  projectId: string,
  templateId: string,
): void {
  const list = loadTemplates(projectId);
  const tmpl = list.find((t) => t.id === templateId);
  if (tmpl?.serverId) deleteTemplateFromServer(projectId, tmpl.serverId);
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

  // Pull from the server on mount: merge server-only templates into
  // localStorage, push local-only ones up. Fire-and-forget, offline
  // tolerant — mirrors comparisons' syncComparisonsFromServer, but
  // triggered from the hook itself since templates are read from both
  // RunsTablePage and ComparePage.
  useEffect(() => {
    if (!projectId) return;
    syncTemplatesFromServer(projectId).then(refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Same-tab: another component in this tab created/deleted a template.
  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail === projectId) setTemplates(loadTemplates(projectId));
    };
    templatesChanged.addEventListener("change", handler);
    return () => templatesChanged.removeEventListener("change", handler);
  }, [projectId]);

  // Cross-tab: StorageEvent fires when another tab writes (fix #5 — was
  // previously missing, so a template saved in one tab never appeared in
  // another without a manual reload).
  useEffect(() => {
    const key = storageKeys.comparisonTemplates(projectId);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key) return;
      setTemplates(loadTemplates(projectId));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [projectId]);

  return { templates, refresh };
}
