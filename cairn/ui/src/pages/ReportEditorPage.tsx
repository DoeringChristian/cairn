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
import { RUN_SELECTOR_FETCH_LIMIT, useReport, useRuns, useUpdateReport } from "../api/hooks";
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
  parseReportMarkdown,
  restoreReportCardSettings,
  serializeReportToMarkdown,
  type CardsBlock,
  type MarkdownBlock,
  type ReportBlock,
  type ReportPayload,
} from "../lib/reports";
import ReportMarkdownBlock from "../components/reports/ReportMarkdownBlock";
import ReportCardsBlock from "../components/reports/ReportCardsBlock";
import ReportSourceMarkdown from "../components/reports/ReportSourceMarkdown";

const AUTOSAVE_DELAY_MS = 1500;
const DEFAULT_REPORT_NAME = "Untitled report";

type SaveState = "idle" | "saving" | "saved" | "error";

export default function ReportEditorPage() {
  const { projectId, reportId } = useParams<{ projectId: string; reportId: string }>();
  const q = useReport(projectId ?? "", reportId ?? "");
  const updateMut = useUpdateReport(projectId ?? "", reportId ?? "");
  // B10 fix: match RUN_SELECTOR_FETCH_LIMIT (the pool a `RunSelector` query
  // resolves against) so a resolved run never falls outside this page's own
  // "all project runs" list — a smaller cap here silently dropped chips for
  // any resolved run beyond it.
  const runsQ = useRuns({ project: projectId, limit: RUN_SELECTOR_FETCH_LIMIT });
  const allProjectRuns = runsQ.data?.runs ?? [];

  const [editMode, setEditMode] = useState(false);
  const [name, setName] = useState("");
  const [blocks, setBlocks] = useState<ReportBlock[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // WS-AR1: markdown-source view — a second view over the same blocks[],
  // via lib/reports/markdown-source.ts. `rawCairnSourceRef` caches each
  // ```cairn fence's exact original text so an unedited cells<->markdown
  // toggle round-trips byte-for-byte (see markdown-source.ts's module doc);
  // any edit to a CardsBlock invalidates its own cache entry so serializing
  // afterwards regenerates fresh YAML instead of showing stale content.
  const [sourceView, setSourceView] = useState(false);
  const [mdSource, setMdSource] = useState("");
  const rawCairnSourceRef = useRef<Record<string, string>>({});

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

    // WS-AR1: `source` (canonical markdown) is authoritative when present;
    // `blocks` is its parse cache. Older reports (saved before this field
    // existed) simply have no `source` and load from `blocks` unchanged —
    // additive, no migration (design doc D6).
    if (typeof payload.source === "string") {
      const parsed = parseReportMarkdown(payload.source);
      setBlocks(parsed.blocks);
      rawCairnSourceRef.current = parsed.rawCairnSource;
      if (reportId) restoreReportCardSettings(reportId, { blocks: parsed.blocks, cardSettings: parsed.settings });
      setMdSource(payload.source);
    } else {
      const loadedBlocks = payload.blocks ?? [];
      setBlocks(loadedBlocks);
      rawCairnSourceRef.current = {};
      if (reportId) restoreReportCardSettings(reportId, payload);
      setMdSource(serializeReportToMarkdown(loadedBlocks, payload.cardSettings ?? {}, {}));
    }
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

    // B1/B8: in the markdown-source view, edits live only in `mdSource`
    // state until the user explicitly exits/saves (see handleSaveNow) —
    // `blocks` doesn't reflect them yet. Persist a source-derived payload
    // (parse-on-idle) here too, so this debounced autosave / the unmount
    // flush below never clobbers in-progress source edits with stale
    // `blocks`. This intentionally does NOT touch local `blocks`/`sourceView`
    // state — only what gets persisted — so a silent autosave doesn't
    // interrupt typing.
    const payloadWithSource: ReportPayload = sourceView
      ? (() => {
          const parsed = parseReportMarkdown(mdSource);
          return { blocks: parsed.blocks, cardSettings: parsed.settings, source: mdSource };
        })()
      : (() => {
          const payload = buildReportPayload(reportId, blocks);
          const source = serializeReportToMarkdown(blocks, payload.cardSettings ?? {}, rawCairnSourceRef.current);
          return { ...payload, source };
        })();

    updateMut.mutate(
      { name: effectiveName, payload: payloadWithSource as unknown as Record<string, unknown> },
      {
        onSuccess: (res) => {
          setSaveState("saved");
          setLastSavedAt(res.updated_at);
        },
        onError: () => setSaveState("error"),
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, reportId, blocks, name, sourceView, mdSource]);

  // Debounced autosave — fires ~1.5s after the last local edit. Depends on
  // `mdSource`/`sourceView` too (B1): typing in the markdown-source textarea
  // only updates `mdSource`, never `blocks`, so without these deps a
  // source-only edit never schedules a save at all.
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
  }, [blocks, name, hydrated, sourceView, mdSource]);

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
    if (sourceView) {
      // `blocks` state won't reflect a just-typed markdown edit until the
      // next render, so — unlike the cells-view path — parse + save
      // directly from `mdSource` rather than going through `doSave()` (which
      // reads `blocks` from closure and would race a same-tick setBlocks).
      if (!reportId) return;
      const parsed = parseReportMarkdown(mdSource);
      rawCairnSourceRef.current = parsed.rawCairnSource;
      restoreReportCardSettings(reportId, { blocks: parsed.blocks, cardSettings: parsed.settings });
      setBlocks(parsed.blocks);
      setSourceView(false);
      const trimmed = name.trim();
      const effectiveName = trimmed || DEFAULT_REPORT_NAME;
      if (effectiveName !== name) setName(effectiveName);
      setSaveState("saving");
      const payload: ReportPayload = { blocks: parsed.blocks, cardSettings: parsed.settings, source: mdSource };
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
      return;
    }
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
    // A CardsBlock's content changed — its cached raw ```cairn fence text
    // (if any, from the last markdown parse) is now stale; drop it so the
    // next markdown-source serialize regenerates fresh YAML instead of
    // silently showing the pre-edit text (see rawCairnSourceRef's doc above).
    if (isCardsBlock(next)) delete rawCairnSourceRef.current[id];
    setBlocks((prev) => prev.map((b) => (b.id === id ? next : b)));
  };

  const deleteBlock = (id: string) => {
    if (!confirm("Delete this block?")) return;
    delete rawCairnSourceRef.current[id];
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

  // Cells <-> Markdown-source toggle (WS-AR1). Both views read/write the
  // same `blocks[]` — switching regenerates one from the other via
  // lib/reports/markdown-source.ts, never holding two independent copies.
  const enterMarkdownView = () => {
    const payload = reportId ? buildReportPayload(reportId, blocks) : { blocks, cardSettings: {} };
    setMdSource(serializeReportToMarkdown(blocks, payload.cardSettings ?? {}, rawCairnSourceRef.current));
    setSourceView(true);
  };

  const exitMarkdownView = () => {
    const parsed = parseReportMarkdown(mdSource);
    rawCairnSourceRef.current = parsed.rawCairnSource;
    setBlocks(parsed.blocks);
    if (reportId) restoreReportCardSettings(reportId, { blocks: parsed.blocks, cardSettings: parsed.settings });
    setSourceView(false);
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
          <button
            type="button"
            onClick={() => (sourceView ? exitMarkdownView() : enterMarkdownView())}
            className="btn text-xs"
            title="Toggle between the block editor and the report's canonical markdown source"
          >
            {sourceView ? "Cells" : "Markdown"}
          </button>
          <button type="button" onClick={() => setEditMode((v) => !v)} className="btn text-xs">
            {editMode ? "Done editing" : "Edit"}
          </button>
        </div>
      </div>

      {sourceView ? (
        editMode ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <textarea
              value={mdSource}
              onChange={(e) => setMdSource(e.target.value)}
              placeholder={"Write the report's markdown source directly — use a ```cairn fence for cards blocks."}
              className="input h-[70vh] w-full resize-y font-mono text-xs leading-relaxed"
              spellCheck={false}
            />
            <div className="h-[70vh] overflow-y-auto rounded border border-border-subtle bg-bg p-3 text-sm">
              {mdSource.trim() ? (
                <ReportSourceMarkdown projectId={projectId} reportId={reportId} allProjectRuns={allProjectRuns}>
                  {mdSource}
                </ReportSourceMarkdown>
              ) : (
                <span className="text-fg-subtle">Preview appears here…</span>
              )}
            </div>
          </div>
        ) : (
          <ReportSourceMarkdown projectId={projectId} reportId={reportId} allProjectRuns={allProjectRuns}>
            {mdSource}
          </ReportSourceMarkdown>
        )
      ) : blocks.length === 0 ? (
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

      {editMode && !sourceView && (
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
