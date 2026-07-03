import { useCallback, useEffect, useMemo, useState } from "react";
import CardRenderer from "./CardRenderer";
import ReorderableCardGrid from "./ReorderableCardGrid";
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
import { loadJson, saveJson, storageKeys } from "../lib/storage";
import { CameraSyncContext, DEFAULT_CAMERA_SYNC_GROUP } from "../lib/camera-sync";

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
function loadCollapsedSections(runId: string): Set<string> {
  const raw = loadJson<string[]>(localStorage, storageKeys.collapsedSections(runId));
  return new Set(Array.isArray(raw) ? raw : []);
}

function saveCollapsedSections(runId: string, set: Set<string>): void {
  saveJson(localStorage, storageKeys.collapsedSections(runId), Array.from(set));
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
    <CameraSyncContext.Provider value={DEFAULT_CAMERA_SYNC_GROUP}>
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
          return (
            <SectionBlock
              key={section.name}
              sectionName={section.name}
              itemCount={entries.length}
              collapsed={collapsedSections.has(section.name)}
              onToggleCollapse={() => toggleSectionCollapse(section.name)}
            >
              <ReorderableCardGrid
                cards={entries.map((entry) => ({
                  key: cardKeyOf(entry.primary),
                  content: <CardFor runId={runId} entry={entry} />,
                }))}
                onReorder={(fromKey, toKey) => {
                  const src = { cardKey: fromKey, section: section.name };
                  const toIdx = entryKeys.indexOf(toKey);
                  commitMove(fromKey, src.section, section.name, toIdx >= 0 ? toIdx : null);
                }}
              />
            </SectionBlock>
          );
        })}
      </div>
    </CameraSyncContext.Provider>
  );
}

// -----------------------------------------------------------------------------
// Section wrapper with drop targets on both the header and the card grid.
// -----------------------------------------------------------------------------

export interface SectionBlockProps {
  sectionName: string;
  itemCount: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  children: React.ReactNode;
}

export function SectionBlock({
  sectionName,
  itemCount,
  collapsed,
  onToggleCollapse,
  children,
}: SectionBlockProps) {
  return (
    <section>
      <header
        className="mb-3 flex items-baseline justify-between border-b border-border pb-1 cursor-pointer select-none"
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
      {!collapsed && children}
    </section>
  );
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
