import { useEffect } from "react";
import type { ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  settingsContent: ReactNode;
  title: string;
}

export default function CardDetailModal({
  open,
  onClose,
  children,
  settingsContent,
  title,
}: Props) {
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Prevent body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal content */}
      <div className="relative z-10 flex flex-1 m-4 rounded-lg border border-border bg-bg overflow-hidden">
        {/* Card at full size */}
        <div className="flex-1 min-w-0 p-6 overflow-auto flex flex-col">
          <h2 className="mono text-lg font-semibold mb-4 shrink-0">{title}</h2>
          <div className="flex-1 min-h-0">{children}</div>
        </div>

        {/* Settings panel */}
        <div className="w-80 shrink-0 border-l border-border p-4 overflow-y-auto bg-bg-elevated">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Settings
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg text-lg"
              aria-label="Close"
            >
              {"\u00D7"}
            </button>
          </div>
          {settingsContent}
        </div>
      </div>
    </div>
  );
}
