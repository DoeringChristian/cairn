import type { ReactNode } from "react";
import SplitPane from "../SplitPane";
import { startViewportDrag, type SeriesRef } from "../SeriesChip";

interface Props {
  /** One key per pane (series), used for React keys and to look up labels. */
  paneKeys: string[];
  /** Run label badge per pane key. Panes without an entry render no badge. */
  labels: Map<string, string>;
  /** Modal → SplitPane (draggable split view). Card → wrapping grid. */
  inModal: boolean;
  /** Fraction widths for the modal SplitPane; defaults to equal split. */
  paneWidths?: number[];
  /** Persists SplitPane drag results (modal only). */
  onPaneWidthsChange: (widths: number[]) => void;
  /** Renders the content for one pane, given its key and index. */
  renderPane: (key: string, index: number) => ReactNode;
  /**
   * When provided, each labelled pane's badge becomes a "viewport label"
   * drag source (`startViewportDrag`, `CAIRN_IMAGE_MIME`) — the SAME
   * mechanic `ImagePane`/`CompositeMediaPane` use for image panes, so
   * dragging a 3D card's own pane onto another card's reference drop
   * target (`card-kit/use-reference-drop.ts`) initiates a GLOBAL reference
   * exactly like dragging an image pane does. Absent = non-draggable badge
   * (today's behavior, unchanged).
   */
  dragTags?: Map<string, SeriesRef>;
}

/**
 * Shared multi-pane layout for comparison cards (figure/audio/video).
 *
 * In a modal, panes are laid out with the draggable `SplitPane`. In a card,
 * panes are laid out in a wrapping grid (up to 2 columns) with an absolute
 * run-label badge in the top-left corner of each pane.
 */
export default function MultiPaneGrid({
  paneKeys,
  labels,
  inModal,
  paneWidths,
  onPaneWidthsChange,
  renderPane,
  dragTags,
}: Props) {
  if (inModal) {
    return (
      <SplitPane
        widths={paneWidths ?? Array(paneKeys.length).fill(1 / paneKeys.length)}
        onWidthsChange={onPaneWidthsChange}
      >
        {paneKeys.map((key, i) => renderPane(key, i))}
      </SplitPane>
    );
  }

  return (
    <div
      className="grid gap-1 flex-1 min-h-0 overflow-auto"
      style={{ gridTemplateColumns: `repeat(${Math.min(paneKeys.length, 2)}, 1fr)` }}
    >
      {paneKeys.map((key, i) => (
        <div key={key} className="relative overflow-hidden">
          {renderPane(key, i)}
          {labels.has(key) && (
            <span
              className="absolute top-1 left-1 z-10 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm"
              draggable={dragTags?.has(key) ?? false}
              onDragStart={
                dragTags?.has(key)
                  ? (e) => startViewportDrag(e, dragTags.get(key)!, labels.get(key) ?? key)
                  : undefined
              }
              style={dragTags?.has(key) ? { cursor: "grab" } : undefined}
            >
              {labels.get(key)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
