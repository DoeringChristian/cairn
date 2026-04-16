import type { ReactNode } from "react";

interface Props {
  /** Metric name, e.g. "train.loss". */
  title: string;
  /** Right-side subtle text, e.g. "step 15 of 50" or a count. */
  subtitle?: ReactNode;
  /** Action cluster on the right: quick-toggle buttons + ⚙️ settings button. */
  children?: ReactNode;
}

export default function CardHeader({ title, subtitle, children }: Props) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <h3 className="mono text-sm font-semibold">{title}</h3>
      <div className="flex items-center gap-1 text-xs text-fg-subtle">
        {subtitle}
        {children}
      </div>
    </div>
  );
}
