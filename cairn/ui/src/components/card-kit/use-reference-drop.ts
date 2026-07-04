import { useCallback, useState } from "react";
import type { DragEvent } from "react";
import { CAIRN_IMAGE_MIME, CAIRN_SERIES_MIME, type SeriesRef } from "../SeriesChip";

export interface UseReferenceDropOpts {
  /**
   * Fires when a SERIES CHIP (`CAIRN_SERIES_MIME`) is dropped — "the label
   * from another view": a bare series identity with no image bound to it.
   * Per spec-visual-compare.md this initiates a PER-RUN reference (each
   * pane resolves its own copy of this series name, step-matched).
   */
  onSeriesDrop: (ref: SeriesRef) => void;
  /**
   * Fires when a rendered VIEWPORT (`CAIRN_IMAGE_MIME`) is dropped — an
   * already-resolved pane (a concrete image, or a 3D pane's snapshot).
   * Initiates a GLOBAL reference (one shared baseline for every pane).
   */
  onViewportDrop: (ref: SeriesRef) => void;
}

export interface UseReferenceDropResult {
  /** True while a valid drag hovers the drop target — for outline feedback. */
  highlight: boolean;
  dropProps: {
    onDragOver: (e: DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (e: DragEvent) => void;
  };
}

/**
 * The ONE drop-target implementation for "set up a media comparison by
 * dragging a label" — extracted verbatim (behavior-preserving) from
 * ImageGalleryCard's `onRefDragOver`/`onRefDragLeave`/`onRefDrop`, so the
 * image card and every 3D card (mesh/pointcloud/boxes3d/volume) share this
 * mechanic instead of each re-implementing the dataTransfer parsing.
 *
 * Callers wire the two payload kinds to their own settings shape (field
 * names differ per card: image uses `mode`/`referenceMode`, 3D cards use
 * `compareMode`/`referenceMode`) — that mapping is inherently per-card, but
 * the drag/drop mechanics (types check, preventDefault, dropEffect,
 * highlight state, JSON parse + stopPropagation so the generic "add series"
 * drop target on an ancestor element doesn't also fire) are here ONCE.
 */
export function useReferenceDrop({
  onSeriesDrop,
  onViewportDrop,
}: UseReferenceDropOpts): UseReferenceDropResult {
  const [highlight, setHighlight] = useState(false);

  const onDragOver = useCallback((e: DragEvent) => {
    if (
      e.dataTransfer.types.includes(CAIRN_SERIES_MIME) ||
      e.dataTransfer.types.includes(CAIRN_IMAGE_MIME)
    ) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setHighlight(true);
    }
  }, []);

  const onDragLeave = useCallback(() => setHighlight(false), []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      setHighlight(false);

      const chipData = e.dataTransfer.getData(CAIRN_SERIES_MIME);
      if (chipData) {
        e.stopPropagation();
        try {
          onSeriesDrop(JSON.parse(chipData) as SeriesRef);
        } catch { /* malformed payload */ }
        return;
      }

      const imageData = e.dataTransfer.getData(CAIRN_IMAGE_MIME);
      if (imageData) {
        e.stopPropagation();
        try {
          onViewportDrop(JSON.parse(imageData) as SeriesRef);
        } catch { /* malformed payload */ }
        return;
      }
    },
    [onSeriesDrop, onViewportDrop],
  );

  return { highlight, dropProps: { onDragOver, onDragLeave, onDrop } };
}
