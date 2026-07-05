import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useElementScrollRestore } from "../lib/use-scroll-restore";
import ComparisonOverviewTab from "./ComparisonOverviewTab";
import ComparisonSourceTab from "./ComparisonSourceTab";
import AddCardModal, { type AddCardSelection } from "../components/AddCardModal";
import CardRenderer from "../components/CardRenderer";
import ReorderableCardGrid from "../components/ReorderableCardGrid";
import RunSelectorBadge from "../components/RunSelectorBadge";
import { SectionBlock } from "../components/CardGrid";
import { groupComparisonCardsIntoSections } from "../lib/sections";
import SmartComparisonWizard from "../components/SmartComparisonWizard";
import {
  addCardToComparison,
  addRunsToComparison,
  applyTemplateToRuns,
  cardSettingsKeyFor,
  compareRunId,
  createComparison,
  createTemplate,
  deleteTemplate,
  isMultiRunCardType,
  rebuildCardsFromRuns,
  reorderComparisonCards,
  deleteComparison,
  loadComparisons,
  removeCardFromComparison,
  removeRunFromComparison,
  renameComparison,
  saveComparisons,
  setComparisonRunSelector,
  syncComparisonsFromServer,
  syncComparisonToServer,
  useComparisons,
  useTemplates,
  type ApplyTemplateResult,
  type Comparison,
  type ComparisonCard,
  type ComparisonTemplate,
  type ComparisonTemplateCard,
  type SmartFilters,
} from "../lib/comparisons";
import {
  buildReportPayload,
  cardSettingsKeyForReport,
  newId as newReportEntityId,
} from "../lib/reports";
import {
  describeRunSelector,
  DEFAULT_RUN_SELECTOR_N,
  type QueryRunSelector,
} from "../lib/run-selector";
import { loadCardSettings, saveCardSettings } from "../lib/card-settings";
import { loadJson, saveJson, storageKeys } from "../lib/storage";
import { formatRelative } from "../lib/format";
import { useRuns, useRunSelectorResolution } from "../api/hooks";
import { api } from "../api/client";

import { disambiguateRunLabels, useRunMetadataVersion } from "../lib/run-label";
import { RunSelectionContext, useRunSelectionState } from "../lib/use-run-selection";
import { CameraSyncContext, DEFAULT_CAMERA_SYNC_GROUP } from "../lib/camera-sync";
import RunSelectionPanel from "../components/RunSelectionPanel";
import type { Run } from "../api/types";
import type { SequenceMeta } from "../api/types";

