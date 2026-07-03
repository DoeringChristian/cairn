/**
 * Report editor/viewer — /p/:projectId/reports/:reportId
 *
 * View mode (default): read-only vertical render of blocks.
 * Edit mode: add/remove/reorder blocks, edit markdown/cards content, rename.
 * Autosave: debounced PUT ~1.5s after the last change, plus an explicit
 * Save button. Card settings are gathered from/restored to localStorage
 * under the report's pseudo-scope on save/load — see lib/reports/payload.ts.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useReport, useRuns, useUpdateReport } from "../api/hooks";
import { formatRelative } from "../lib/format";
import { loadCardSettings } from "../lib/card-settings";
import { isMultiRunCardType, type ComparisonTemplateCard } from "../lib/comparisons";
import {
  allReportCards,
  buildReportPayload,
  cardSettingsKeyForReport,
  createReportTemplate,
  isCardsBlock,
  isMarkdownBlock,
  newId,
  restoreReportCardSettings,
  type CardsBlock,
  type MarkdownBlock,
  type ReportBlock,
  type ReportPayload,
} from "../lib/reports";
import ReportMarkdownBlock from "../components/reports/ReportMarkdownBlock";
import ReportCardsBlock from "../components/reports/ReportCardsBlock";

const AUTOSAVE_DELAY_MS = 1500;
const DEFAULT_REPORT_NAME = "Untitled report";

type SaveState = "idle" | "saving" | "saved" | "error";

export default function ReportEditorPage() {
  const { projectId, reportId } = useParams<{ projectId: string; reportId: string }>();
  const q = useReport(projectId ?? "", reportId ?? "");
  const updateMut = useUpdateReport(projectId ?? "", reportId ?? "");
  const runsQ = useRuns({ project: projectId, limit: 200 });
  const allProjectRuns = runsQ.data?.runs ?? [];

  const [editMode, setEditMode] = useState(false);
  const [name, setName] = useState("");
  const [blocks, setBlocks] = useState<ReportBlock[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // Transient "restored N of M cards" feedback handed over from
  // ReportsListPage's "New from template" apply (mirrors ComparePage's
  // templateApplyFeedback router-state handling).
  const location = useLocation();
  const [applyBanner, setApplyBanner] = useState<string | null>(
    (location.state as { templateApplyFeedback?: string } | null)?.templateApplyFeedback ?? null,
  );
  useEffect(() => {
    const feedback = (location.state as { templateApplyFeedback?: string } | null)?.templateApplyFeedback;
    if (!feedback) return;
    setApplyBanner(feedback);
    window.history.replaceState({}, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);
  const [lastSavedAt, setLastSavedAt] = useState<string | undefined>(undefined);

  const justHydratedRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);

  // Re-hydrate local editor state whenever the report id changes.
  useEffect(() => {
    setHydrated(false);
  }, [reportId]);

  useEffect(() => {
    if (hydrated || !q.data) return;
    setName(q.data.name);
    const payload = q.data.payload as unknown as ReportPayload;
    const loadedBlocks = payload.blocks ?? [];
    setBlocks(loadedBlocks);
    if (reportId) restoreReportCardSettings(reportId, payload);
    setLastSavedAt(q.data.updated_at);
    justHydratedRef.current = true;
    setHydrated(true);
  }, [q.data, hydrated, reportId]);

  const doSave = useCallback(() => {
    if (!hydrated || !reportId) return;
    // Blank-name guard: never persist an empty name (RC follow-up fix) —
    // fall back to the same default the list page's create-time prompt()
    // uses, and reflect the fallback in the input so it doesn't silently
    // diverge from what was actually saved.
    const trimmed = name.trim();
    const effectiveName = trimmed || DEFAULT_REPORT_NAME;
    if (effectiveName !== name) setName(effectiveName);
    setSaveState("saving");
    const payload = buildReportPayload(reportId, blocks);
    updateMut.mutate(
      { name: effectiveName, payload: payload as unknown as Record<string, unknown> },
      {
        onSuccess: (res) => {
          setSaveState("saved");
          setLastSavedAt(res.updated_at);
        },
        onError: () => setSaveState("error"),
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, reportId, blocks, name]);

  // Debounced autosave — fires ~1.5s after the last local edit.
  useEffect(() => {
    if (!hydrated) return;
    if (justHydratedRef.current) {
      justHydratedRef.current = false;
      return;
    }
    if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      doSave();
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, name, hydrated]);

  // Keep a ref to the latest doSave so the unmount-only effect below (empty
  // deps, so it can't re-subscribe on every edit) never calls a stale
  // closure over blocks/name.
  const doSaveRef = useRef(doSave);
  useEffect(() => {
    doSaveRef.current = doSave;
  }, [doSave]);

  // Flush a pending autosave on unmount so navigating away doesn't drop it.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
        doSaveRef.current();
      }
    };
  }, []);

  const handleSaveNow = () => {
    if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    doSave();
  };

  const addMarkdownBlock = () => {
    const block: MarkdownBlock = { id: newId(), type: "markdown", text: "" };
    setBlocks((prev) => [...prev, block]);
  };

  const addCardsBlock = () => {
    const block: CardsBlock = { id: newId(), type: "cards", runIds: [], cards: [] };
    setBlocks((prev) => [...prev, block]);
  };

  const updateBlock = (id: string, next: ReportBlock) => {
    setBlocks((prev) => prev.map((b) => (b.id === id ? next : b)));
  };

  const deleteBlock = (id: string) => {
    if (!confirm("Delete this block?")) return;
    setBlocks((prev) => prev.filter((b) => b.id !== id));
  };

  const moveBlock = (id: string, dir: -1 | 1) => {
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      if (idx < 0) return prev;
      const toIdx = idx + dir;
      if (toIdx < 0 || toIdx >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(idx, 1);
      next.splice(toIdx, 0, moved!);
      return next;
    });
  };

  // Save every cards-block card across this report as a reusable report
  // template — mirrors ComparePage's "Save template" (ComparePage.tsx),
  // scoped under `cardSettingsKeyForReport` instead of `cardSettingsKeyFor`.
  const handleSaveAsTemplate = () => {
    if (!reportId || !projectId) return;
    const templateName = prompt("Template name:", name);
    if (!templateName) return;
    const cards = allReportCards(blocks);
    const templateCards: ComparisonTemplateCard[] = cards.map((card) => {
      const settingsKey = cardSettingsKeyForReport(reportId, card);
      const cardSettings = loadCardSettings<Record<string, unknown>>(settingsKey);
      const isMultiRun = isMultiRunCardType(card.type);
      return {
        type: card.type,
        metricName: isMultiRun ? card.type : (card.series[0]?.name ?? card.id),
        contextHash: isMultiRun ? undefined : card.series[0]?.context_hash,
        settings: cardSettings ?? undefined,
      };
    });
    createReportTemplate(projectId, templateName, templateCards);
  };

  if (!projectId || !reportId) return null;

  if (q.isLoading) return <p className="text-fg-muted">Loading...</p>;
  if (q.isError) return <p className="text-status-failed">Error: {String(q.error)}</p>;

  const statusText =
    saveState === "saving"
      ? "saving…"
      : saveState === "error"
        ? "save failed"
        : lastSavedAt
          ? `saved · updated ${formatRelative(lastSavedAt)}`
          : "";

  return (
    <div>
      <div className="mb-1">
        <Link to={`/p/${projectId}/reports`} className="text-xs text-fg-muted hover:text-fg">
          {"←"} Reports
        </Link>
      </div>

      {applyBanner && (
        <div className="mb-4 flex items-center justify-between gap-2 rounded border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-fg">
          <span>{applyBanner}</span>
          <button
            type="button"
            onClick={() => setApplyBanner(null)}
            className="shrink-0 text-fg-subtle hover:text-fg"
            aria-label="Dismiss"
          >
            {"×"}
          </button>
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        {editMode ? (
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input text-xl font-semibold flex-1 min-w-[240px]"
          />
        ) : (
          <h1 className="mono text-xl font-semibold">{name}</h1>
        )}

        <div className="flex items-center gap-3">
          <span className="text-xs text-fg-subtle" title={statusText}>
            {statusText}
          </span>
          {editMode && (
            <button type="button" onClick={handleSaveNow} className="btn text-xs" disabled={updateMut.isPending}>
              Save
            </button>
          )}
          {editMode && (
            <button
              type="button"
              onClick={handleSaveAsTemplate}
              className="btn text-xs"
              title="Save this report's cards as a reusable template"
            >
              Save as template
            </button>
          )}
          <button type="button" onClick={() => setEditMode((v) => !v)} className="btn text-xs">
            {editMode ? "Done editing" : "Edit"}
          </button>
        </div>
      </div>

      {blocks.length === 0 ? (
        <div className="card p-6 text-sm text-fg-muted">
          {editMode
            ? "No blocks yet. Add a markdown or cards block below."
            : "This report has no content yet."}
        </div>
      ) : (
        <div className="space-y-6">
          {blocks.map((block, idx) => (
            <div key={block.id} className="group/block relative">
              {editMode && (
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wide text-fg-subtle">
                    {block.type}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveBlock(block.id, -1)}
                      disabled={idx === 0}
                      className="h-5 w-5 inline-flex items-center justify-center rounded text-fg-subtle hover:bg-bg-hover hover:text-fg disabled:opacity-30"
                      title="Move up"
                      aria-label="Move block up"
                    >
                      {"↑"}
                    </button>
                    <button
                      type="button"
                      onClick={() => moveBlock(block.id, 1)}
                      disabled={idx === blocks.length - 1}
                      className="h-5 w-5 inline-flex items-center justify-center rounded text-fg-subtle hover:bg-bg-hover hover:text-fg disabled:opacity-30"
                      title="Move down"
                      aria-label="Move block down"
                    >
                      {"↓"}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteBlock(block.id)}
                      className="h-5 w-5 inline-flex items-center justify-center rounded text-fg-subtle hover:bg-bg-hover hover:text-status-failed"
                      title="Delete block"
                      aria-label="Delete block"
                    >
                      {"×"}
                    </button>
                  </div>
                </div>
              )}

              {isMarkdownBlock(block) ? (
                <ReportMarkdownBlock
                  block={block}
                  editMode={editMode}
                  onChange={(text) => updateBlock(block.id, { ...block, text })}
                />
              ) : isCardsBlock(block) ? (
                <ReportCardsBlock
                  projectId={projectId}
                  reportId={reportId}
                  block={block}
                  editMode={editMode}
                  allProjectRuns={allProjectRuns}
                  onChange={(next) => updateBlock(block.id, next)}
                />
              ) : null}
            </div>
          ))}
        </div>
      )}

      {editMode && (
        <div className="mt-6 flex gap-2">
          <button type="button" onClick={addMarkdownBlock} className="btn text-xs">
            + Markdown block
          </button>
          <button type="button" onClick={addCardsBlock} className="btn text-xs">
            + Cards block
          </button>
        </div>
      )}
    </div>
  );
}
