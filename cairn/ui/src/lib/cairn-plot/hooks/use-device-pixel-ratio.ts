import { useEffect, useState } from "react";

/**
 * Tracks `window.devicePixelRatio`, self-contained (Q22 fix — GPU image
 * canvases must be sized to `displaySize * dpr`, not the source image's
 * resolution, and must re-size when `dpr` itself changes: dragging a window
 * between a Retina and a plain external display, or an OS/browser zoom-level
 * change, changes `devicePixelRatio` WITHOUT firing any `resize` event on the
 * element being displayed).
 *
 * There is no native change-event for `devicePixelRatio` — the portable way
 * to observe it is a `matchMedia('(resolution: <dpr>dppx)')` query, which
 * fires `change` exactly once when the *current* dpr stops matching (i.e.
 * the instant it changes to anything else) and must be re-subscribed at the
 * NEW dpr to keep watching. Returns the current dpr; re-renders the caller
 * whenever it changes.
 */
export function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState<number>(() =>
    typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
  );

  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    let disposed = false;
    let mql: MediaQueryList | null = null;

    const onChange = () => {
      if (disposed) return;
      setDpr(window.devicePixelRatio || 1);
      attach();
    };

    function attach() {
      if (disposed) return;
      const current = window.devicePixelRatio || 1;
      mql = matchMedia(`(resolution: ${current}dppx)`);
      mql.addEventListener("change", onChange, { once: true });
    }

    attach();
    return () => {
      disposed = true;
      mql?.removeEventListener("change", onChange);
    };
  }, []);

  return dpr;
}
