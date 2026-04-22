import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import AddCardModal, { type AddCardSelection } from "../components/AddCardModal";
import CardRenderer from "../components/CardRenderer";
import ReorderableCardGrid from "../components/ReorderableCardGrid";
import SmartComparisonWizard from "../components/SmartComparisonWizard";
import ParallelCoordsCard from "../components/ParallelCoordsCard";
import ScatterPlotCard from "../components/ScatterPlotCard";
import {
  addCardToComparison,
  createComparison,
  reorderComparisonCards,
  deleteComparison,
  loadComparisons,
  removeCardFromComparison,
  renameComparison,
  saveComparisons,
  useComparisons,
  type Comparison,
  type ComparisonCard,
  type SmartFilters,
} from "../lib/comparisons";
import { formatRelative } from "../lib/format";
import { useRuns } from "../api/hooks";
import { api } from "../api/client";
import SettingsPopover from "../components/SettingsPopover";
import { setRunMetadata } from "../lib/run-label";
import type { SequenceMeta } from "../api/types";

export default function ComparePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const runsQ = useRuns({ project: projectId, limit: 200 });
  const runs = runsQ.data?.runs ?? [];
  const allProjectRunIds = useMemo(() => runs.map((r) => r.id), [runs]);

  // Populate run metadata cache for label formatting.
  useEffect(() => {
    if (runs.length > 0) setRunMetadata(runs);
  }, [runs]);
  const [searchParams, setSearchParams] = useSearchParams();
  const { comparisons, refresh } = useComparisons(projectId ?? "");

  const selectedId = searchParams.get("c") ?? "";

  // Auto-select the first comparison when the URL param is missing.
  useEffect(() => {
    if (!projectId) return;
    if (selectedId) return;
    if (comparisons.length === 0) return;
    const params = new URLSearchParams(searchParams);
    params.set("c", comparisons[0]!.id);
    setSearchParams(params, { replace: true });
  }, [projectId, selectedId, comparisons, searchParams, setSearchParams]);

  const selected = useMemo(
    () => comparisons.find((c) => c.id === selectedId) ?? null,
    [comparisons, selectedId],
  );

  const selectComparison = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams);
      params.set("c", id);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
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
      // If we just deleted the currently-selected comparison, drop the URL
      // param so auto-select kicks in on the next render.
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

  const handleAddCard = useCallback(
    (comparisonId: string, sel: AddCardSelection) => {
      if (!projectId) return;
      addCardToComparison(projectId, comparisonId, {
        type: sel.object_type as "scalar",
        series: sel.runs.map((r) => ({
          runId: r.runId,
          name: sel.name,
          context_hash: r.context_hash,
        })),
      });
      refresh();
      // Scroll to new card and auto-open its settings
      requestAnimationFrame(() => {
        setTimeout(() => {
          const grids = document.querySelectorAll(".grid.grid-cols-1");
          const lastGrid = grids[grids.length - 1];
          if (lastGrid) {
            const cards = lastGrid.children;
            const lastCard = cards[cards.length - 1] as HTMLElement | undefined;
            if (lastCard) {
              lastCard.scrollIntoView({ behavior: "smooth", block: "center" });
              setTimeout(() => {
                const buttons = lastCard.querySelectorAll("button");
                for (let i = buttons.length - 1; i >= 0; i--) {
                  if (buttons[i]!.textContent?.includes("\u2699")) {
                    buttons[i]!.click();
                    break;
                  }
                }
              }, 400);
            }
          }
        }, 100);
      });
    },
    [projectId, refresh],
  );

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

      // Rebuild cards from matched runs
      const selectedIds = matched.map((r) => r.id);
      const seqResults = await Promise.all(selectedIds.map((rid) => api.sequences(rid)));

      const cardMap = new Map<
        string,
        { name: string; object_type: string; series: Array<{ runId: string; name: string; context_hash: string }> }
      >();
      seqResults.forEach((result, idx) => {
        const runId = selectedIds[idx]!;
        for (const seq of result.sequences) {
          const key = `${seq.name}::${seq.object_type}`;
          const existing = cardMap.get(key);
          if (existing) {
            if (!existing.series.some((s) => s.runId === runId && s.name === seq.name)) {
              existing.series.push({ runId, name: seq.name, context_hash: seq.context_hash });
            }
          } else {
            cardMap.set(key, {
              name: seq.name,
              object_type: seq.object_type,
              series: [{ runId, name: seq.name, context_hash: seq.context_hash }],
            });
          }
        }
      });

      // Replace all cards on the comparison
      const allComps = loadComparisons(projectId);
      const updatedComps = allComps.map((c) => {
        if (c.id !== comparisonId) return c;
        const newCards = Array.from(cardMap.values()).map((card) => ({
          id: crypto.randomUUID(),
          type: card.object_type as "scalar",
          series: card.series,
        }));
        return { ...c, cards: newCards };
      });
      saveComparisons(projectId, updatedComps);
      refresh();
    },
    [projectId, refresh],
  );

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);

  const handleWizardCreated = useCallback(
    (comparisonId: string) => {
      refresh();
      selectComparison(comparisonId);
    },
    [refresh, selectComparison],
  );

  if (!projectId) return null;

  return (
      <div>
        <h1 className="mono mb-4 text-xl font-semibold">
          Compare
        </h1>

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
            className={`card h-fit p-3 ${sidebarOpen ? "" : "hidden md:block"}`}
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
          </aside>
          <main>
            {selected ? (
              <ComparisonView
                comparison={selected}
                allProjectRunIds={allProjectRunIds}
                onRename={(name) => handleRename(selected.id, name)}
                onDelete={() => handleDelete(selected.id)}
                onRemoveCard={(cardId) => handleRemoveCard(selected.id, cardId)}
                onAddCard={(sel) => handleAddCard(selected.id, sel)}
                onRefreshSmartFilters={handleRefreshSmartFilters}
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
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Comparisons
        </h2>
        <div className="flex items-center gap-1">
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
          {comparisons.map((c) => (
            <SidebarRow
              key={c.id}
              comparison={c}
              selected={c.id === selectedId}
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
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}

function SidebarRow({
  comparison,
  selected,
  onSelect,
  onRename,
  onDelete,
}: SidebarRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comparison.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement | null>(null);

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
          title={comparison.name}
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
        ref={menuBtnRef}
        type="button"
        aria-label="Comparison menu"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((v) => !v);
        }}
        className="inline-flex h-6 w-6 items-center justify-center rounded text-fg-subtle hover:bg-bg-hover hover:text-fg"
        title="More"
      >
        {"\u22EF"}
      </button>
      <SettingsPopover
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchorRef={menuBtnRef}
        title={comparison.name}
      >
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setEditing(true);
            }}
            className="btn text-xs text-left"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm(`Delete "${comparison.name}"?`)) {
                setMenuOpen(false);
                onDelete();
              }
            }}
            className="btn text-xs text-left text-status-failed"
          >
            Delete
          </button>
        </div>
      </SettingsPopover>
    </li>
  );
}

