/**
 * `hooks/use-series-visibility.ts` — per-series show/hide state for cairn-plot's
 * interactive legends (S6, Plotly legend parity).
 *
 * Owns a `hidden` Set of series keys. A legend chip drives it with the Plotly
 * idiom: single-click TOGGLES one series, double-click ISOLATES (hide all but
 * the clicked one; double-clicking an already-isolated series un-isolates back
 * to "all visible"). Self-contained per the project's self-contained-components
 * rule — the renderer holds its own visibility, no external store.
 *
 * The hook is told the current full key list so `isolate`/`showAll` know the
 * universe of series; keys that vanish from the data are pruned from `hidden`
 * on the next render so a removed-then-re-added series doesn't stay stuck.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface SeriesVisibility {
  /** Keys currently hidden. Never contains a key absent from the data. */
  hidden: ReadonlySet<string>;
  /** Convenience predicate. */
  isHidden: (key: string) => boolean;
  /** True when at least one series is hidden (gate a "show all" affordance). */
  anyHidden: boolean;
  /** Single-click: flip one series in/out of the hidden set. */
  toggle: (key: string) => void;
  /** Double-click: hide everything except `key`; if `key` is already the only
   *  visible series, clear the hidden set instead (un-isolate). */
  isolate: (key: string) => void;
  /** Force every series visible. */
  showAll: () => void;
}

export function useSeriesVisibility(keys: string[]): SeriesVisibility {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  // Prune stale keys (series that left the data) so `hidden` can never pin a
  // key the legend no longer shows.
  const keySet = useMemo(() => new Set(keys), [keys]);
  useEffect(() => {
    setHidden((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const k of prev) {
        if (keySet.has(k)) next.add(k);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [keySet]);

  // Latest key list behind a ref so isolate/showAll stay stable callbacks.
  const keysRef = useRef(keys);
  keysRef.current = keys;

  const toggle = useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const isolate = useCallback((key: string) => {
    setHidden((prev) => {
      const all = keysRef.current;
      const visible = all.filter((k) => !prev.has(k));
      // Already isolated to just this series → un-isolate (show all).
      if (visible.length === 1 && visible[0] === key) {
        return new Set<string>();
      }
      // Otherwise hide everything except `key`.
      return new Set(all.filter((k) => k !== key));
    });
  }, []);

  const showAll = useCallback(() => setHidden(new Set<string>()), []);

  const isHidden = useCallback((key: string) => hidden.has(key), [hidden]);

  return useMemo(
    () => ({
      hidden,
      isHidden,
      anyHidden: hidden.size > 0,
      toggle,
      isolate,
      showAll,
    }),
    [hidden, isHidden, toggle, isolate, showAll],
  );
}
