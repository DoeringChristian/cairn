/**
 * The report's single editing/rendering surface (WS-NR1 deliverables 1+3):
 * an "Obsidian-style" segmented inline editor over the report's canonical
 * `blocks[]` cell array — see
 * docs/superpowers/specs/2026-07-05-notebook-reports.md §3.A/§3.B.
 *
 * REPLACES: `ReportMarkdownBlock`'s textarea-beside-preview split *and*
 * `ReportEditorPage`'s whole-report "Markdown source" toggle (raw
 * `<textarea>` beside a `<ReportSourceMarkdown>` preview) — there is no
 * longer a separate raw/preview pane anywhere in the report editor. The
 * rendered view *is* the editor: every segment renders live by default
 * (prose via the shared `<Markdown>`, cards via the existing
 * `ReportCardsBlock`); clicking a prose *paragraph* swaps just that
 * paragraph into a raw `<textarea>` until blur.
 *
 * Cell model: `blocks[]` (lib/reports/types.ts) already *is* the segment
 * list `splitFences` produces (see markdown-source.ts's module doc — every
 * `MarkdownBlock` is one prose region between fences, every `CardsBlock` is
 * one ```cairn fence), so this component doesn't re-derive segments from
 * `source` — it renders/edits `blocks[]` directly, and `ReportEditorPage`
 * still serializes it to the canonical `source` on save (unchanged).
 * Ordering IS the markdown-canonical serialization order (block array
 * order = document order). `python` cells are Phase 2 — not implemented
 * here, but `CellKind`/the switch below leave room for a third case
 * without restructuring (see the design doc's phased plan).
 *
 * Prose editing granularity is per-paragraph (`splitProseBlocks`, blank-line
 * boundaries), not per-physical-line — a naive line-granular editor breaks
 * multi-line list items and tables. A ```cairn cell is edited as a whole
 * block via the existing `ReportCardsBlock` structured UI (run picker/"Add
 * card" modal/reorder) rather than a second raw-YAML textarea — reusing the
 * one card-editing surface instead of forking a parallel YAML-hand-editing
 * path (no-duplication guard).
 */

import { useEffect, useRef, useState } from "react";
import type { Run } from "../../api/types";
import Markdown from "../../lib/markdown";
import {
  isCardsBlock,
  isMarkdownBlock,
  newId,
  splitProseBlocks,
  type CardsBlock,
  type MarkdownBlock,
  type ReportBlock,
} from "../../lib/reports";
import ReportCardsBlock from "./ReportCardsBlock";

type CellType = ReportBlock["type"];

interface Props {
  projectId: string;
  reportId: string;
  blocks: ReportBlock[];
  editMode: boolean;
  allProjectRuns: Run[];
  onUpdateBlock: (id: string, next: ReportBlock) => void;
  onMoveBlock: (id: string, dir: -1 | 1) => void;
  onDeleteBlock: (id: string) => void;
  /** `afterId === null` inserts at the very end (the bottom "+ cell" affordance). */
  onInsertBlock: (afterId: string | null, type: CellType) => void;
}

export default function SegmentedMarkdownEditor({
  projectId,
  reportId,
  blocks,
  editMode,
  allProjectRuns,
  onUpdateBlock,
  onMoveBlock,
  onDeleteBlock,
  onInsertBlock,
}: Props) {
  if (blocks.length === 0) {
    return (
      <div className="card p-6 text-sm text-fg-muted">
        {editMode ? "No cells yet. Add a markdown or cards cell below." : "This report has no content yet."}
        {editMode && <InsertCellRow onInsert={(type) => onInsertBlock(null, type)} className="mt-3" />}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {blocks.map((block, idx) => (
        <div key={block.id} className="group/cell relative">
          {editMode && (
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wide text-fg-subtle">{block.type}</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onMoveBlock(block.id, -1)}
                  disabled={idx === 0}
                  className="h-5 w-5 inline-flex items-center justify-center rounded text-fg-subtle hover:bg-bg-hover hover:text-fg disabled:opacity-30"
                  title="Move up"
                  aria-label="Move cell up"
                >
                  {"↑"}
                </button>
                <button
                  type="button"
                  onClick={() => onMoveBlock(block.id, 1)}
                  disabled={idx === blocks.length - 1}
                  className="h-5 w-5 inline-flex items-center justify-center rounded text-fg-subtle hover:bg-bg-hover hover:text-fg disabled:opacity-30"
                  title="Move down"
                  aria-label="Move cell down"
                >
                  {"↓"}
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteBlock(block.id)}
                  className="h-5 w-5 inline-flex items-center justify-center rounded text-fg-subtle hover:bg-bg-hover hover:text-status-failed"
                  title="Delete cell"
                  aria-label="Delete cell"
                >
                  {"×"}
                </button>
              </div>
            </div>
          )}

          {isMarkdownBlock(block) ? (
            <MarkdownCellEditor
              block={block}
              editMode={editMode}
              onChange={(text) => onUpdateBlock(block.id, { ...block, text })}
            />
          ) : isCardsBlock(block) ? (
            <ReportCardsBlock
              projectId={projectId}
              reportId={reportId}
              block={block}
              editMode={editMode}
              allProjectRuns={allProjectRuns}
              onChange={(next) => onUpdateBlock(block.id, next)}
            />
          ) : null}

          {editMode && (
            <InsertCellRow
              onInsert={(type) => onInsertBlock(block.id, type)}
              className="mt-1.5 opacity-0 transition-opacity group-hover/cell:opacity-100 focus-within:opacity-100"
            />
          )}
        </div>
      ))}
    </div>
  );
}