// -----------------------------------------------------------------------------
// Main pane — renders the selected comparison.
// -----------------------------------------------------------------------------

interface ComparisonViewProps {
  comparison: Comparison;
  allProjectRunIds: string[];
  onRename: (name: string) => void;
  onDelete: () => void;
  onRemoveCard: (cardId: string) => void;
  onAddCard: (sel: AddCardSelection) => void;
  onRefreshSmartFilters: (comparisonId: string, smartFilters: SmartFilters) => Promise<void>;
  onReorderCards: (fromId: string, toId: string) => void;
}

function ComparisonView({
  comparison,
  allProjectRunIds,
  onRename,
  onDelete,
  onRemoveCard,
  onAddCard,
  onRefreshSmartFilters,
  onReorderCards,
}: ComparisonViewProps) {
  const [editingName, setEditingName] = useState(false);
  const [draft, setDraft] = useState(comparison.name);
  const [addCardOpen, setAddCardOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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
    for (const card of comparison.cards) {
      for (const s of card.series) ids.add(s.runId);
    }
    return Array.from(ids);
  }, [comparison.cards]);


  useEffect(() => {
    if (!editingName) setDraft(comparison.name);
  }, [comparison.name, editingName]);

  return (
    <div className="flex flex-col gap-4">
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
            onClick={() => setAddCardOpen(true)}
            className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs font-medium text-fg-muted hover:border-accent hover:text-fg transition-colors"
          >
            <span aria-hidden="true">+</span> Add card
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
        </div>
      </div>

      <AddCardModal
        open={addCardOpen}
        onClose={() => setAddCardOpen(false)}
        runIds={compRunIds.length > 0 ? compRunIds : allProjectRunIds}

        onAdd={onAddCard}
      />

      {comparison.cards.length === 0 ? (
        <div className="card p-6 text-sm text-fg-muted">
          No cards yet. Click "Add card" to pick metrics from the comparison's runs.
        </div>
      ) : (
        <ReorderableCardGrid
          cards={comparison.cards.map((card) => ({
            key: card.id,
            content: (
              <ComparisonCardRenderer
                card={card}
                comparisonId={comparison.id}
                onRemove={() => onRemoveCard(card.id)}
              />
            ),
          }))}
          onReorder={onReorderCards}
        />
      )}
    </div>
  );
}

interface ComparisonCardRendererProps {
  card: ComparisonCard;
  comparisonId: string;
  onRemove: () => void;
}

function ComparisonCardRenderer({
  card,
  comparisonId,
  onRemove,
}: ComparisonCardRendererProps) {
  const runIds = useMemo(
    () => Array.from(new Set(card.series.map((s) => s.runId))),
    [card.series],
  );

  if (card.type === "parallel") {
    return (
      <ParallelCoordsCard
        runIds={runIds}
        settingsKey={{
          runId: `compare:${comparisonId}`,
          metricName: "parallel",
          contextHash: card.id,
        }}
        onRemove={onRemove}
      />
    );
  }

  if (card.type === "scatter") {
    return (
      <ScatterPlotCard
        runIds={runIds}
        settingsKey={{
          runId: `compare:${comparisonId}`,
          metricName: "scatter",
          contextHash: card.id,
        }}
        onRemove={onRemove}
      />
    );
  }

  const primary = card.series[0];
  if (!primary) {
    return (
      <div className="card p-4 text-sm text-fg-muted flex items-baseline justify-between gap-2">
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
          runId: `compare:${comparisonId}`,
          metricName: card.id,
          contextHash: "",
        }}
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
