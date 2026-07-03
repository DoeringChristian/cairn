// ---------------------------------------------------------------------------
// Server sync — persist report templates to the Cairn server
// ---------------------------------------------------------------------------
//
// Mirrors lib/comparisons/template-sync.ts exactly, targeting the
// report-templates endpoints instead.

import { api } from "../../api/client";
import { storageKeys } from "../storage";
import type { ReportTemplate } from "./templates";
import { loadReportTemplates, saveReportTemplates } from "./templates";

function buildTemplatePayload(tmpl: ReportTemplate): Record<string, unknown> {
  return { cards: tmpl.cards };
}

/** Save a single report template to the server (fire-and-forget). */
export function syncReportTemplateToServer(projectId: string, tmpl: ReportTemplate): void {
  const payload = buildTemplatePayload(tmpl);
  if (tmpl.serverId) {
    api.updateServerReportTemplate(projectId, tmpl.serverId, { name: tmpl.name, payload }).catch(() => {});
  } else {
    api.createServerReportTemplate(projectId, tmpl.name, payload)
      .then((res) => {
        const list = loadReportTemplates(projectId);
        const updated = list.map((t) => (t.id === tmpl.id ? { ...t, serverId: res.id } : t));
        try {
          localStorage.setItem(storageKeys.reportTemplates(projectId), JSON.stringify(updated));
        } catch { /* ignore */ }
      })
      .catch(() => {});
  }
}

/** Delete a report template from the server. */
export function deleteReportTemplateFromServer(projectId: string, serverId: string): void {
  api.deleteServerReportTemplate(projectId, serverId).catch(() => {});
}

/** Pull all report templates from the server and merge with localStorage. */
export async function syncReportTemplatesFromServer(projectId: string): Promise<void> {
  try {
    const { report_templates: serverList } = await api.reportTemplates(projectId);
    const local = loadReportTemplates(projectId);
    const localServerIds = new Set(local.map((t) => t.serverId).filter(Boolean));
    let changed = false;

    for (const st of serverList) {
      if (localServerIds.has(st.id)) continue;
      try {
        const full = await api.reportTemplate(projectId, st.id);
        const payload = full.payload as Record<string, unknown>;
        const cards = (payload.cards ?? []) as ReportTemplate["cards"];
        const tmpl: ReportTemplate = {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
          serverId: st.id,
          name: st.name,
          createdAt: st.created_at,
          cards,
        };
        local.push(tmpl);
        changed = true;
      } catch { /* skip failed fetches */ }
    }

    for (const t of local) {
      if (!t.serverId) {
        syncReportTemplateToServer(projectId, t);
      }
    }

    if (changed) {
      saveReportTemplates(projectId, local);
    }
  } catch {
    // Server unavailable — work offline from localStorage.
  }
}
