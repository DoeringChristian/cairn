import { useCallback, useEffect, useId, useRef } from "react";

interface Props {
  label: string;
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  step?: number;
  /** Formatting of the numeric display next to the label (e.g. `(v) => v.toFixed(2)`). */
  format?: (v: number) => string;
  description?: string;
}

export default function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step,
  format,
  description,
}: Props) {
  const id = useId();
  const onChangeRef = useRef(onChange);
  const frameRef = useRef(0);
  const pendingRef = useRef<number | null>(null);
  onChangeRef.current = onChange;

  const queueChange = useCallback((next: number) => {
    pendingRef.current = next;
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending != null) onChangeRef.current(pending);
    });
  }, []);

  useEffect(() => () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
  }, []);

  const display = format ? format(value) : String(value);
  return (
    <div className="py-1">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm text-fg">
          {label}
        </label>
        <span className="num text-xs text-fg-muted">{display}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => queueChange(Number(e.target.value))}
        className="w-full accent-accent"
      />
      {description && (
        <p className="mt-1 text-xs text-fg-muted">{description}</p>
      )}
    </div>
  );
}
