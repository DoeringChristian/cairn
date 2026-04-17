import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import CardRenderer from "./CardRenderer";
import type { SequenceMeta } from "../api/types";
import { groupIntoSections } from "../lib/sections";
import {
  applyLayout,
  cardKeyOf,
  EMPTY_LAYOUT,
  isEmptyLayout,
  loadRunLayout,
  moveCard,
  resetRunLayout,
  saveRunLayout,
} from "../lib/run-layout";
import type { RunLayout } from "../lib/run-layout";
import DraggableCard, { CAIRN_CARD_MIME } from "./DraggableCard";

interface Props {
  runId: string;
  sequences: SequenceMeta[];
}

interface Entry {
  primary: SequenceMeta;
  extras: SequenceMeta[];
}

// ---------------------------------------------------------------------------
// Section collapse persistence helpers.
// ---------------------------------------------------------------------------
const COLLAPSED_SECTIONS_KEY_PREFIX = "cairn:collapsed-sections:";

function loadCollapsedSections(runId: string): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_SECTIONS_KEY_PREFIX + runId);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveCollapsedSections(runId: string, set: Set<string>): void {
  try {
    localStorage.setItem(
      COLLAPSED_SECTIONS_KEY_PREFIX + runId,
      JSON.stringify(Array.from(set)),
    );
  } catch {
    /* quota exceeded or disabled storage; silently drop */
  }
}

export default function CardGrid({ runId, sequences }: Props) {
  const [layout, setLayout] = useState<RunLayout>(() => loadRunLayout(runId));

  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () => loadCollapsedSections(runId),
  );

  // Reload persisted layout when the run changes.
  useEffect(() => {
    setLayout(loadRunLayout(runId));
    setCollapsedSections(loadCollapsedSections(runId));
  }, [runId]);

  const toggleSectionCollapse = useCallback(
    (sectionName: string) => {
      setCollapsedSections((prev) => {
        const next = new Set(prev);
        if (next.has(sectionName)) next.delete(sectionName);
        else next.add(sectionName);
        saveCollapsedSections(runId, next);
        return next;
      });
    },
    [runId],
  );

  // Track which section is currently being dragged over (for ring highlight).
  const [dragOverSection, setDragOverSection] = useState<string | null>(null);
  // Source section of the card currently being dragged. Used so drops onto
  // the same card are a no-op.
  const draggedRef = useRef<{ cardKey: string; section: string } | null>(null);

  const handleDragStart = useCallback((cardKey: string, section: string) => {
    draggedRef.current = { cardKey, section };
  }, []);

  const handleDragEnd = useCallback(() => {
    draggedRef.current = null;
    setDragOverSection(null);
  }, []);

  const commitMove = useCallback(
    (
      cardKey: string,
      fromSection: string,
      toSection: string,
      toIndex: number | null,
    ) => {
      setLayout((prev) => {
        const next = moveCard(prev, cardKey, fromSection, toSection, toIndex);
        saveRunLayout(runId, next);
        return next;
      });
    },
    [runId],
  );

  const handleReset = useCallback(() => {
    resetRunLayout(runId);
    setLayout({ ...EMPTY_LAYOUT });
  }, [runId]);

  const sections = useMemo(() => {
    const auto = groupIntoSections(sequences);
    return applyLayout(auto, layout);
  }, [sequences, layout]);

  if (sequences.length === 0) {
    return <p className="text-fg-muted">No metrics logged for this run yet.</p>;
  }

  const showReset = !isEmptyLayout(layout);

  return (
    <div className="space-y-8">
      {showReset && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleReset}
            className="text-xs text-fg-muted underline underline-offset-2 hover:text-fg"
            title="Clear persisted card layout for this run"
          >
            reset layout
          </button>
        </div>
      )}
      {sections.map((section) => {
        const entries = toEntries(section.items);
        // cardKey per rendered entry. Use the same convention `run-layout`
        // uses so drag payloads and layout lookups stay in sync.
        const entryKeys = entries.map((e) => cardKeyOf(e.primary));
        const isOver = dragOverSection === section.name;
        return (
          <SectionBlock
            key={section.name}
            sectionName={section.name}
            itemCount={entries.length}
            collapsed={collapsedSections.has(section.name)}
            onToggleCollapse={() => toggleSectionCollapse(section.name)}
            isOver={isOver}
            onSectionDragEnter={() => setDragOverSection(section.name)}
            onSectionDragLeave={() => {
              // Only clear if we're leaving the section wrapper entirely.
              setDragOverSection((cur) => (cur === section.name ? null : cur));
            }}
            onHeaderDrop={(e) => {
              const cardKey = e.dataTransfer.getData(CAIRN_CARD_MIME);
              if (!cardKey) return;
              const src = draggedRef.current;
              if (!src) return;
              e.preventDefault();
              // Drop on the header appends to the end of this section.
              commitMove(cardKey, src.section, section.name, null);
              setDragOverSection(null);
              draggedRef.current = null;
            }}
            onGridDrop={(e, gridEl) => {
              const cardKey = e.dataTransfer.getData(CAIRN_CARD_MIME);
              if (!cardKey) return;
              const src = draggedRef.current;
              if (!src) return;
              e.preventDefault();
              const index = computeDropIndex(gridEl, e.clientY, cardKey);
              // No-op if dropping on self at same spot in same section.
              if (
                src.section === section.name &&
                isNoopSelfDrop(entryKeys, cardKey, index)
              ) {
                setDragOverSection(null);
                draggedRef.current = null;
                return;
              }
              commitMove(cardKey, src.section, section.name, index);
              setDragOverSection(null);
              draggedRef.current = null;
            }}
          >
            {entries.map((entry) => {
              const key = cardKeyOf(entry.primary);
              return (
                <DraggableCard
                  key={key}
                  cardKey={key}
                  section={section.name}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                >
                  <CardFor runId={runId} entry={entry} />
                </DraggableCard>
              );
            })}
          </SectionBlock>
        );
      })}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Section wrapper with drop targets on both the header and the card grid.
