import { useId } from "react";

interface Props<T extends string> {
  label: string;
  value: T;
  onChange: (next: T) => void;
  options: Array<{ value: T; label: string }>;
  description?: string;
}

export default function Select<T extends string>({
  label,
  value,
  onChange,
  options,
  description,
}: Props<T>) {
  const id = useId();
  return (
    <div className="py-1">
      <label htmlFor={id} className="mb-1 block text-sm text-fg">
        {label}
      </label>
      <select
        id={id}
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {description && (
        <p className="mt-1 text-xs text-fg-muted">{description}</p>
      )}
    </div>
  );
}
