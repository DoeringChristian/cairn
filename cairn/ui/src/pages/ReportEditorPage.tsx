/**
 * Report editor/viewer — /p/:projectId/reports/:reportId
 *
 * View mode (default): vertical render of cells (blocks[]) — prose
 * paragraphs are ALWAYS click-to-edit inline (Obsidian-style: click a
 * rendered paragraph, it becomes a raw `<textarea>`, blur/Cmd+Enter commits
 * and re-renders, autosave picks it up), independent of the Edit toggle;
 * ```cairn card *settings* stay frozen/read-only until Edit is on.
 * Edit mode: additionally exposes structural cell editing (add/remove/
 * reorder/insert cells — WS-NR1's `SegmentedMarkdownEditor`, see that
 * component's doc for the "no separate raw/preview pane" design) and card
 * settings mutation, plus rename.
 * Autosave: debounced PUT ~1.5s after the last change, plus an explicit
 * Save button. Card settings are gathered from/restored to localStorage
 * under the report's pseudo-scope on save/load — see lib/reports/payload.ts.
 *
 * WS-NR1 retires the old "Cells"/"Markdown" toggle (AR1's raw-textarea
 * source view): `blocks[]` is now the *only* editing surface, and the
 * canonical markdown `source` (still what's persisted, still authoritative
 * on load) is available read-only via the "View source" escape hatch below
 * — never a second editable copy.
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
  parseReportMarkdown,
  restoreReportCardSettings,
  serializeReportToMarkdown,
  type ReportBlock,
  type ReportPayload,
} from "../lib/reports";
import SegmentedMarkdownEditor, { makeEmptyBlock } from "../components/reports/SegmentedMarkdownEditor";

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

  // Read-only "View source" escape hatch (design doc §A: "keep a raw-source
  // escape hatch") — never a second *editable* copy; recomputed from
  // `blocks[]` on demand, not held as parallel state.
  const [showSource, setShowSource] = useState(false);

  // `rawCairnSourceRef` caches each ```cairn fence's exact original text so
  // an unedited hydrate->save round-trip stays byte-identical (see
  // markdown-source.ts's module doc); any edit to a CardsBlock invalidates
  // its own cache entry so serializing afterwards regenerates fresh YAML
  // instead of showing stale content.
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

  // RBUG fold-in: wait for `runsQ` too (not just the report itself) before
  // hydrating — a selector-bound ```cairn block needs the live project run
  // pool to resolve its run set *before* `compileCairnBlock` runs (see
  // parseReportMarkdown's `opts.allProjectRuns` doc); parsing with an empty
  // pool would compile the card with `series: []`, permanently losing its
  // metric name (no render-time rebind can recover an identity that was
  // never there). Both queries fire in parallel, so this rarely adds
  // user-visible latency.
  //
  // But don't wait forever: if `runsQ` errors out (data stays undefined
  // after retries are exhausted), proceed anyway and hydrate with an empty
  // run pool (`allProjectRuns` already falls back to `[]` above) rather than
  // leaving the whole report — including prose that needs no runs at all —
  // permanently blank.
  useEffect(() => {
    if (hydrated || !q.data || (!runsQ.data && !runsQ.isError)) return;
    setName(q.data.name);
    const payload = q.data.payload as unknown as ReportPayload;

    // WS-AR1: `source` (canonical markdown) is authoritative when present;
    // `blocks` is its parse cache. Older reports (saved before this field
    // existed) simply have no `source` and load from `blocks` unchanged —
    // additive, no migration (design doc D6).
    if (typeof payload.source === "string") {
      const parsed = parseReportMarkdown(payload.source, undefined, { allProjectRuns });
      setBlocks(parsed.blocks);
      rawCairnSourceRef.current = parsed.rawCairnSource;
      if (reportId) restoreReportCardSettings(reportId, { blocks: parsed.blocks, cardSettings: parsed.settings });
    } else {
      const loadedBlocks = payload.blocks ?? [];
      setBlocks(loadedBlocks);
      rawCairnSourceRef.current = {};
      if (reportId) restoreReportCardSettings(reportId, payload);
    }
    setLastSavedAt(q.data.updated_at);
    justHydratedRef.current = true;
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, runsQ.data, runsQ.isError, hydrated, reportId]);

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
    const source = serializeReportToMarkdown(blocks, payload.cardSettings ?? {}, rawCairnSourceRef.current);
    const payloadWithSource: ReportPayload = { ...payload, source };

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

  const updateBlock = (id: string, next: ReportBlock) => {
    // A CardsBlock's content changed — its cached raw ```cairn fence text
    // (if any, from the last markdown parse) is now stale; drop it so the
    // next markdown-source serialize regenerates fresh YAML instead of
    // silently showing the pre-edit text (see rawCairnSourceRef's doc above).
    if (isCardsBlock(next)) delete rawCairnSourceRef.current[id];
    setBlocks((prev) => prev.map((b) => (b.id === id ? next : b)));
  };

  const deleteBlock = (id: string) => {
    if (!confirm("Delete this cell?")) return;
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

  // WS-NR1 cell model: insert a fresh markdown/cards cell immediately after
  // `afterId` (or at the end when `afterId` is null) — the "+ cell"
  // affordance mirrors Jupyter's insert-below, and replaces the old
  // append-only addMarkdownBlock/addCardsBlock.
  const insertBlock = (afterId: string | null, type: ReportBlock["type"]) => {
    const block = makeEmptyBlock(type);
    setBlocks((prev) => {
      if (afterId == null) return [...prev, block];
      const idx = prev.findIndex((b) => b.id === afterId);
      if (idx < 0) return [...prev, block];
      const next = [...prev];
      next.splice(idx + 1, 0, block);
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

  // Recomputed on demand (not parallel state) whenever the escape hatch is
  // open — cheap relative to a render, and guarantees it's always exactly
  // what a save would persist right now.
  const sourceText = showSource
    ? serializeReportToMarkdown(blocks, buildReportPayload(reportId, blocks).cardSettings ?? {}, rawCairnSourceRef.current)
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
            onClick={() => setShowSource((v) => !v)}
            className="btn text-xs"
            title="View the report's canonical markdown source (read-only)"
          >
            {showSource ? "Hide source" : "View source"}
          </button>
          <button type="button" onClick={() => setEditMode((v) => !v)} className="btn text-xs">
            {editMode ? "Done editing" : "Edit"}
          </button>
        </div>
      </div>

      {showSource && (
        <pre className="mono mb-4 max-h-[50vh] overflow-auto rounded border border-border-subtle bg-bg p-3 text-xs leading-relaxed text-fg-muted whitespace-pre-wrap">
          {sourceText || "(empty)"}
        </pre>
      )}

      <SegmentedMarkdownEditor
        projectId={projectId}
        reportId={reportId}
        blocks={blocks}
        editMode={editMode}
        allProjectRuns={allProjectRuns}
        onUpdateBlock={updateBlock}
        onMoveBlock={moveBlock}
        onDeleteBlock={deleteBlock}
        onInsertBlock={insertBlock}
      />

      {editMode && blocks.length > 0 && (
        <div className="mt-6 flex gap-2">
          <button type="button" onClick={() => insertBlock(null, "markdown")} className="btn text-xs">
            + Markdown cell
          </button>
          <button type="button" onClick={() => insertBlock(null, "cards")} className="btn text-xs">
            + Cards cell
          </button>
        </div>
      )}
    </div>
  );
}
