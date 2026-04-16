import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject, ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  /** Optional title displayed at the top of the popover. */
  title?: string;
}

const DESKTOP_WIDTH = 320;
const MOBILE_BREAKPOINT = 768;
const VIEWPORT_PADDING = 8;

export default function SettingsPopover({
  open,
  onClose,
  anchorRef,
  children,
  title,
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<CSSProperties>({
    position: "fixed",
    visibility: "hidden",
    top: 0,
    left: 0,
    zIndex: 50,
  });

  // Measure + position after render so the anchor is in the DOM.
  useLayoutEffect(() => {
    if (!open) return;

    const measure = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      if (vw < MOBILE_BREAKPOINT) {
        const horizontalPadding = 16; // 1rem
        const width = Math.max(0, vw - horizontalPadding * 2);
        setStyle({
          position: "fixed",
          top: VIEWPORT_PADDING,
          left: horizontalPadding,
          width,
          zIndex: 50,
          visibility: "visible",
        });
        return;
      }

      // Desktop: right-align to the anchor's right edge, below it.
      const width = DESKTOP_WIDTH;
      let left = rect.right - width;
      // Keep within viewport bounds.
      if (left < VIEWPORT_PADDING) left = VIEWPORT_PADDING;
      if (left + width > vw - VIEWPORT_PADDING) {
        left = Math.max(VIEWPORT_PADDING, vw - VIEWPORT_PADDING - width);
      }

      let top = rect.bottom + 4;
      // If it would overflow the bottom, flip above the anchor.
      const panelHeight = panelRef.current?.offsetHeight ?? 0;
      if (panelHeight > 0 && top + panelHeight > vh - VIEWPORT_PADDING) {
        const flipped = rect.top - 4 - panelHeight;
        if (flipped >= VIEWPORT_PADDING) top = flipped;
      }

      setStyle({
        position: "fixed",
        top,
        left,
        width,
        zIndex: 50,
        visibility: "visible",
      });
    };

    measure();

    const onResize = () => measure();
    const onScroll = () => measure();
    window.addEventListener("resize", onResize);
    // Capture-phase scroll listener so we see scrolls from any ancestor.
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, anchorRef]);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current && panelRef.current.contains(target)) return;
      if (anchorRef.current && anchorRef.current.contains(target)) return;
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
  }, [open, onClose, anchorRef]);

  // Focus the first focusable child when opened.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = panel.querySelector<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={title ?? "Settings"}
      style={style}
      className="rounded-lg border border-border bg-bg-elevated p-4 shadow-lg"
    >
      {title && (
        <h3 className="mb-3 text-xs uppercase tracking-wide text-fg-muted">
          {title}
        </h3>
      )}
      {children}
    </div>
  );
}