// -----------------------------------------------------------------------------

interface SectionBlockProps {
  sectionName: string;
  itemCount: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  isOver: boolean;
  onSectionDragEnter: () => void;
  onSectionDragLeave: () => void;
  onHeaderDrop: (e: DragEvent<HTMLElement>) => void;
  onGridDrop: (e: DragEvent<HTMLDivElement>, gridEl: HTMLDivElement) => void;
  children: React.ReactNode;
}

function SectionBlock({
  sectionName,
  itemCount,
  collapsed,
  onToggleCollapse,
  isOver,
  onSectionDragEnter,
  onSectionDragLeave,
  onHeaderDrop,
  onGridDrop,
  children,
}: SectionBlockProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);

  const allowDrop = (e: DragEvent) => {
    // Only treat drags that carry our custom payload as reorder drags.
    // (DataTransfer.types is available during dragover; reading getData is not.)
    if (!e.dataTransfer.types.includes(CAIRN_CARD_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  return (
    <section
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes(CAIRN_CARD_MIME)) return;
        onSectionDragEnter();
      }}
      onDragLeave={(e) => {
        // Ignore leaves that cross into nested children.
        const related = e.relatedTarget as Node | null;
        if (related && e.currentTarget.contains(related)) return;
        onSectionDragLeave();
      }}
    >
      <header
        className="mb-3 flex items-baseline justify-between border-b border-border pb-1 cursor-pointer select-none"
        onDragOver={allowDrop}
        onDrop={onHeaderDrop}
        onClick={onToggleCollapse}
      >
        <div className="flex items-baseline gap-1.5">
          <span
            className="text-fg-subtle text-xs leading-none transition-transform"
            style={{ transform: collapsed ? "rotate(-90deg)" : undefined, display: "inline-block" }}
            aria-hidden="true"
          >
            {"\u25BC"}
          </span>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
            {sectionName}
          </h2>
        </div>
        <span className="text-xs text-fg-subtle">
          {collapsed ? `${itemCount} card(s) hidden` : `${itemCount} card(s)`}
        </span>
      </header>
      {!collapsed && (
        <div
          ref={gridRef}
          className={`grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-2 rounded transition-shadow ${
            isOver ? "outline outline-2 outline-accent -outline-offset-2" : ""
          }`}
          onDragOver={allowDrop}
          onDrop={(e) => {
            if (!gridRef.current) return;
            onGridDrop(e, gridRef.current);
          }}
        >
          {children}
        </div>
      )}
    </section>
  );
}

// -----------------------------------------------------------------------------
// Drop-index math.
// -----------------------------------------------------------------------------

/**
 * Find where in the grid a drop should land, given the mouse Y coordinate.
 *
 * We iterate through each child's bounding rect and compare `clientY` to the
 * vertical midpoint. The first child whose midpoint is below the cursor is
 * the insertion index. If no child matches (cursor below all rows), we
 * append (return null to signal "end").
 *
 * When the dragged card itself is present in the grid, we ignore it so the
 * reported index is stable (the child about to be removed shouldn't shift
 * the count under the cursor).
 */
function computeDropIndex(
  gridEl: HTMLDivElement,
  clientY: number,
  draggedCardKey: string,
): number | null {
  const children = Array.from(gridEl.children) as HTMLElement[];
  // Map from child element to its "logical" index (skipping the dragged one).
  let logicalIdx = 0;
  for (const child of children) {
    const key = child.getAttribute("data-card-key");
    if (key === draggedCardKey) continue;
    const rect = child.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    if (clientY < mid) return logicalIdx;
    logicalIdx++;
  }
  return null; // append
}

/**
 * Returns true if dragging a card within its own section to the same
 * position. In that case no layout change is needed.
 */
function isNoopSelfDrop(
  entryKeys: string[],
  cardKey: string,
  dropIndex: number | null,
): boolean {
  const curIdx = entryKeys.indexOf(cardKey);
  if (curIdx < 0) return false;
  if (dropIndex === null) {
    // Append — no-op if already last.
    return curIdx === entryKeys.length - 1;
  }
  // dropIndex is in "logical" coords (ignoring the dragged card itself).
  // In the current order with the dragged card removed, that card's
  // neighboring positions are curIdx and curIdx (since removing it collapses
  // the slot). So dropping at `curIdx` (before the next card) or `curIdx`
  // without it still produces the same ordering.
  return dropIndex === curIdx;
}

// -----------------------------------------------------------------------------
// Scalar collapsing + dispatch (unchanged behavior).
// -----------------------------------------------------------------------------

function toEntries(metas: SequenceMeta[]): Entry[] {
  // Each (name, context_hash) pair is an independent card — no grouping.
  // Users can merge metrics via chip drag-drop or the settings picker.
  return metas.map((m) => ({ primary: m, extras: [] }));
}

function CardFor({ runId, entry }: { runId: string; entry: Entry }) {
  return <CardRenderer runId={runId} metric={entry.primary} />;
}