export default function ComparePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const runsQ = useRuns({ project: projectId, limit: 200 });
  const runs = runsQ.data?.runs ?? [];
  const allProjectRunIds = useMemo(() => runs.map((r) => r.id), [runs]);

  // Run label cache is seeded centrally in `useRuns` (api/hooks.ts).
  const [searchParams, setSearchParams] = useSearchParams();
  const { comparisons, refresh } = useComparisons(projectId ?? "");

  // Sync with server on mount.
  useEffect(() => {
    if (!projectId) return;
    syncComparisonsFromServer(projectId).then(refresh);
  }, [projectId, refresh]);

  // Transient "restored N of M cards" feedback for a template apply. Two
  // sources: RunsTablePage's "From template" hands it over via router state
  // (it navigates here right after applying); the sidebar's own "New
  // comparison from template" sets it directly (see applyBanner below).
  const location = useLocation();
  const [applyBanner, setApplyBanner] = useState<string | null>(
    (location.state as { templateApplyFeedback?: string } | null)?.templateApplyFeedback ?? null,
  );
  useEffect(() => {
    const feedback = (location.state as { templateApplyFeedback?: string } | null)?.templateApplyFeedback;
    if (!feedback) return;
    setApplyBanner(feedback);
    // Clear the router state so a refresh/back-navigation doesn't re-show it.
    window.history.replaceState({}, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const selectedId = searchParams.get("c") ?? "";

  // Auto-select: restore last-viewed comparison, or fall back to first.
  useEffect(() => {
    if (!projectId) return;
    if (selectedId) return;
    if (comparisons.length === 0) return;
    const lastKey = storageKeys.lastComparison(projectId);
    const lastId = sessionStorage.getItem(lastKey);
    const target = (lastId && comparisons.find((c) => c.id === lastId))
      ? lastId
      : comparisons[0]!.id;
    const params = new URLSearchParams(searchParams);
    params.set("c", target);
    setSearchParams(params, { replace: true });
  }, [projectId, selectedId, comparisons, searchParams, setSearchParams]);

  const selected = useMemo(
    () => comparisons.find((c) => c.id === selectedId) ?? null,
    [comparisons, selectedId],
  );

  const selectComparison = useCallback(
    (id: string) => {
      if (projectId) sessionStorage.setItem(storageKeys.lastComparison(projectId), id);
      const params = new URLSearchParams(searchParams);
      params.set("c", id);
      setSearchParams(params, { replace: true });
    },
    [projectId, searchParams, setSearchParams],
  );

  const clearSelection = useCallback(() => {
    const params = new URLSearchParams(searchParams);
    params.delete("c");
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleCreate = useCallback(() => {
    if (!projectId) return;
    const cmp = createComparison(projectId, "New comparison");
    refresh();
    selectComparison(cmp.id);
  }, [projectId, refresh, selectComparison]);

  const handleRename = useCallback(
    (id: string, name: string) => {
      if (!projectId) return;
      renameComparison(projectId, id, name);
      refresh();
    },
    [projectId, refresh],
  );

  const handleDelete = useCallback(
    (id: string) => {
      if (!projectId) return;
      deleteComparison(projectId, id);
      const lastKey = storageKeys.lastComparison(projectId);
      if (sessionStorage.getItem(lastKey) === id) sessionStorage.removeItem(lastKey);
      if (id === selectedId) clearSelection();
      refresh();
    },
    [projectId, selectedId, clearSelection, refresh],
  );

  const handleRemoveCard = useCallback(
    (comparisonId: string, cardId: string) => {
      if (!projectId) return;
      removeCardFromComparison(projectId, comparisonId, cardId);
      refresh();
    },
    [projectId, refresh],
  );

  // Id of the just-added card, so the section below can auto-open its
  // settings and scroll it into view once. Transient \u2014 never persisted, so
  // a reload never re-opens a card's settings.
  const [autoFocusCardId, setAutoFocusCardId] = useState<string | null>(null);

  const handleAddCard = useCallback(
    (comparisonId: string, sel: AddCardSelection) => {
      if (!projectId) return;
      if (sel.kind === "manual-series") {
        // Custom overlay: series already carry their own (runId, name,
        // context_hash) — no shared `name` to fan out across runs.
        const newCardId = addCardToComparison(projectId, comparisonId, {
          type: sel.object_type as ComparisonCard["type"],
          series: sel.series,
        });
        refresh();
        setAutoFocusCardId(newCardId);
        return;
      }
      const type: ComparisonCard["type"] =
        sel.kind === "multi-run"
          ? sel.cardType
          : (sel.object_type as ComparisonCard["type"]);
      const newCardId = addCardToComparison(projectId, comparisonId, {
        type,
        series: sel.runs.map((r) => ({
          runId: r.runId,
          name: sel.name,
          context_hash: r.context_hash,
        })),
      });
      refresh();
      setAutoFocusCardId(newCardId);
    },
    [projectId, refresh],
  );

  // Clear the auto-focus flag right after it's been handed to the card grid
  // for one render — CardShell/cards only read it on mount, so clearing it
  // here doesn't undo the auto-open/scroll, and it keeps the flag from
  // lingering (e.g. across an unrelated re-render of the same comparison).
  useEffect(() => {
    if (autoFocusCardId == null) return;
    setAutoFocusCardId(null);
  }, [autoFocusCardId]);

  const handleRefreshSmartFilters = useCallback(
    async (comparisonId: string, smartFilters: SmartFilters) => {
      if (!projectId) return;
      // We need to re-run the filter. Fetch all runs + their params.
      const runsRes = await api.runs({ project: projectId, limit: 500 });
      const allRuns = runsRes.runs;
      const runDetails = await Promise.all(allRuns.map((r) => api.run(r.id)));

      // Build param map
      const runParamMap = new Map<string, Map<string, string>>();
      runDetails.forEach((detail, idx) => {
        const run = allRuns[idx]!;
        const pmap = new Map<string, string>();
        for (const p of detail.params ?? []) {
          pmap.set(p.key, p.value);
        }
        runParamMap.set(run.id, pmap);
      });

      // Apply filters
      let matched = allRuns.filter((run) => {
        const pmap = runParamMap.get(run.id);
        if (!pmap) return false;
        return smartFilters.filters.every((f) => {
          const val = pmap.get(f.key);
          if (val == null) return false;
          if (f.mode === "regex") {
            if (!f.regex) return true;
            try { return new RegExp(f.regex).test(val); } catch { return false; }
          }
          if (f.values.length === 0) return true;
          return f.values.includes(val);
        });
      });

      if (smartFilters.strategy === "latest") {
        const groups = new Map<string, typeof matched>();
        for (const run of matched) {
          const pmap = runParamMap.get(run.id);
          const comboKey = smartFilters.filters.map((f) => pmap?.get(f.key) ?? "").join("||");
          const arr = groups.get(comboKey) ?? [];
          arr.push(run);
          groups.set(comboKey, arr);
        }
        matched = [];
        for (const arr of groups.values()) {
          arr.sort((a, b) => b.created_at.localeCompare(a.created_at));
          matched.push(arr[0]!);
        }
      }

      matched.sort((a, b) => b.created_at.localeCompare(a.created_at));

      // Rebuild cards from matched runs (shared with the RunSelector refresh
      // path below — see lib/comparisons/rebuild-cards.ts).
      const selectedIds = matched.map((r) => r.id);
      const newCards = await rebuildCardsFromRuns(selectedIds);

      // Replace all cards on the comparison
      const allComps = loadComparisons(projectId);
      const updatedComps = allComps.map((c) => (c.id === comparisonId ? { ...c, cards: newCards } : c));
      saveComparisons(projectId, updatedComps);
      // saveComparisons() only persists to localStorage — sync the refreshed
      // cards to the server now instead of waiting for an unrelated edit to
      // pass through updateComparison() and trigger a sync.
      const refreshed = updatedComps.find((c) => c.id === comparisonId);
      if (refreshed) syncComparisonToServer(projectId, refreshed);
      refresh();
    },
    [projectId, refresh],
  );

  /**
   * Refresh a `runSelector`-bound comparison's cards from its currently
   * resolved run set — the RunSelector analogue of `handleRefreshSmartFilters`
   * above (same `rebuildCardsFromRuns` rebuild step, different "which runs
   * currently match" resolution). `runIds` is passed in already resolved
   * (via `useRunSelectorResolution`'s `refresh()` in ComparisonView) so this
   * stays a pure "rebuild + persist" step.
   */
  const handleRefreshRunSelector = useCallback(
    async (comparisonId: string, runIds: string[]) => {
      if (!projectId) return;
      const newCards = await rebuildCardsFromRuns(runIds);
      const allComps = loadComparisons(projectId);
      const updatedComps = allComps.map((c) =>
        c.id === comparisonId ? { ...c, cards: newCards, runIds } : c,
      );
      saveComparisons(projectId, updatedComps);
      // See handleRefreshSmartFilters above — saveComparisons() alone
      // doesn't sync to the server, so do it explicitly here too.
      const refreshed = updatedComps.find((c) => c.id === comparisonId);
      if (refreshed) syncComparisonToServer(projectId, refreshed);
      refresh();
    },
    [projectId, refresh],
  );

  const selectionState = useRunSelectionState();

  const compRunIds = useMemo(() => {
    if (!selected) return [];
    const ids = new Set<string>();
    if (selected.runIds) for (const id of selected.runIds) ids.add(id);
    for (const card of selected.cards) {
      for (const s of card.series) ids.add(s.runId);
    }
    return Array.from(ids);
  }, [selected]);

  const runInfoMap = useMemo(() => {
    const m = new Map<string, { displayName?: string; projectId?: string }>();
    for (const r of runs) {
      m.set(r.id, { displayName: r.display_name || undefined, projectId: r.project_id });
    }
    return m;
  }, [runs]);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  useElementScrollRestore(sidebarRef, `compare-sidebar:${projectId}`, comparisons.length > 0);

  const handleWizardCreated = useCallback(
    (comparisonId: string) => {
      refresh();
      selectComparison(comparisonId);
    },
    [refresh, selectComparison],
  );

  if (!projectId) return null;

  return (
    <RunSelectionContext.Provider value={selectionState}>
    <CameraSyncContext.Provider value={DEFAULT_CAMERA_SYNC_GROUP}>
      <div>
        <h1 className="mono mb-4 text-xl font-semibold">
          Compare
        </h1>

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

        {/* Mobile sidebar toggle */}
        <div className="mb-3 md:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            className="btn text-xs"
            aria-expanded={sidebarOpen}
          >
            Comparisons ({comparisons.length}) {sidebarOpen ? "\u25B2" : "\u25BC"}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-[320px_1fr]">
          <aside
            ref={sidebarRef}
            className={`card p-3 md:sticky md:top-[41px] md:max-h-[calc(100vh-41px)] md:overflow-y-auto ${sidebarOpen ? "" : "hidden md:block"}`}
          >
            <Sidebar
              comparisons={comparisons}
              selectedId={selectedId}
              onSelect={selectComparison}
              onCreate={handleCreate}
              onSmartCreate={() => setWizardOpen(true)}
              onRename={handleRename}
              onDelete={handleDelete}
            />
            <TemplateSidebar
              projectId={projectId}
              currentRunIds={compRunIds}
              allRunIds={allProjectRunIds}
              runInfo={runInfoMap}
              onApplied={(result, name) => {
                if (!result.comparisonId) {
                  setApplyBanner(`"${name}" has no cards matching the selected run(s) — no comparison created.`);
                  return;
                }
                refresh();
                selectComparison(result.comparisonId);
                setApplyBanner(
                  result.matchedCount === result.totalCount
                    ? `Applied "${name}" — all ${result.totalCount} card(s) restored.`
                    : `Applied "${name}" — restored ${result.matchedCount} of ${result.totalCount} card(s).`,
                );
              }}
            />
            {selectionState.selectedArray.length > 0 && (
              <div className="mt-4 border-t border-border-subtle pt-3">
                <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  Selection
                </h2>
                <RunSelectionPanel
                  selectedRunIds={selectionState.selectedArray}
                  allRunIds={compRunIds}
                  onClear={selectionState.clear}
                  runInfo={runInfoMap}
                  label="Comparison selection"
                />
              </div>
            )}
          </aside>
          <main>
            {selected ? (
              <ComparisonView
                comparison={selected}
                allProjectRuns={runs}
                allProjectRunIds={allProjectRunIds}
                projectId={projectId}
                autoFocusCardId={autoFocusCardId}
                onRename={(name) => handleRename(selected.id, name)}
                onDelete={() => handleDelete(selected.id)}
                onRemoveCard={(cardId) => handleRemoveCard(selected.id, cardId)}
                onAddCard={(sel) => handleAddCard(selected.id, sel)}
                onAddRuns={(runIds) => {
                  if (projectId) {
                    addRunsToComparison(projectId, selected.id, runIds);
                    refresh();
                  }
                }}
                onRemoveRun={(runId) => {
                  if (projectId) {
                    removeRunFromComparison(projectId, selected.id, runId);
                    refresh();
                  }
                }}
                onRefreshSmartFilters={handleRefreshSmartFilters}
                onRefreshRunSelector={handleRefreshRunSelector}
                onSetRunSelector={(sel) => {
                  if (projectId) {
                    setComparisonRunSelector(projectId, selected.id, sel);
                    refresh();
                  }
                }}
                onReorderCards={(fromId, toId) => {
                  if (projectId) {
                    reorderComparisonCards(projectId, selected.id, fromId, toId);
                    refresh();
                  }
                }}
              />
            ) : (
              <EmptyMainPane
                hasAny={comparisons.length > 0}
                onCreate={handleCreate}
              />
            )}
          </main>
        </div>

        {projectId && (
          <SmartComparisonWizard
            open={wizardOpen}
            onClose={() => setWizardOpen(false)}
            projectId={projectId}
            onCreated={handleWizardCreated}
          />
        )}
      </div>
    </CameraSyncContext.Provider>
    </RunSelectionContext.Provider>
  );
}

// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Sidebar
// -----------------------------------------------------------------------------

interface SidebarProps {
  comparisons: Comparison[];
  selectedId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onSmartCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

function Sidebar({
  comparisons,
  selectedId,
  onSelect,
  onCreate,
  onSmartCreate,
  onRename,
  onDelete,
}: SidebarProps) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const lastCheckedIdx = useRef<number | null>(null);
  const toggleCheck = (id: string, index: number, shiftKey: boolean) => {
    if (shiftKey && lastCheckedIdx.current !== null) {
      const lo = Math.min(lastCheckedIdx.current, index);
      const hi = Math.max(lastCheckedIdx.current, index);
      setChecked((prev) => {
        const next = new Set(prev);
        for (let i = lo; i <= hi; i++) next.add(comparisons[i]!.id);
        return next;
      });
    } else {
      setChecked((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
    }
    lastCheckedIdx.current = index;
  };
  const bulkDelete = () => {
    if (!confirm(`Delete ${checked.size} comparison(s)?`)) return;
    for (const id of checked) onDelete(id);
    setChecked(new Set());
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Comparisons
        </h2>
        <div className="flex items-center gap-1">
          {checked.size > 0 && (
            <button
              type="button"
              onClick={bulkDelete}
              className="inline-flex h-6 items-center justify-center rounded border border-status-failed/40 bg-status-failed/10 px-1.5 text-[10px] text-status-failed hover:bg-status-failed/20"
              title={`Delete ${checked.size} selected`}
            >
              Delete {checked.size}
            </button>
          )}
          <button
            type="button"
            onClick={onSmartCreate}
            className="inline-flex h-6 items-center justify-center rounded border border-border bg-bg px-1.5 text-[10px] text-fg-muted hover:border-accent hover:text-fg"
            aria-label="Smart comparison"
            title="Create from parameters"
          >
            {"\u2728"}
          </button>
          <button
            type="button"
            onClick={onCreate}
            className="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-bg text-sm text-fg-muted hover:border-accent hover:text-fg"
            aria-label="New comparison"
            title="New empty comparison"
          >
            {"\u002B"}
          </button>
        </div>
      </div>
      {comparisons.length === 0 ? (
        <p className="text-xs text-fg-subtle">
          No comparisons yet. Click + or ✨ to create one.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {comparisons.map((c, idx) => (
            <SidebarRow
              key={c.id}
              comparison={c}
              selected={c.id === selectedId}
              checked={checked.has(c.id)}
              onToggleCheck={(shiftKey: boolean) => toggleCheck(c.id, idx, shiftKey)}
              onSelect={() => onSelect(c.id)}
              onRename={(name) => onRename(c.id, name)}
              onDelete={() => onDelete(c.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface SidebarRowProps {
  comparison: Comparison;
  selected: boolean;
  checked: boolean;
  onToggleCheck: (shiftKey: boolean) => void;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}

function SidebarRow({
  comparison,
  selected,
  checked,
  onToggleCheck,
  onSelect,
  onRename,
  onDelete,
}: SidebarRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comparison.name);

  useEffect(() => {
    if (!editing) setDraft(comparison.name);
  }, [comparison.name, editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== comparison.name) onRename(trimmed);
    setEditing(false);
  };

  return (
    <li
      className={`group flex items-center gap-1 rounded border px-2 py-1.5 text-sm ${
        selected
          ? "border-accent/60 bg-accent/5"
          : "border-border-subtle bg-bg hover:border-border"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onClick={(e) => { e.stopPropagation(); onToggleCheck(e.shiftKey); }}
        readOnly
        className="shrink-0"
      />
      {editing ? (
        <input
          autoFocus
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
              setDraft(comparison.name);
            }
          }}
          className="input flex-1 text-xs"
        />
      ) : (
        <button
          type="button"
          onClick={onSelect}
          onDoubleClick={() => setEditing(true)}
          className="min-w-0 flex-1 text-left"
          title="Double-click to rename"
        >
          <div
            className={`truncate ${
              selected ? "font-semibold text-fg" : "text-fg-muted"
            }`}
          >
            {comparison.name}
          </div>
          <div className="text-[10px] text-fg-subtle">
            {comparison.cards.length} card
            {comparison.cards.length === 1 ? "" : "s"} ·{" "}
            {formatRelative(comparison.createdAt)}
          </div>
        </button>
      )}
      <button
        type="button"
        aria-label={`Delete "${comparison.name}"`}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-subtle opacity-0 group-hover:opacity-100 hover:text-status-failed transition-opacity"
        title="Delete"
      >
        {"\u00D7"}
      </button>
    </li>
  );
}

// -----------------------------------------------------------------------------
// Main pane — renders the selected comparison.
// -----------------------------------------------------------------------------

const COMPARISON_TABS = [
  { id: "overview", label: "Overview" },
  { id: "metrics", label: "Metrics & Media" },
  { id: "source", label: "Source" },
];

interface ComparisonViewProps {
  comparison: Comparison;
  allProjectRuns: Run[];
  allProjectRunIds: string[];
  projectId: string;
  /** Id of the just-added card to auto-open settings for and scroll to. */
  autoFocusCardId: string | null;
  onRename: (name: string) => void;
  onDelete: () => void;
  onRemoveCard: (cardId: string) => void;
  onAddCard: (sel: AddCardSelection) => void;
  onAddRuns: (runIds: string[]) => void;
  onRemoveRun: (runId: string) => void;
  onRefreshSmartFilters: (comparisonId: string, smartFilters: SmartFilters) => Promise<void>;
  /** Rebuild cards from an already-resolved RunSelector run set (see lib/run-selector.ts). */
  onRefreshRunSelector: (comparisonId: string, runIds: string[]) => Promise<void>;
  /** Set (or clear, with undefined) this comparison's dynamic run selector. */
  onSetRunSelector: (sel: Comparison["runSelector"]) => void;
  onReorderCards: (fromId: string, toId: string) => void;
}

function ComparisonView({
  comparison,
  allProjectRuns,
  allProjectRunIds,
  projectId,
  autoFocusCardId,
  onRename,
  onDelete,
  onRemoveCard,
  onAddCard,
  onAddRuns,
  onRemoveRun,
  onRefreshSmartFilters,
  onRefreshRunSelector,
  onSetRunSelector,
  onReorderCards,
}: ComparisonViewProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") ?? "overview";
  const setTab = useCallback(
    (t: string) => {
      const p = new URLSearchParams(searchParams);
      p.set("tab", t);
      setSearchParams(p, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const [editingName, setEditingName] = useState(false);
  const [draft, setDraft] = useState(comparison.name);
  const [addCardOpen, setAddCardOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectorRefreshing, setSelectorRefreshing] = useState(false);
  const [creatingReport, setCreatingReport] = useState(false);

  const runSelectorResolution = useRunSelectorResolution(projectId, comparison.runSelector);
  const handleRefreshRunSelector = useCallback(async () => {
    setSelectorRefreshing(true);
    try {
      const freshRunIds = await runSelectorResolution.refresh();
      await onRefreshRunSelector(comparison.id, freshRunIds);
    } finally {
      setSelectorRefreshing(false);
    }
  }, [comparison.id, onRefreshRunSelector, runSelectorResolution]);

  const collapsedKey = storageKeys.collapsedSections(compareRunId(comparison.id));
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => {
    const raw = loadJson<string[]>(localStorage, collapsedKey);
    return new Set(Array.isArray(raw) ? raw : []);
  });
  const toggleSection = useCallback((name: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      saveJson(localStorage, collapsedKey, [...next]);
      return next;
    });
  }, [collapsedKey]);

  const sections = useMemo(
    () => groupComparisonCardsIntoSections(comparison.cards),
    [comparison.cards],
  );

  const handleRefresh = useCallback(async () => {
    if (!comparison.smartFilters) return;
    setRefreshing(true);
    try {
      await onRefreshSmartFilters(comparison.id, comparison.smartFilters);
    } finally {
      setRefreshing(false);
    }
  }, [comparison.id, comparison.smartFilters, onRefreshSmartFilters]);

  // Collect all unique run IDs from the comparison's series
  const compRunIds = useMemo(() => {
    const ids = new Set<string>();
    if (comparison.runIds) for (const id of comparison.runIds) ids.add(id);
    for (const card of comparison.cards) {
      for (const s of card.series) ids.add(s.runId);
    }
    return Array.from(ids);
  }, [comparison.cards, comparison.runIds]);

  const metaVersion = useRunMetadataVersion();
  const runLabels = useMemo(() => disambiguateRunLabels(compRunIds), [compRunIds, metaVersion]);

  // From-comparison: snapshot this comparison into a brand-new report —
  // header markdown block (name + run list) + one cards block carrying
  // deep-copied cards (new ids) + runIds + settings copied into the
  // report's own settings scope via cardSettingsKeyForReport/
  // saveCardSettings (reading the originals via cardSettingsKeyFor/
  // loadCardSettings). The comparison itself is left untouched.
  const handleCreateReport = useCallback(async () => {
    setCreatingReport(true);
    try {
      const cardIdMap = new Map<string, string>();
      const newCards: ComparisonCard[] = comparison.cards.map((card) => {
        const id = newReportEntityId();
        cardIdMap.set(card.id, id);
        return { ...card, id };
      });
      const runList = compRunIds.map((id) => runLabels[id] ?? id).join(", ");
      const headerBlock = {
        id: newReportEntityId(),
        type: "markdown" as const,
        text: `# ${comparison.name}\n\nFrom comparison "${comparison.name}". Runs: ${runList || "(none)"}`,
      };
      const cardsBlock = {
        id: newReportEntityId(),
        type: "cards" as const,
        runIds: compRunIds,
        cards: newCards,
      };
      const blocks = [headerBlock, cardsBlock];

      const created = await api.createReport(projectId, comparison.name, { blocks });

      // Copy each card's settings from the comparison's scope into the
      // new report's scope.
      for (const card of comparison.cards) {
        const settings = loadCardSettings<Record<string, unknown>>(cardSettingsKeyFor(comparison.id, card));
        if (!settings) continue;
        const newCard = newCards.find((c) => c.id === cardIdMap.get(card.id));
        if (newCard) saveCardSettings(cardSettingsKeyForReport(created.id, newCard), settings);
      }
      const fullPayload = buildReportPayload(created.id, blocks);
      await api.updateReport(projectId, created.id, { payload: fullPayload as unknown as Record<string, unknown> });

      navigate(`/p/${projectId}/reports/${created.id}`);
    } finally {
      setCreatingReport(false);
    }
  }, [comparison, compRunIds, runLabels, projectId, navigate]);

  useEffect(() => {
    if (!editingName) setDraft(comparison.name);
  }, [comparison.name, editingName]);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-baseline justify-between gap-2">
        {editingName ? (
          <input
            autoFocus
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              const t = draft.trim();
              if (t && t !== comparison.name) onRename(t);
              setEditingName(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const t = draft.trim();
                if (t && t !== comparison.name) onRename(t);
                setEditingName(false);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setEditingName(false);
                setDraft(comparison.name);
              }
            }}
            className="input text-lg font-semibold"
          />
        ) : (
          <h2
            className="text-lg font-semibold cursor-text"
            title="Click to rename"
            onClick={() => setEditingName(true)}
          >
            {comparison.name}
          </h2>
        )}
        <div className="flex items-center gap-2">
          {comparison.runSelector && (
            <RunSelectorBadge
              title={describeRunSelector(comparison.runSelector)}
              count={runSelectorResolution.runIds.length}
              isRefreshing={selectorRefreshing || runSelectorResolution.isFetching}
              onRefresh={() => void handleRefreshRunSelector()}
            />
          )}
          {comparison.smartFilters && (
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs font-medium text-fg-muted hover:border-accent hover:text-fg transition-colors disabled:opacity-50"
              title="Re-run smart filters to include new runs"
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleCreateReport()}
            disabled={creatingReport}
            className="btn text-xs disabled:opacity-50"
            title="Snapshot this comparison's cards + settings into a new report"
          >
            {creatingReport ? "Creating…" : "Create report"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm(`Delete "${comparison.name}"?`)) onDelete();
            }}
            className="btn text-xs"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => {
              const name = prompt("Template name:", comparison.name);
              if (!name) return;
              const templateCards: ComparisonTemplateCard[] = comparison.cards.map((card) => {
                const settingsKey = cardSettingsKeyFor(comparison.id, card);
                const cardSettings = loadCardSettings<Record<string, unknown>>(settingsKey);
                // Multi-run cards (parallel/scatter/bar/tile) don't correspond to
                // a metric name — key them by type so onApplyTemplate/
                // applyTemplateToRuns can find them regardless of what label
                // (if any) their synthetic series happened to carry.
                const isMultiRun = isMultiRunCardType(card.type);
                return {
                  type: card.type,
                  metricName: isMultiRun ? card.type : (card.series[0]?.name ?? card.id),
                  contextHash: isMultiRun ? undefined : card.series[0]?.context_hash,
                  settings: cardSettings ?? undefined,
                };
              });
              createTemplate(projectId, name, templateCards);
            }}
            className="btn text-xs"
            title="Save card layout as a reusable template"
          >
            Save template
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <nav className="flex gap-1 overflow-x-auto whitespace-nowrap border-b border-border">
        {COMPARISON_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={[
              "border-b-2 px-3 py-2 text-sm transition-colors",
              tab === t.id
                ? "border-accent text-fg"
                : "border-transparent text-fg-muted hover:text-fg",
            ].join(" ")}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* Tab content */}
      {tab === "overview" && (
        <ComparisonOverviewTab compRunIds={compRunIds} />
      )}

      {tab === "metrics" && (
        <>
          <ComparisonRunsPanel
            compRunIds={compRunIds}
            allProjectRuns={allProjectRuns}
            onAddRuns={onAddRuns}
            onRemoveRun={onRemoveRun}
            runSelector={comparison.runSelector}
            hasSmartFilters={!!comparison.smartFilters}
            onSetRunSelector={onSetRunSelector}
          />

          <AddCardModal
            open={addCardOpen}
            onClose={() => setAddCardOpen(false)}
            runIds={compRunIds.length > 0 ? compRunIds : allProjectRunIds}
            onAdd={onAddCard}
          />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAddCardOpen(true)}
              className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs font-medium text-fg-muted hover:border-accent hover:text-fg transition-colors"
            >
              <span aria-hidden="true">+</span> Add card
            </button>
          </div>

          {comparison.cards.length === 0 ? (
            <div className="card p-6 text-sm text-fg-muted">
              No cards yet. Click "Add card" to pick metrics from the comparison's runs.
            </div>
          ) : (
            <div className="space-y-8">
              {sections.map((section) => (
                <SectionBlock
                  key={section.name}
                  sectionName={section.name}
                  itemCount={section.cards.length}
                  collapsed={collapsedSections.has(section.name)}
                  onToggleCollapse={() => toggleSection(section.name)}
                >
                  <ReorderableCardGrid
                    cards={section.cards.map((card) => ({
                      key: card.id,
                      content: (
                        <ComparisonCardRenderer
                          card={card}
                          comparisonId={comparison.id}
                          onRemove={() => onRemoveCard(card.id)}
                          autoOpenSettings={card.id === autoFocusCardId}
                        />
                      ),
                    }))}
                    onReorder={onReorderCards}
                  />
                </SectionBlock>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "source" && (
        <ComparisonSourceTab compRunIds={compRunIds} />
      )}
    </div>
  );
}

interface ComparisonCardRendererProps {
  card: ComparisonCard;
  comparisonId: string;
  onRemove: () => void;
  /** Auto-open this card's settings and scroll to it once, on mount. */
  autoOpenSettings?: boolean;
}

function ComparisonCardRenderer({
  card,
  comparisonId,
  onRemove,
  autoOpenSettings,
}: ComparisonCardRendererProps) {
  const runIds = useMemo(
    () => Array.from(new Set(card.series.map((s) => s.runId))),
    [card.series],
  );

  if (isMultiRunCardType(card.type)) {
    return (
      <CardRenderer
        kind="multi-run"
        cardType={card.type}
        runIds={runIds}
        settingsKey={{
          runId: compareRunId(comparisonId),
          metricName: card.type,
          contextHash: card.id,
        }}
        onRemove={onRemove}
        autoOpenSettings={autoOpenSettings}
      />
    );
  }

  const primary = card.series[0];
  if (!primary) {
    return (
      <div data-cairn-card className="card p-4 text-sm text-fg-muted flex items-baseline justify-between gap-2">
        <span>Empty card.</span>
        <button type="button" className="btn text-xs" onClick={onRemove}>
          Remove
        </button>
      </div>
    );
  }

  const seedMetric: SequenceMeta = {
    name: primary.name,
    object_type: card.type,
    context: null,
    context_hash: primary.context_hash,
    min_step: 0,
    max_step: 0,
    count: 0,
  };

  return (
      <CardRenderer
        runId={primary.runId}
        metric={seedMetric}
        extraSeries={card.series.slice(1)}
        controlledSeries
        onRemove={onRemove}
        settingsKeyOverride={{
          runId: compareRunId(comparisonId),
          metricName: card.id,
          contextHash: "",
        }}
        autoOpenSettings={autoOpenSettings}
      />
  );
}

// -----------------------------------------------------------------------------
// Empty state
// -----------------------------------------------------------------------------

function EmptyMainPane({
  hasAny,
  onCreate,
}: {
  hasAny: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="card p-6 text-sm text-fg-muted">
      {hasAny ? (
        <p>Select a comparison on the left to view its cards.</p>
      ) : (
        <>
          <p className="mb-2 text-fg">No comparisons yet.</p>
          <p>
            <button
              type="button"
              className="text-accent hover:underline"
              onClick={onCreate}
            >
              Create one
            </button>{" "}
            to start collecting scalar cards across runs.
          </p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Template sidebar section
// ---------------------------------------------------------------------------

interface TemplateSidebarProps {
  projectId: string;
  /** Run IDs of the currently selected comparison (empty when none is selected). */
  currentRunIds: string[];
  /** Fallback pool of run IDs for the minimal picker when there's no current comparison. */
  allRunIds: string[];
  runInfo: Map<string, { displayName?: string; projectId?: string }>;
  onApplied: (result: ApplyTemplateResult, templateName: string) => void;
}

function TemplateSidebar({ projectId, currentRunIds, allRunIds, runInfo, onApplied }: TemplateSidebarProps) {
  const { templates } = useTemplates(projectId);
  // The template a run picker is currently open for (no current comparison
  // to draw runs from), and the runs checked in that picker.
  const [pendingTemplate, setPendingTemplate] = useState<ComparisonTemplate | null>(null);
  const [pickedRunIds, setPickedRunIds] = useState<Set<string>>(new Set());
  const [applyingId, setApplyingId] = useState<string | null>(null);

  if (templates.length === 0) return null;

  const applyWithRuns = async (t: ComparisonTemplate, runIds: string[]) => {
    if (runIds.length === 0) return;
    setApplyingId(t.id);
    try {
      const result = await applyTemplateToRuns(projectId, t, runIds);
      onApplied(result, t.name);
      setPendingTemplate(null);
      setPickedRunIds(new Set());
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <div className="mt-4 border-t border-border-subtle pt-3">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        Templates
      </h2>
      <ul className="flex flex-col gap-1">
        {templates.map((t) => (
          <li
            key={t.id}
            className="flex items-center justify-between rounded px-2 py-1.5 text-xs text-fg-muted hover:bg-bg-hover"
          >
            <div className="min-w-0">
              <div className="truncate">{t.name}</div>
              <div className="text-[10px] text-fg-subtle">{t.cards.length} card(s)</div>
            </div>
            <div className="ml-2 flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (currentRunIds.length > 0) {
                    void applyWithRuns(t, currentRunIds);
                  } else {
                    setPendingTemplate(t);
                    setPickedRunIds(new Set());
                  }
                }}
                disabled={applyingId === t.id}
                className="text-[10px] text-accent hover:underline disabled:opacity-50"
                title={
                  currentRunIds.length > 0
                    ? "New comparison from template, using this comparison's runs"
                    : "New comparison from template \u2014 pick runs"
                }
              >
                {applyingId === t.id ? "Applying\u2026" : "New from template"}
              </button>
              <button
                type="button"
                onClick={() => deleteTemplate(projectId, t.id)}
                className="text-[10px] text-fg-subtle hover:text-status-failed"
                title="Delete template"
              >
                {"\u00D7"}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {pendingTemplate && (
        <div className="mt-2 rounded border border-border p-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="truncate text-[10px] font-medium text-fg-muted">
              Pick runs for "{pendingTemplate.name}"
            </span>
            <button
              type="button"
              onClick={() => setPendingTemplate(null)}
              className="shrink-0 text-[10px] text-fg-subtle hover:text-fg"
            >
              Cancel
            </button>
          </div>
          {allRunIds.length === 0 ? (
            <p className="text-[10px] text-fg-subtle">No runs in this project yet.</p>
          ) : (
            <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
              {allRunIds.map((runId) => {
                const label = runInfo.get(runId)?.displayName || runId;
                return (
                  <li key={runId}>
                    <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-fg-muted hover:text-fg">
                      <input
                        type="checkbox"
                        checked={pickedRunIds.has(runId)}
                        onChange={() => {
                          setPickedRunIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(runId)) next.delete(runId);
                            else next.add(runId);
                            return next;
                          });
                        }}
                      />
                      <span className="truncate">{label}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <button
            type="button"
            onClick={() => void applyWithRuns(pendingTemplate, Array.from(pickedRunIds))}
            disabled={pickedRunIds.size === 0 || applyingId === pendingTemplate.id}
            className="btn mt-2 w-full text-[10px] disabled:opacity-50"
          >
            {applyingId === pendingTemplate.id
              ? "Applying\u2026"
              : `Apply to ${pickedRunIds.size} run${pickedRunIds.size === 1 ? "" : "s"}`}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ComparisonRunsPanel — view + add/remove runs for a comparison
// ---------------------------------------------------------------------------

interface ComparisonRunsPanelProps {
  compRunIds: string[];
  allProjectRuns: Run[];
  onAddRuns: (runIds: string[]) => void;
  onRemoveRun: (runId: string) => void;
  /** Dynamic run selector, if this comparison uses one instead of a static run list. */
  runSelector: Comparison["runSelector"];
  /** True when this comparison was built by the Smart Wizard — switching to
   *  a RunSelector clears `smartFilters` (mutually exclusive), so confirm. */
  hasSmartFilters: boolean;
  onSetRunSelector: (sel: Comparison["runSelector"]) => void;
}

const DEFAULT_COMPARISON_QUERY_SELECTOR: QueryRunSelector = {
  kind: "query",
  mode: "newest-per-name",
  n: DEFAULT_RUN_SELECTOR_N,
};

function ComparisonRunsPanel({
  compRunIds,
  allProjectRuns,
  onAddRuns,
  onRemoveRun,
  runSelector,
  hasSmartFilters,
  onSetRunSelector,
}: ComparisonRunsPanelProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const includedSet = useMemo(() => new Set(compRunIds), [compRunIds]);

  const candidates = useMemo(
    () => allProjectRuns.filter((r) => !includedSet.has(r.id)),
    [allProjectRuns, includedSet],
  );

  const includedRuns = useMemo(
    () => compRunIds
      .map((id) => allProjectRuns.find((r) => r.id === id))
      .filter((r): r is Run => r !== undefined),
    [compRunIds, allProjectRuns],
  );

  // Re-render + recompute labels when the run metadata cache is seeded
  // (seeding happens in a useEffect in api/hooks.ts, after first paint).
  const metaVersion = useRunMetadataVersion();

  // Disambiguate chip labels (recomputed when set changes).
  const chipLabels = useMemo(
    () => disambiguateRunLabels(compRunIds),
    [compRunIds, metaVersion],
  );

  // Disambiguate the candidate picker labels too — using ALL project runs
  // as siblings so duplicates surface clearly.
  const candidateLabels = useMemo(
    () => disambiguateRunLabels(allProjectRuns.map((r) => r.id)),
    [allProjectRuns, metaVersion],
  );

  return (
    <div className="card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-fg-muted">
          Runs in comparison ({compRunIds.length})
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (!runSelector && hasSmartFilters) {
                if (!confirm("This comparison was built with Smart Filters. Switching to a run selector replaces that binding — continue?")) {
                  return;
                }
              }
              onSetRunSelector(runSelector ? undefined : { ...DEFAULT_COMPARISON_QUERY_SELECTOR });
            }}
            className="inline-flex h-6 items-center justify-center rounded border border-border bg-bg px-2 text-[10px] text-fg-muted hover:border-accent hover:text-fg"
            title={
              runSelector
                ? "Switch to a fixed run list"
                : "Switch to a dynamic run selector (always tracks matching runs)"
            }
          >
            {runSelector ? "Use static runs" : "Use auto (query)"}
          </button>
          {!runSelector && (
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              className="inline-flex h-6 items-center justify-center rounded border border-border bg-bg px-2 text-[10px] text-fg-muted hover:border-accent hover:text-fg"
            >
              {pickerOpen ? "Done" : `+ Add runs (${candidates.length} available)`}
            </button>
          )}
        </div>
      </div>

      {runSelector && runSelector.kind === "query" && (
        <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="text-[10px] text-fg-muted">
            Name pattern
            <input
              type="text"
              value={runSelector.namePattern ?? ""}
              onChange={(e) =>
                onSetRunSelector({ ...runSelector, namePattern: e.target.value || undefined })
              }
              placeholder="e.g. training-*"
              className="input mt-0.5 w-full text-xs"
            />
          </label>
          <label className="text-[10px] text-fg-muted">
            Tags (comma-sep)
            <input
              type="text"
              value={(runSelector.tags ?? []).join(", ")}
              onChange={(e) =>
                onSetRunSelector({
                  ...runSelector,
                  tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean),
                })
              }
              placeholder="e.g. prod, nightly"
              className="input mt-0.5 w-full text-xs"
            />
          </label>
          <label className="text-[10px] text-fg-muted">
            Mode
            <select
              value={runSelector.mode}
              onChange={(e) =>
                onSetRunSelector({ ...runSelector, mode: e.target.value as QueryRunSelector["mode"] })
              }
              className="input mt-0.5 w-full text-xs"
            >
              <option value="latest-n">Latest N</option>
              <option value="newest-per-name">Newest per name</option>
            </select>
          </label>
          <label className="text-[10px] text-fg-muted">
            N
            <input
              type="number"
              min={1}
              value={runSelector.n ?? DEFAULT_RUN_SELECTOR_N}
              onChange={(e) =>
                onSetRunSelector({ ...runSelector, n: Math.max(1, Number(e.target.value) || 1) })
              }
              className="input mt-0.5 w-full text-xs"
            />
          </label>
        </div>
      )}

      {/* Included runs — removable chips (static) or read-only (auto) */}
      {compRunIds.length === 0 ? (
        <p className="text-xs text-fg-subtle">
          {runSelector
            ? "No runs currently match this selector. Click the header “refresh” once matching runs exist."
            : 'No runs yet. Click "Add runs" or drag a series chip into a card.'}
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {includedRuns.map((r) => {
            const label = chipLabels[r.id] ?? r.id.slice(0, 6);
            return runSelector ? (
              <span
                key={r.id}
                className="inline-flex items-center gap-1 rounded border border-border-subtle bg-bg-hover px-1.5 py-0.5 text-[11px] mono text-fg"
                title={r.id}
              >
                {label}
              </span>
            ) : (
              <span
                key={r.id}
                className="group/chip inline-flex items-center gap-1 rounded border border-border-subtle bg-bg-hover px-1.5 py-0.5 text-[11px] mono"
                title={r.id}
              >
                <span className="text-fg">{label}</span>
                <button
                  type="button"
                  onClick={() => onRemoveRun(r.id)}
                  className="text-fg-subtle hover:text-status-failed"
                  aria-label={`Remove ${label} from comparison`}
                  title={`Remove ${label}`}
                >
                  {"×"}
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Picker — list of candidate runs, click to add (static mode only) */}
      {!runSelector && pickerOpen && (
        <div className="mt-2 border-t border-border-subtle pt-2">
          {candidates.length === 0 ? (
            <p className="text-xs text-fg-subtle">All runs already in this comparison.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
              {candidates.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onAddRuns([r.id])}
                  className="inline-flex items-center gap-1 rounded border border-border-subtle bg-bg px-1.5 py-0.5 text-[11px] mono text-fg-muted hover:border-accent hover:text-fg"
                  title={r.id}
                >
                  <span aria-hidden="true">+</span>
                  {candidateLabels[r.id] ?? r.id.slice(0, 6)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
