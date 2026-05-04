/**
 * Reusable step slider with optional x-axis mode toggle (step / time / wall time).
 * Replaces raw `<input type="range">` in all non-scalar cards.
 */

import { useMemo } from "react";

export type XAxisMode = "step" | "relative_time" | "wall_time";

interface StepSliderProps {
  /** Sequence points — only `step` and `wall_time` are used. */
  points: ReadonlyArray<{ step: number; wall_time?: string | null }>;
  /** Current index into the points array. */
  currentIndex: number;
  /** Called when user drags the slider. */
  onChange: (index: number) => void;
  /** Active x-axis display mode. */
  xAxis?: XAxisMode;
  /** If provided, show axis mode toggle buttons. */
  onXAxisChange?: (mode: XAxisMode) => void;
  className?: string;
}

function formatRelativeTime(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function formatWallTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

const MODES: { value: XAxisMode; label: string }[] = [
  { value: "step", label: "step" },
  { value: "relative_time", label: "time" },
  { value: "wall_time", label: "wall" },
];

export default function StepSlider({
  points,
  currentIndex,
  onChange,
  xAxis = "step",
  onXAxisChange,
  className,
}: StepSliderProps) {
  if (points.length <= 1) return null;

  const safeIdx = Math.min(Math.max(0, currentIndex), points.length - 1);
  const current = points[safeIdx]!;

  const firstWallTime = useMemo(() => {
    const first = points[0]?.wall_time;
    return first ? new Date(first).getTime() : null;
  }, [points]);

  let label: string;
  if (xAxis === "relative_time" && current.wall_time && firstWallTime != null) {
    const elapsed = (new Date(current.wall_time).getTime() - firstWallTime) / 1000;
    label = `+${formatRelativeTime(elapsed)}`;
  } else if (xAxis === "wall_time" && current.wall_time) {
    label = formatWallTime(current.wall_time);
  } else {
    label = `step ${current.step}`;
  }

  return (
    <div className={`relative z-10 ${className ?? ""}`}>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={points.length - 1}
          value={safeIdx}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-accent"
        />
        <span className="mono text-[10px] text-fg-muted shrink-0 min-w-[4rem] text-right">
          {label} ({safeIdx + 1}/{points.length})
        </span>
      </div>
      {onXAxisChange && (
        <div className="mt-1 flex gap-0.5">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => onXAxisChange(m.value)}
              className={`px-1.5 py-0.5 rounded text-[10px] ${
                xAxis === m.value
                  ? "bg-accent/15 text-accent"
                  : "text-fg-muted hover:bg-bg-hover hover:text-fg"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
