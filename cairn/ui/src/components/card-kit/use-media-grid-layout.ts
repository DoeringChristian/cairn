import { useMemo } from "react";
import { resolveCardHeight } from "../../lib/card-settings";
import type { BaseCardSettings } from "./base-settings";

/** Tailwind `gap-1` (0.25rem @ 16px root) — the grid's inter-row gap. */
export const MEDIA_GRID_GAP_PX = 4;

export interface MediaGridLayout {
  cols: number;
  rows: number;
  /** The ONE shared cell height (aspect-correct), or null before the first
   *  natural-size report / container measurement. */
  cellHeight: number | null;
  /** Auto container height (exact fit for `rows` rows) when no explicit card
   *  height is persisted; undefined when a persisted height rules. */
  autoHeight: string | undefined;
}

/**
 * ONE shared cell-sizing computation for EVERY pane in a media card's grid:
 * the grid's own column count and the per-item aspect drive a single row
 * height, applied BOTH to the auto container height AND to `gridAutoRows`,
 * so every row is identical regardless of pane count, mount order or
 * `align-content` — a cell never inherits its height from a sibling row.
 * Extracted verbatim from the dissolved media shell.
 */
export function useMediaGridLayout(args: {
  paneCount: number;
  imageColumns: number | undefined;
  contentAspect: number | null;
  containerWidth: number;
  settings: BaseCardSettings & { imageColumns?: number };
  minHeight: number;
}): MediaGridLayout {
  const { paneCount, imageColumns, contentAspect, containerWidth, settings, minHeight } = args;

  const gridMetrics = useMemo(() => {
    const n = Math.max(paneCount, 1);
    const cols = Math.max(1, imageColumns ?? 2);
    const rows = Math.ceil(n / cols);
    if (!contentAspect || containerWidth <= 0) return { cols, rows, cellHeight: null as number | null };
    const paneWidth = containerWidth / cols;
    const rowHeight = paneWidth * contentAspect + 24;
    const cellHeight = Math.max(120, Math.min(500, rowHeight));
    return { cols, rows, cellHeight };
  }, [paneCount, imageColumns, contentAspect, containerWidth]);

  const autoHeight = useMemo((): string | undefined => {
    if (resolveCardHeight(settings, undefined, minHeight) != null) return undefined;
    if (gridMetrics.cellHeight == null) return "20rem";
    const { rows, cellHeight } = gridMetrics;
    // Include the inter-row gaps so the container is an EXACT fit for `rows`
    // rows — no leftover space for `align-content` to stretch and no phantom
    // overflow scrollbar.
    return `${Math.round(rows * cellHeight + (rows - 1) * MEDIA_GRID_GAP_PX)}px`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.height, settings.height1, settings.height2, settings.colSpan, gridMetrics, minHeight]);

  return { ...gridMetrics, autoHeight };
}
