import { useCallback, useRef, useState, type ReactNode } from "react";

interface Props {
  /** Fraction widths for each pane, summing to ~1. Length must match children count. */
  widths: number[];
  /** Called when the user drags a handle. Returns new widths array. */
  onWidthsChange: (widths: number[]) => void;
  /** Optional minimum fraction per pane (default 0.1). */
  minFraction?: number;
  /** Minimum pixel width per pane before wrapping to grid (default 200). */
  minPaneWidth?: number;
  children: ReactNode[];
}

/**
 * N-way split layout.
 *
 * When all children fit side-by-side (container width / n >= minPaneWidth),
 * renders a horizontal flex layout with draggable resize handles.
 *
 * When children are too numerous, falls back to a CSS grid that wraps
 * items into rows automatically.
 */
export default function SplitPane({
  widths: widthsProp,
  onWidthsChange,
  minFraction = 0.1,
  minPaneWidth = 200,
  children,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);

  // Measure container on mount + resize.
  const measureRef = useCallback(
    (el: HTMLDivElement | null) => {
      (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
      if (!el) return;
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setContainerWidth(entry.contentRect.width);
        }
      });
      ro.observe(el);
      setContainerWidth(el.getBoundingClientRect().width);
      return () => ro.disconnect();
    },
    [],
  );

  const n = children.length;
  const widths =
    widthsProp.length === n ? widthsProp : Array<number>(n).fill(1 / n);

  // Decide layout mode: flex (side-by-side with handles) vs grid (wrapping).
  const useGrid = containerWidth > 0 && containerWidth / n < minPaneWidth;

  const handlePointerDown = useCallback(
    (handleIndex: number, startX: number) => {
      const container = containerRef.current;
      if (!container) return;

      setDragging(true);
      const cw = container.getBoundingClientRect().width;
      const startWidths = [...widths];

      const onPointerMove = (e: PointerEvent) => {
        const dx = e.clientX - startX;
        const deltaFraction = dx / cw;

        let leftW = startWidths[handleIndex]! + deltaFraction;
        let rightW = startWidths[handleIndex + 1]! - deltaFraction;

        if (leftW < minFraction) {
          rightW -= minFraction - leftW;
          leftW = minFraction;
        }
        if (rightW < minFraction) {
          leftW -= minFraction - rightW;
          rightW = minFraction;
        }
        if (leftW < minFraction || rightW < minFraction) return;

        const next = [...startWidths];
        next[handleIndex] = leftW;
        next[handleIndex + 1] = rightW;
        onWidthsChange(next);
      };

      const onPointerUp = () => {
        setDragging(false);
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [widths, minFraction, onWidthsChange],
  );

  // --- Grid mode: auto-fill wrapping grid ---
  if (useGrid) {
    return (
      <div
        ref={measureRef}
        className="grid h-full min-h-0 gap-1"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${minPaneWidth}px, 1fr))`,
        }}
      >
        {children.map((child, i) => (
          <div key={i} className="min-w-0 min-h-0 h-full overflow-hidden">
            {child}
          </div>
        ))}
      </div>
    );
  }

  // --- Flex mode: side-by-side with drag handles ---
  const items: ReactNode[] = [];
  children.forEach((child, i) => {
    items.push(
      <div
        key={`pane-${i}`}
        className="min-w-0 h-full overflow-hidden"
        style={{ flex: `${widths[i]! * 1000} 1 0%` }}
      >
        {child}
      </div>,
    );
    if (i < n - 1) {
      items.push(
        <div
          key={`handle-${i}`}
          className="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-border"
          onPointerDown={(e) => {
            e.preventDefault();
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            handlePointerDown(i, e.clientX);
          }}
        />,
      );
    }
  });

  return (
    <div
      ref={measureRef}
      className="flex h-full min-h-0"
      style={dragging ? { userSelect: "none" } : undefined}
    >
      {items}
    </div>
  );
}
