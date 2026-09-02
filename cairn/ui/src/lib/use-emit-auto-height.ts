import { useEffect, type RefObject } from "react";

/** Notify an iframe host when standalone card content changes height. */
export function useEmitAutoHeight(
  ref: RefObject<HTMLElement | null>,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return;
    const element = ref.current;
    if (!element) return;
    const post = () => {
      const height = Math.ceil(element.getBoundingClientRect().height);
      if (height > 0) {
        window.parent.postMessage(
          { type: "cairn:resize", height, protocolVersion: 1 },
          "*",
        );
      }
    };
    const observer = new ResizeObserver(post);
    observer.observe(element);
    post();
    return () => observer.disconnect();
  }, [ref, enabled]);
}
