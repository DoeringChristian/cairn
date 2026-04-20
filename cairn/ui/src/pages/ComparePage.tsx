import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import AddCardModal, { type AddCardSelection } from "../components/AddCardModal";
import CardRenderer from "../components/CardRenderer";
import SmartComparisonWizard from "../components/SmartComparisonWizard";
import ParallelCoordsCard from "../components/ParallelCoordsCard";
import ScatterPlotCard from "../components/ScatterPlotCard";
import {
  addCardToComparison,
  createComparison,
  deleteComparison,
  removeCardFromComparison,
  renameComparison,
  useComparisons,
  type Comparison,
  type ComparisonCard,
} from "../lib/comparisons";
import { formatRelative } from "../lib/format";
import { useRuns } from "../api/hooks";
import SettingsPopover from "../components/SettingsPopover";
import type { SequenceMeta } from "../api/types";

export default function ComparePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const runsQ = useRuns({ project: projectId, limit: 200 });
  const allProjectRunIds = useMemo(
    () => (runsQ.data?.runs ?? []).map((r) => r.id),
    [runsQ.data],
  );
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
}

function ComparisonView({
  comparison,
  allProjectRunIds,
  onRename,
  onDelete,
  onRemoveCard,
  onAddCard,
}: ComparisonViewProps) {
  const [editingName, setEditingName] = useState(false);
  const [draft, setDraft] = useState(comparison.name);
  const [addCardOpen, setAddCardOpen] = useState(false);

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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {comparison.cards.map((card) => (
              <ComparisonCardRenderer
                key={card.id}
                card={card}
                comparisonId={comparison.id}
                onRemove={() => onRemoveCard(card.id)}
              />
          ))}
        </div>
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
