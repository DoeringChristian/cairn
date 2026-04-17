import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import ScalarPlotCard from "../components/ScalarPlotCard";
import DraggableCard from "../components/DraggableCard";
import {
  createComparison,
  deleteComparison,
  removeCardFromComparison,
  renameComparison,
  useComparisons,
  type Comparison,
  type ComparisonCard,
} from "../lib/comparisons";
import { ProjectProvider } from "../lib/project-context";
import { formatRelative } from "../lib/format";
import SettingsPopover from "../components/SettingsPopover";
import type { SequenceMeta } from "../api/types";

export default function ComparePage() {
  const { projectId } = useParams<{ projectId: string }>();
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

  const [sidebarOpen, setSidebarOpen] = useState(true);

  if (!projectId) return null;

  return (
    <ProjectProvider value={projectId}>
      <div>
        <Breadcrumbs projectId={projectId} />
        <h1 className="mono mb-4 text-xl font-semibold">
          {projectId} / compare
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
              onRename={handleRename}
              onDelete={handleDelete}
            />
          </aside>
          <main>
            {selected ? (
              <ComparisonView
                comparison={selected}
                projectId={projectId}
                onRename={(name) => handleRename(selected.id, name)}
                onDelete={() => handleDelete(selected.id)}
                onRemoveCard={(cardId) => handleRemoveCard(selected.id, cardId)}
              />
            ) : (
              <EmptyMainPane
                hasAny={comparisons.length > 0}
                onCreate={handleCreate}
              />
            )}
          </main>
        </div>
      </div>
    </ProjectProvider>
  );
}

// -----------------------------------------------------------------------------
// Breadcrumbs
// -----------------------------------------------------------------------------

function Breadcrumbs({ projectId }: { projectId: string }) {
  return (
    <nav className="mb-4 flex flex-wrap items-center gap-x-1 text-sm text-fg-muted">
      <Link to="/" className="hover:text-fg">
        Projects
      </Link>
      <span>›</span>
      <Link to={`/p/${projectId}`} className="mono hover:text-fg">
        {projectId}
      </Link>
      <span>›</span>
      <span className="text-fg">Compare</span>
    </nav>
  );
}

// -----------------------------------------------------------------------------
// Sidebar
// -----------------------------------------------------------------------------

interface SidebarProps {
  comparisons: Comparison[];
  selectedId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

function Sidebar({
  comparisons,
  selectedId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: SidebarProps) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
          Comparisons
        </h2>
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-bg text-sm text-fg-muted hover:border-accent hover:text-fg"
          aria-label="New comparison"
          title="New comparison"
        >
          {"\u002B"}
        </button>
      </div>
      {comparisons.length === 0 ? (
        <p className="text-xs text-fg-subtle">
          No comparisons yet. Click + to create one.
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
  projectId: string;
  onRename: (name: string) => void;
  onDelete: () => void;
  onRemoveCard: (cardId: string) => void;
}

function ComparisonView({
  comparison,
  projectId,
  onRename,
  onDelete,
  onRemoveCard,
}: ComparisonViewProps) {
  const [editingName, setEditingName] = useState(false);
  const [draft, setDraft] = useState(comparison.name);

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

      {comparison.cards.length === 0 ? (
        <div className="card p-6 text-sm text-fg-muted">
          Add scalar cards from any run using the{" "}
          <span className="mono">+</span> button in the card header.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {comparison.cards.map((card) => (
            <DraggableCard
              key={card.id}
              cardKey={card.id}
              section="comparison"
              onDragStart={() => {}}
              onDragEnd={() => {}}
            >
              <ComparisonCardRenderer
                card={card}
                comparisonId={comparison.id}
                projectId={projectId}
                onRemove={() => onRemoveCard(card.id)}
              />
            </DraggableCard>
          ))}
        </div>
      )}
    </div>
  );
}

interface ComparisonCardRendererProps {
  card: ComparisonCard;
  comparisonId: string;
  projectId: string;
  onRemove: () => void;
}

function ComparisonCardRenderer({
  card,
  comparisonId,
  onRemove,
}: ComparisonCardRendererProps) {
  // We synthesize a seed SequenceMeta from the first series. ScalarPlotCard
  // only uses `metric.name`, `metric.context_hash` for display/defaults, so
  // the remaining fields are best-effort placeholders.
  const primary = card.series[0];
  if (!primary) {
    return (
      <div className="card p-4 text-sm text-fg-muted flex items-baseline justify-between gap-2">
        <span>Empty scalar card.</span>
        <button type="button" className="btn text-xs" onClick={onRemove}>
          Remove
        </button>
      </div>
    );
  }

  const seedMetric: SequenceMeta = {
    name: primary.name,
    object_type: "scalar",
    context: null,
    context_hash: primary.context_hash,
    min_step: 0,
    max_step: 0,
    count: 0,
  };

  const extraSeries = card.series.slice(1);

  return (
    <ScalarPlotCard
      runId={primary.runId}
      metric={seedMetric}
      extraSeries={extraSeries}
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
