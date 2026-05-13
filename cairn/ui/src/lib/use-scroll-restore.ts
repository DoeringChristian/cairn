import { useEffect, useRef, type RefObject } from "react";

const PREFIX = "cairn:scroll:";

function read(key: string): number | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function write(key: string, y: number): void {
  try {
    sessionStorage.setItem(PREFIX + key, String(y));
  } catch {
    /* sessionStorage can be disabled — silently ignore */
  }
}

/** Persist window scroll-Y per `key` and restore once `ready` is true.
 *
 *  Pass `ready=true` when the list contents have rendered; otherwise the
 *  page is shorter than the saved offset and the restore is clamped to 0.
 */
export function useWindowScrollRestore(key: string, ready: boolean): void {
  const restored = useRef(false);

  useEffect(() => {
    if (restored.current || !ready) return;
    const y = read(key);
    if (y != null && y > 0) {
      // Two RAFs: first lets layout settle, second runs after paint so the
      // page actually has the scrollHeight needed to honor the offset.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => window.scrollTo(0, y));
      });
    }
    restored.current = true;
  }, [key, ready]);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        write(key, window.scrollY);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
      // Final flush so the most recent position is saved.
      write(key, window.scrollY);
    };
  }, [key]);
}

/** Persist an element's scrollTop per `key` and restore once `ready` is true. */
export function useElementScrollRestore(
  ref: RefObject<HTMLElement | null>,
  key: string,
  ready: boolean,
): void {
  const restored = useRef(false);

  useEffect(() => {
    if (restored.current || !ready) return;
    const el = ref.current;
    if (!el) return;
    const y = read(key);
    if (y != null && y > 0) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => el.scrollTo(0, y));
      });
    }
    restored.current = true;
  }, [ref, key, ready]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        write(key, el.scrollTop);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
      write(key, el.scrollTop);
    };
  }, [ref, key]);
}
