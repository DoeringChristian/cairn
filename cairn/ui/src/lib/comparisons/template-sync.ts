// ---------------------------------------------------------------------------
// Server sync — persist comparison templates to the Cairn server
// ---------------------------------------------------------------------------
//
// Mirrors comparisons/sync.ts. Templates are simpler than comparisons: every
// card's settings live inline on the template card itself (`settings`), so
// — unlike comparisons, which gather settings from localStorage via
// cardSettingsKeyFor — there's no separate settings-restore step here.

import { api } from "../../api/client";
import { storageKeys } from "../storage";
import type { ComparisonTemplate } from "./templates";
import { loadTemplates, saveTemplates } from "./templates";

/** Build the payload for server storage. */
function buildTemplatePayload(tmpl: ComparisonTemplate): Record<string, unknown> {
  return { cards: tmpl.cards };
}

/** Save a single template to the server (fire-and-forget). */
export function syncTemplateToServer(projectId: string, tmpl: ComparisonTemplate): void {
  const payload = buildTemplatePayload(tmpl);
  if (tmpl.serverId) {
    api.updateServerComparisonTemplate(projectId, tmpl.serverId, { name: tmpl.name, payload }).catch(() => {});
  } else {
    api.createServerComparisonTemplate(projectId, tmpl.name, payload)
      .then((res) => {
        // Store the server ID back into localStorage.
        const list = loadTemplates(projectId);
        const updated = list.map((t) =>
          t.id === tmpl.id ? { ...t, serverId: res.id } : t,
        );
        try {
          localStorage.setItem(storageKeys.comparisonTemplates(projectId), JSON.stringify(updated));
        } catch { /* ignore */ }
      })
      .catch(() => {});
  }
}

/** Delete a template from the server. */
export function deleteTemplateFromServer(projectId: string, serverId: string): void {
  api.deleteServerComparisonTemplate(projectId, serverId).catch(() => {});
}

/** Pull all templates from the server and merge with localStorage.
 *  Server templates that don't exist locally are added.
 *  Local templates without a serverId are pushed to the server. */
export async function syncTemplatesFromServer(projectId: string): Promise<void> {
  try {
    const { comparison_templates: serverList } = await api.comparisonTemplates(projectId);
    const local = loadTemplates(projectId);
    const localServerIds = new Set(local.map((t) => t.serverId).filter(Boolean));
    let changed = false;

    // Add server-only templates to local.
    for (const st of serverList) {
      if (localServerIds.has(st.id)) continue;
      try {
        const full = await api.comparisonTemplate(projectId, st.id);
        const payload = full.payload as Record<string, unknown>;
        const cards = (payload.cards ?? []) as ComparisonTemplate["cards"];
        const tmpl: ComparisonTemplate = {
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

    // Push local-only templates to server.
    for (const t of local) {
      if (!t.serverId) {
        syncTemplateToServer(projectId, t);
      }
    }

    if (changed) {
      saveTemplates(projectId, local);
    }
  } catch {
    // Server unavailable — work offline from localStorage.
  }
}
