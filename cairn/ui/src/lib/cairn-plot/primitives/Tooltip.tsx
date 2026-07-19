import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { TOOLTIP_OFFSET } from "./tooltip-position";

/**
 * The ONE shared tooltip chrome (container look) for every cairn-plot renderer:
 * rounded corners, token-driven border + elevated background, drop shadow, and
 * the small-text/padding baseline. This is the single source of truth — both
 * the SVG renderers' shared <Tooltip> below AND the Recharts-based ScalarPlot's
 * CustomTooltip render their container with this exact class so no renderer's
 * tooltip diverges (e.g. sharp vs. rounded corners). Positioning-only classes
 * (absolute/z-index/pointer-events) live on the <Tooltip> wrapper, not here.
 */
export const TOOLTIP_CHROME_CLASS =
  "rounded border border-border bg-bg-elevated shadow-lg p-2 text-xs";

/**
 * Shared tooltip positioning model for every 2D cairn-plot renderer
 * (ScatterPlot, BarChart, HistogramPlot, Heatmap, ParallelCoords).
 *
 * COORDINATE SPACE — `x`/`y` are the cursor position in the RENDERER-CONTAINER
 * coordinate space (`event.clientX - containerRect.left`, etc.). `containerW`/
 * `containerH` are that SAME container rect's size. Callers always derive all
 * four from one `getBoundingClientRect()` via `tooltip-position.ts`, so the
 * space the cursor lives in is exactly the box this component flips/clamps
 * against. The tooltip is absolutely positioned inside that container.
 *
 * OFFSET — the tooltip is anchored a consistent `TOOLTIP_OFFSET` px to the
 * right and the same below the cursor (never under the pointer), and it follows
 * the cursor (renderers update `x`/`y` on every pointer move). This
 * cursor-relative offset is identical across all renderers.
 *
 * EDGE-FLIP + CLAMP — the tooltip's real rendered size is measured (so the
 * logic is correct for any content height, not a hardcoded guess). When the
 * preferred right/below placement would overflow the container it flips to the
 * left/above side of the cursor using the same gap; a final clamp keeps it
 * fully inside the container so it can never render off-screen / clipped.
 */
interface TooltipProps {
  x: number;
  y: number;
  containerW: number;
  containerH: number;
  width?: number;
  children: ReactNode;
}

export default function Tooltip({
  x,
  y,
  containerW,
  containerH,
  width = 220,
  children,
}: TooltipProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({
    w: width,
    h: 0,
  });

  // Measure the actual rendered box before paint so the flip/clamp below is
  // correct regardless of content height (useLayoutEffect runs synchronously
  // before the browser paints, so there is no visible jump).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setSize((prev) =>
      prev.w === r.width && prev.h === r.height
        ? prev
        : { w: r.width, h: r.height },
    );
  });

  // Prefer right/below; flip to the opposite side of the cursor on overflow.
  let left = x + TOOLTIP_OFFSET;
  if (left + size.w > containerW) left = x - TOOLTIP_OFFSET - size.w;
  let top = y + TOOLTIP_OFFSET;
  if (top + size.h > containerH) top = y - TOOLTIP_OFFSET - size.h;

  // Final guard: never let any edge escape the container.
  left = Math.max(4, Math.min(left, containerW - size.w - 4));
  top = Math.max(4, Math.min(top, containerH - size.h - 4));

  return (
    <div
      ref={ref}
      className={`pointer-events-none absolute z-50 w-fit ${TOOLTIP_CHROME_CLASS}`}
      style={{ maxWidth: width, left, top }}
    >
      {children}
    </div>
  );
}
