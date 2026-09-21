import { useId } from "react";

interface Props {
  label: string;
  /** `null` means "auto" — rendered as the placeholder. */
  value: number | null;
  onChange: (next: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Shown when value is null, e.g. "auto". */
  placeholder?: string;
  description?: string;
}

export default function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  step,
  placeholder = "auto",
  description,
}: Props) {
  const id = useId();
  return (
    <div className="py-1">
      <label htmlFor={id} className="mb-1 block text-sm text-fg">
        {label}
      </label>
      <input
        id={id}
        type="number"
        className="input num"
        value={value === null ? "" : value}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            onChange(null);
            return;
          }
          const parsed = Number(raw);
          if (Number.isNaN(parsed)) return;
          onChange(parsed);
        }}
      />
      {description && (
        <p className="mt-1 text-xs text-fg-muted">{description}</p>
      )}
    </div>
  );
}
