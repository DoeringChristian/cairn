/**
 * Reusable hook for making a card a drop target for series chips.
 *
 * Returns props to spread onto the card's outer div, plus a highlight
 * flag for visual feedback. The drop handler reads the current metrics
 * from a ref (not state) to avoid triggering re-renders during dragover.
 * Only the actual drop calls updateSettings.
 */

import { useCallback, useRef, useState } from "react";
import { CAIRN_SERIES_MIME, type SeriesRef } from "../components/SeriesChip";

interface UseSeriesDropOpts {
  /** Current metrics list — read via ref to avoid re-render loops. */
  metricsRef: React.RefObject<
    Array<{ runId?: string; name: string; context_hash: string }>
  >;
  /** Called once on a successful drop with the full new metrics array. */
  onMetricsChange: (
    next: Array<{ runId?: string; name: string; context_hash: string }>,
  ) => void;
}

export function useSeriesDrop({ metricsRef, onMetricsChange }: UseSeriesDropOpts) {
  const [highlight, setHighlight] = useState(false);
  // Counter-based enter/leave tracking avoids the flicker caused by
  // entering/leaving child elements within the card.
  const enterCount = useRef(0);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(CAIRN_SERIES_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(CAIRN_SERIES_MIME)) return;
    enterCount.current += 1;
    if (enterCount.current === 1) setHighlight(true);
  }, []);

  const onDragLeave = useCallback(() => {
    enterCount.current = Math.max(0, enterCount.current - 1);
    if (enterCount.current === 0) setHighlight(false);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      enterCount.current = 0;
      setHighlight(false);
      const raw = e.dataTransfer.getData(CAIRN_SERIES_MIME);
      if (!raw) return;
      e.preventDefault();
      try {
        const dropped: SeriesRef = JSON.parse(raw);
        const existing = metricsRef.current ?? [];
        const key = `${dropped.runId ?? ""}::${dropped.name}::${dropped.context_hash}`;
        const alreadyHas = existing.some(
          (m) =>
            `${m.runId ?? ""}::${m.name}::${m.context_hash}` === key,
        );
        if (!alreadyHas) {
          onMetricsChange([
            ...existing,
            {
              runId: dropped.runId,
              name: dropped.name,
              context_hash: dropped.context_hash,
            },
          ]);
        }
      } catch {
        /* malformed payload */
      }
    },
    [metricsRef, onMetricsChange],
  );

  return {
    highlight,
    dropProps: { onDragOver, onDragEnter, onDragLeave, onDrop },
  };
}
