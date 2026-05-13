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
