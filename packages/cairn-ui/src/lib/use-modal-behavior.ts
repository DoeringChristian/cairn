import { useEffect, useLayoutEffect } from "react";

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

  // Prevent body scroll while open. A layout effect, not a passive one:
  // hiding the body scrollbar changes the viewport width, so doing it after
  // the first paint reflows the modal once it is already on screen — and any
  // consumer that measures the modal's box on open (card-kit/use-overlay-slot)
  // would measure the pre-lock layout and then have to correct itself.
  useLayoutEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
}
