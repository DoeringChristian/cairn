import { useCallback, useRef, useState, type ReactNode } from "react";

interface Props {
  /** Fraction widths for each pane, summing to ~1. Length must match children count. */
  widths: number[];
  /** Called when the user drags a handle. Returns new widths array. */
  onWidthsChange: (widths: number[]) => void;
  /** Optional minimum fraction per pane (default 0.1). */
  minFraction?: number;
  children: ReactNode[];
}

/**
 * N-way horizontal split with draggable handles between panes.
 *
 * Each child is rendered in a flex-item whose width is controlled by the
 * `widths` fraction array. Drag handles between panes let the user
 * redistribute space.
 */
export default function SplitPane({
  widths: widthsProp,
  onWidthsChange,
  minFraction = 0.1,
  children,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  // Fall back to equal widths when length mismatch.
  const n = children.length;
  const widths =
    widthsProp.length === n ? widthsProp : Array<number>(n).fill(1 / n);

  const handlePointerDown = useCallback(
    (handleIndex: number, startX: number) => {
      const container = containerRef.current;
      if (!container) return;

      setDragging(true);
      const containerWidth = container.getBoundingClientRect().width;
      const startWidths = [...widths];

      const onPointerMove = (e: PointerEvent) => {
        const dx = e.clientX - startX;
        const deltaFraction = dx / containerWidth;

        let leftW = startWidths[handleIndex]! + deltaFraction;
        let rightW = startWidths[handleIndex + 1]! - deltaFraction;

        // Clamp both panes to minFraction.
        if (leftW < minFraction) {
          rightW -= minFraction - leftW;
          leftW = minFraction;
        }
        if (rightW < minFraction) {
          leftW -= minFraction - rightW;
          rightW = minFraction;
        }

        // Safety: if still under min after double-clamp, bail.
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

  return (
    <div
      ref={containerRef}
      className="flex h-full"
      style={dragging ? { userSelect: "none" } : undefined}
    >
      {children.map((child, i) => (
        <div key={i} className="flex items-stretch">
          <div
            style={{ flex: `0 0 ${widths[i]! * 100}%` }}
            className="overflow-hidden"
          >
            {child}
          </div>
          {i < n - 1 && (
            <div
              className="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-border"
              onPointerDown={(e) => {
                e.preventDefault();
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                handlePointerDown(i, e.clientX);
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
