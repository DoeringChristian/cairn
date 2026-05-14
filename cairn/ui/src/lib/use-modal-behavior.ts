import { useEffect } from "react";

/**
 * Shared modal behaviour: prevent body scroll and close on Escape.
 *
 * @param open    Whether the modal is currently visible.
 * @param onClose Called when the user presses Escape.
 */
export function useModalBehavior(open: boolean, onClose: () => void): void {
  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Prevent body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
}
