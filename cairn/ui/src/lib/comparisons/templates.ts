// ---------------------------------------------------------------------------
// Comparison Templates
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { loadJson, saveJson, storageKeys } from "../storage";
import type { ComparisonCard } from "./types";
import { newId } from "./store";

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
