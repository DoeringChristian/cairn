// ---------------------------------------------------------------------------
// Report templates
// ---------------------------------------------------------------------------
//
// Reuses the exact `ComparisonTemplateCard` shape (and, by structural typing,
// `ComparisonTemplate` itself) from lib/comparisons/templates.ts — a
// template's cards (multi-run cards keyed by type, series cards by
// metricName + contextHash + settings) mean the same thing whether they
// were captured from a comparison or a report, so `applyReportTemplateToRuns`
// (apply-template.ts) can reuse `matchTemplateCards`/`buildSeqMap` from
// lib/comparisons/apply-template.ts verbatim instead of re-implementing
// matching. Only the storage (own localStorage key + server table) and
// create/delete plumbing are report-specific.

import { useCallback, useEffect, useState } from "react";
import { loadJson, saveJson, storageKeys } from "../storage";
import type { ComparisonTemplate, ComparisonTemplateCard } from "../comparisons";
import { newId } from "./ids";
import {
  deleteReportTemplateFromServer,
  syncReportTemplateToServer,
  syncReportTemplatesFromServer,
} from "./template-sync";

/** Same shape as a comparison template — see the module doc comment above. */
export type ReportTemplate = ComparisonTemplate;
export type ReportTemplateCard = ComparisonTemplateCard;

function isReportTemplate(x: unknown): x is ReportTemplate {
  if (!x || typeof x !== "object") return false;
  const t = x as Partial<ReportTemplate>;
  return typeof t.id === "string" && typeof t.name === "string" && Array.isArray(t.cards);
}

export function loadReportTemplates(projectId: string): ReportTemplate[] {
  const parsed = loadJson<unknown[]>(localStorage, storageKeys.reportTemplates(projectId));
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isReportTemplate);
}

export function saveReportTemplates(projectId: string, list: ReportTemplate[]): void {
  saveJson(localStorage, storageKeys.reportTemplates(projectId), list);
  reportTemplatesChanged.dispatchEvent(new CustomEvent("change", { detail: projectId }));
}

export function createReportTemplate(
  projectId: string,
  name: string,
  cards: ReportTemplateCard[],
): ReportTemplate {
  const list = loadReportTemplates(projectId);
  const tmpl: ReportTemplate = {
    id: newId(),
    name: name || "Untitled template",
    createdAt: new Date().toISOString(),
    cards,
  };
  list.push(tmpl);
  saveReportTemplates(projectId, list);
  syncReportTemplateToServer(projectId, tmpl);
  return tmpl;
}

export function deleteReportTemplate(projectId: string, templateId: string): void {
  const list = loadReportTemplates(projectId);
  const tmpl = list.find((t) => t.id === templateId);
  if (tmpl?.serverId) deleteReportTemplateFromServer(projectId, tmpl.serverId);
  saveReportTemplates(projectId, list.filter((t) => t.id !== templateId));
}

const reportTemplatesChanged = new EventTarget();

export function useReportTemplates(projectId: string): {
  templates: ReportTemplate[];
  refresh: () => void;
} {
  const [templates, setTemplates] = useState<ReportTemplate[]>(() => loadReportTemplates(projectId));

  const refresh = useCallback(() => {
    setTemplates(loadReportTemplates(projectId));
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Pull from the server on mount — mirrors comparisons' useTemplates.
  useEffect(() => {
    if (!projectId) return;
    syncReportTemplatesFromServer(projectId).then(refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Same-tab.
  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail === projectId) setTemplates(loadReportTemplates(projectId));
    };
    reportTemplatesChanged.addEventListener("change", handler);
    return () => reportTemplatesChanged.removeEventListener("change", handler);
  }, [projectId]);

  // Cross-tab.
  useEffect(() => {
    const key = storageKeys.reportTemplates(projectId);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key) return;
      setTemplates(loadReportTemplates(projectId));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [projectId]);

  return { templates, refresh };
}
