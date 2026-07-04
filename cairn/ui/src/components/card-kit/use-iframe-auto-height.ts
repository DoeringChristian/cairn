import { useEffect, useState, type RefObject } from "react";

export interface IframeAutoHeightOptions {
  /** Lower clamp for the reported height, px. */
  min: number;
  /** Upper clamp for the reported height, px. */
  max: number;
  /** When false the listener is not attached (returns the last value). Default true. */
  enabled?: boolean;
}

/**
 * Host-side subscriber for a sandboxed iframe's content-height resize shim.
 *
 * Both the HTML card (HtmlCard's RESIZE_SHIM) and the plugin card (its JS /
 * Python iframe shims) post the versioned message
 * `{ type: "cairn:resize", height, protocolVersion: 1 }` whenever their
 * content resizes. This hook is the single host-side counterpart: it
 * subscribes for its whole lifetime (the shim may post several times as the
 * iframe's layout settles, and a late or larger message is applied just like
 * the first), verifies the message came from *this* iframe's contentWindow,
 * matches the message type, ignores a height of 0 (a pre-layout artifact —
 * holding the last/fallback height reads better than collapsing to a sliver),
 * and clamps the result to `[min, max]`.
 *
 * Per the protocol's "receivers MUST ignore unknown fields" rule, extra
 * fields (incl. `protocolVersion`) are simply not read.
 *
 * Returns the last measured height (clamped), or `undefined` until a valid
 * message arrives — callers decide the pre-measurement fallback (e.g. a fixed
 * height, or letting the iframe flex to fill its parent).
 */
export function useIframeAutoHeight(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  { min, max, enabled = true }: IframeAutoHeightOptions,
): number | undefined {
  const [height, setHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;
    function onMessage(e: MessageEvent) {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.data?.type !== "cairn:resize") return;
      const h = Number(e.data.height);
      if (Number.isFinite(h) && h > 0) setHeight(Math.min(max, Math.max(min, h)));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [enabled, min, max, iframeRef]);

  return height;
}
