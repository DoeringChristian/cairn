import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

export interface ContainerSize {
  w: number;
  h: number;
}

/**
 * Track an element's content-box size.
 *
 * By default this creates and returns its own ref to attach to the element
 * being measured. Pass `externalRef` to observe a node you already hold a
 * ref to (e.g. a card's root element that's also used for other purposes),
 * so a single card doesn't need two separate ResizeObservers on the same
 * node — one shared observer, one source of truth for size.
 *
 * Two measurement paths feed the returned `size`:
 *   1. A SYNCHRONOUS first-paint seed (`useLayoutEffect` + `getBoundingClientRect`)
 *      so a freshly-mounted container reports its real size on the FIRST commit,
 *      before the browser paints.
 *   2. A ResizeObserver for every subsequent live resize (container grows/shrinks,
 *      zoom, window resize, grid reflow).
 * Both funnel through `apply`, which no-ops when the size is unchanged.
 */
export function useContainerSize<T extends HTMLElement = HTMLDivElement>(externalRef?: RefObject<T>) {
  const internalRef = useRef<T>(null);
  const ref = externalRef ?? internalRef;
  const [size, setSize] = useState<ContainerSize>({ w: 0, h: 0 });
  const roRef = useRef<ResizeObserver | null>(null);
  const observedElRef = useRef<T | null>(null);
  const seededElRef = useRef<T | null>(null);

  // Commit a new size, bailing when it hasn't actually changed so the
  // synchronous seed and the ResizeObserver's (identical) first delivery don't
  // cost a redundant render.
  const apply = useCallback((w: number, h: number) => {
    setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
  }, []);

  // ── Synchronous first-paint measurement ──
  // The chart/canvas renderers gate their `<svg>`/`<canvas>` on a measured,
  // non-zero size (`plotW > 0 && plotH > 0`). If the ONLY size source were the
  // ResizeObserver — whose first delivery is asynchronous, one frame AFTER
  // mount — then every chart renders an empty "measuring" frame first, and any
  // observer/consumer that reads the DOM in that window (a headless
  // `--dump-dom`/screenshot capture, or simply a heavy page where that frame is
  // delayed) sees a toolbar with NO chart body. Measuring here, in a layout
  // effect (runs before paint) that forces layout via `getBoundingClientRect`,
  // makes the real size known on the first commit, so the chart body is painted
  // immediately and deterministically. Re-seeds whenever the observed element
  // changes identity (e.g. a loading/data gate finally mounts the real node);
  // best-effort — skips when the element isn't mounted yet or is still 0×0, in
  // which case the ResizeObserver below picks it up once it lays out.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || el === seededElRef.current) return;
    const r = el.getBoundingClientRect();
    if (r.width > 0 || r.height > 0) {
      seededElRef.current = el;
      apply(r.width, r.height);
    }
  });

  // ── Live resize tracking ──
  // Bug-A shared root cause: many cards only mount the measured container
  // once loading/data-gated JSX resolves (e.g. `anyLoading ? <skeleton/> :
  // <div ref={...}>`), so on first paint `ref.current` can still be `null`
  // when this hook's effect runs. A mount-only `useEffect(..., [ref])` (an
  // earlier implementation) attaches its ResizeObserver to whatever
  // `ref.current` was AT THAT MOMENT and never reconsiders — `ref` itself
  // (the object) never changes identity, so the effect never reruns even
  // after the real element mounts on a later render. The result is a card
  // permanently stuck at `{w:0,h:0}`, which renderers correctly refuse to
  // paint into — a blank card that no amount of step-scrubbing fixes,
  // because nothing ever re-attaches the observer.
  //
  // Fix: run this effect after EVERY render (no dependency array) and
  // compare `ref.current` to the element we last attached to. Re-attaching
  // is a no-op in the common case (same element every render); it only does
  // work when the observed node actually changed — including "went from
  // null to a real element" once the loading/conditional gate clears.
  useEffect(() => {
    const el = ref.current;
    if (el === observedElRef.current) return;
    roRef.current?.disconnect();
    roRef.current = null;
    observedElRef.current = el;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries)
        apply(entry.contentRect.width, entry.contentRect.height);
    });
    roRef.current = ro;
    ro.observe(el);
  });

  // Disconnect on unmount only (the per-render effect above already
  // disconnects+reconnects when the observed element changes).
  useEffect(() => () => roRef.current?.disconnect(), []);

  return { ref, size };
}
