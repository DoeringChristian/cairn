/**
 * `parseOverlay` — turn a point's raw `artifact_metadata` JSON string into an
 * `ImageOverlayData` (box + segmentation-mask annotations), or `null` when
 * there are none / it doesn't parse.
 *
 * Moved into cairn-plot (from `components/viewport-registry.tsx`) so BOTH the
 * app (`viewport-registry` re-exports it for `VisualContentCard`'s overlay
 * settings aggregation) and the standalone plot bundle's LOCAL image provider
 * (`plot-main.tsx`) share ONE parser. Behavior-preserving — identical body to
 * the former app-owned copy. It has no dependency on the app's `api` client,
 * so it lives cleanly beside the `DataSource` seam (`data-sources.ts`).
 */
import type { ImageOverlayData, OverlayMask } from "../types";

export function parseOverlay(
  raw: string | null | undefined,
): ImageOverlayData | null {
  if (!raw) return null;
  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const boxes = Array.isArray(meta.boxes)
    ? (meta.boxes as ImageOverlayData["boxes"])
    : undefined;
  const masksObj =
    meta.masks && typeof meta.masks === "object"
      ? (meta.masks as Record<
          string,
          { png_b64: string; class_labels?: Record<string, string> }
        >)
      : undefined;
  const masks: OverlayMask[] | undefined = masksObj
    ? Object.entries(masksObj).map(([name, m]) => ({
        name,
        png_b64: m.png_b64,
        class_labels: m.class_labels,
      }))
    : undefined;
  const class_labels =
    meta.class_labels && typeof meta.class_labels === "object"
      ? (meta.class_labels as Record<string, string>)
      : undefined;
  if (!boxes?.length && !masks?.length) return null;
  return { boxes, masks, class_labels };
}
