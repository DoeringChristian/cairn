import { useId } from "react";

interface Props {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  description?: string;
}

/**
 * Accessible toggle row: label + description on the left, a styled checkbox
 * acting as a switch on the right. Clicking the label toggles the checkbox
 * (native <label htmlFor> association).
 */
export default function Toggle({ label, checked, onChange, description }: Props) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <label
          htmlFor={id}
          className="block cursor-pointer select-none text-sm text-fg"
        >
          {label}
        </label>
        {description && (
          <p className="mt-0.5 text-xs text-fg-subtle">{description}</p>
        )}
      </div>
      <label
        htmlFor={id}
        className="relative inline-flex shrink-0 cursor-pointer items-center"
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className="h-5 w-9 rounded-full border border-border bg-bg transition-colors peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-fg-muted transition-transform peer-checked:translate-x-4 peer-checked:bg-bg-elevated"
        />
      </label>
    </div>
  );
}