/** Jupyter-ish "+ cell" affordance, shown between cells (on hover, edit mode only) and at the bottom of the document. */
function InsertCellRow({ onInsert, className = "" }: { onInsert: (type: CellType) => void; className?: string }) {
  return (
    <div className={`flex gap-2 ${className}`}>
      <button type="button" onClick={() => onInsert("markdown")} className="btn text-xs">
        + Markdown cell
      </button>
      <button type="button" onClick={() => onInsert("cards")} className="btn text-xs">
        + Cards cell
      </button>
    </div>
  );
}

/**
 * One `MarkdownBlock`'s prose, split into click-to-edit paragraphs
 * (`splitProseBlocks`). Only one paragraph is ever active (raw `<textarea>`)
 * at a time; every other paragraph renders live via `<Markdown>`. Typing
 * only updates a local draft — the parent's `blocks[]` (and thus any
 * autosave timer) isn't touched until blur/commit, exactly mirroring the
 * old block-level "edit, then re-render on blur" behavior, just scoped to
 * one paragraph instead of the whole block.
 */
function MarkdownCellEditor({
  block,
  editMode,
  onChange,
}: {
  block: MarkdownBlock;
  editMode: boolean;
  onChange: (text: string) => void;
}) {
  const paragraphs = splitProseBlocks(block.text);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (activeIdx != null) textareaRef.current?.focus();
  }, [activeIdx]);

  const activate = (i: number) => {
    if (!editMode) return;
    setDraft(paragraphs[i] ?? "");
    setActiveIdx(i);
  };

  const commit = () => {
    if (activeIdx == null) return;
    const next = [...paragraphs];
    next[activeIdx] = draft;
    setActiveIdx(null);
    onChange(next.join(""));
  };

  const cancel = () => setActiveIdx(null);

  if (!editMode) {
    return (
      <div className="rounded bg-bg p-3 text-sm">
        <Markdown>{block.text}</Markdown>
      </div>
    );
  }

  return (
    <div className="rounded bg-bg p-3 text-sm">
      {paragraphs.map((para, i) =>
        activeIdx === i ? (
          <textarea
            key={i}
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                cancel();
              } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                commit();
              }
            }}
            placeholder="Write markdown… (GFM tables, task lists, code fences supported)"
            className="input mb-1 w-full resize-y font-mono text-xs leading-relaxed"
            style={{ minHeight: `${Math.max(2, para.split("\n").length) * 1.4}em` }}
            spellCheck={false}
          />
        ) : (
          <div
            key={i}
            onClick={() => activate(i)}
            className="cursor-text rounded hover:bg-bg-hover/60"
            title="Click to edit"
          >
            {para.trim() ? (
              <Markdown>{para}</Markdown>
            ) : (
              <p className="my-1.5 text-fg-subtle">{" "}</p>
            )}
          </div>
        ),
      )}
    </div>
  );
}

export function makeEmptyBlock(type: CellType): ReportBlock {
  return type === "markdown"
    ? ({ id: newId(), type: "markdown", text: "" } satisfies MarkdownBlock)
    : ({ id: newId(), type: "cards", runIds: [], cards: [] } satisfies CardsBlock);
}
