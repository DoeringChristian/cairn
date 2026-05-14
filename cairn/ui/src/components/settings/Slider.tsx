import { useId } from "react";

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
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent"
      />
      {description && (
        <p className="mt-1 text-xs text-fg-muted">{description}</p>
      )}
    </div>
  );
}
