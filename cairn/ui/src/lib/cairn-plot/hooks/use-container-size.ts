import { useEffect, useRef, useState, type RefObject } from "react";

export interface ContainerSize {
  w: number;
  h: number;
}

/**
 * Track an element's content-box size via ResizeObserver.
 *
 * By default this creates and returns its own ref to attach to the element
 * being measured. Pass `externalRef` to observe a node you already hold a
 * ref to (e.g. a card's root element that's also used for other purposes),
 * so a single card doesn't need two separate ResizeObservers on the same
 * node — one shared observer, one source of truth for size.
 */
export function useContainerSize<T extends HTMLElement = HTMLDivElement>(externalRef?: RefObject<T>) {
  const internalRef = useRef<T>(null);
  const ref = externalRef ?? internalRef;
  const [size, setSize] = useState<ContainerSize>({ w: 0, h: 0 });
  const roRef = useRef<ResizeObserver | null>(null);
  const observedElRef = useRef<T | null>(null);

  // Bug-A shared root cause: many cards only mount the measured container
  // once loading/data-gated JSX resolves (e.g. `anyLoading ? <skeleton/> :
  // <div ref={...}>`), so on first paint `ref.current` can still be `null`
  // when this hook's effect runs. A mount-only `useEffect(..., [ref])` (the
  // previous implementation) attaches its ResizeObserver to whatever
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
        setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    roRef.current = ro;
    ro.observe(el);
  });

  // Disconnect on unmount only (the per-render effect above already
  // disconnects+reconnects when the observed element changes).
  useEffect(() => () => roRef.current?.disconnect(), []);

  return { ref, size };
}
