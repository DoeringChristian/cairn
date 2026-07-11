/**
 * Shared `cairn:resize` auto-height hook for the standalone iframe/embed
 * entries (`embed-main.tsx`, `plot-main.tsx`).
 *
 * A host that wants to size its iframe to the rendered content needs a
 * signal: the standalone entries take a fixed-ish intrinsic height, so we
 * measure the mounted content via a `ResizeObserver` and post the same
 * `{type:"cairn:resize", height, protocolVersion:1}` message the HTML /
 * plugin cards use (see `card-kit/use-iframe-auto-height.ts` for the host
 * side). Extracted here so `embed-main` and `plot-main` share ONE definition
 * of the protocol rather than duplicating it.
 *
 * TODO(remote-embed): cross-origin hosts will need the `postMessage("*")`
 * target narrowed to the allowed host origin (same follow-up noted in
 * `embed-main.tsx`). LOCAL / SAME-ORIGIN only for now.
 */
import { useEffect, type RefObject } from "react";

/** Post the current content height to the host so it can size the iframe. */
export function useEmitAutoHeight(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const post = () => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      if (height > 0) {
        // TODO(remote-embed): narrow "*" to the allowed host origin.
        window.parent.postMessage(
          { type: "cairn:resize", height, protocolVersion: 1 },
          "*",
        );
      }
    };
    const ro = new ResizeObserver(post);
    ro.observe(el);
    post();
    return () => ro.disconnect();
  }, [ref]);
}
