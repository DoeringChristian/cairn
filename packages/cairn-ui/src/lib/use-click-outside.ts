import { useEffect } from "react";
import type { RefObject } from "react";

/**
 * Close a dropdown/popover when the user clicks outside or presses Escape.
 *
 * @param ref        The element that should be considered "inside".
 * @param onClose    Called when an outside click or Escape is detected.
 * @param active     Only listen when true (default: true).
 * @param excludeRefs Additional elements that count as "inside" (e.g. the
 *                    anchor button that toggles the popover).
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  active?: boolean,
  excludeRefs?: RefObject<HTMLElement | null>[],
): void {
  useEffect(() => {
    if (active === false) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (ref.current?.contains(target)) return;
      if (excludeRefs) {
        for (const ex of excludeRefs) {
          if (ex.current?.contains(target)) return;
        }
      }
      onClose();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [ref, onClose, active, excludeRefs]);
}
