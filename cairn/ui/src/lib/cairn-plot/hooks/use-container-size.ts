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

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries)
        setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return { ref, size };
}
