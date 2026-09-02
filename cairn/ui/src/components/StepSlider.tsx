/**
 * Reusable step slider with optional x-axis mode toggle (step / time / wall time).
 * Replaces raw `<input type="range">` in all non-scalar cards.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type XAxisMode = "step" | "relative_time" | "wall_time";

interface StepSliderProps {
  /** Sequence points — only `step` and `wall_time` are used. */
  points: ReadonlyArray<{ step: number; wall_time?: string | null }>;
  /** Current index into the points array. */
  currentIndex: number;
  /** Called when user drags the slider. */
  onChange: (index: number) => void;
  /** Minimum interval between live publishes; release always flushes. */
  publishIntervalMs?: number;
  /** Publish directly in the input event; intended for resident frame caches. */
  immediate?: boolean;
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
  publishIntervalMs = 50,
  immediate = false,
  xAxis = "step",
  onXAxisChange,
  className,
}: StepSliderProps) {
  const onChangeRef = useRef(onChange);
  const [draftIndex, setDraftIndex] = useState(currentIndex);
  const interactingRef = useRef(false);
  const frameRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<number | null>(null);
  const lastPublishRef = useRef(0);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (!interactingRef.current) setDraftIndex(currentIndex);
  }, [currentIndex]);
  const publishPending = useCallback(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending == null) return;
      lastPublishRef.current = performance.now();
      onChangeRef.current(pending);
    });
  }, []);
  const queueChange = useCallback((index: number) => {
    if (immediate) {
      pendingRef.current = null;
      lastPublishRef.current = performance.now();
      onChangeRef.current(index);
      return;
    }
    pendingRef.current = index;
    if (frameRef.current || timerRef.current != null) return;
    // FLIP/HDR-FLIP can submit several GPU passes per pane. Publishing every
    // native range-input event floods the GPU with obsolete intermediate
    // iterations. Keep only the latest index and cap authored updates at 20 Hz;
    // pointer/key release below flushes the final value immediately.
    const wait = Math.max(0, publishIntervalMs - (performance.now() - lastPublishRef.current));
    if (wait === 0) publishPending();
    else timerRef.current = setTimeout(() => {
      timerRef.current = null;
      publishPending();
    }, wait);
  }, [immediate, publishPending, publishIntervalMs]);
  const flushChange = useCallback(() => {
    interactingRef.current = false;
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (pendingRef.current != null) publishPending();
  }, [publishPending]);
  useEffect(() => () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    if (timerRef.current != null) clearTimeout(timerRef.current);
  }, []);

  const firstWallTime = useMemo(() => {
    const first = points[0]?.wall_time;
    return first ? new Date(first).getTime() : null;
  }, [points]);

  if (points.length <= 1) return null;

  const safeIdx = Math.min(Math.max(0, draftIndex), points.length - 1);
  const current = points[safeIdx]!;

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
          onPointerDown={() => { interactingRef.current = true; }}
          onChange={(e) => {
            const index = Number(e.target.value);
            setDraftIndex(index);
            queueChange(index);
          }}
          onPointerUp={flushChange}
          onKeyUp={flushChange}
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
