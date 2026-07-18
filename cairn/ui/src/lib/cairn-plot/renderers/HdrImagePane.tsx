/**
 * HdrImagePane — THIN COMPATIBILITY SHIM over `CpuImagePane` (the unified CPU
 * image backend; see `renderers/image-backend.ts` for the backend contract).
 *
 * The former float-HDR tonemap-to-canvas implementation moved verbatim into
 * `CpuImagePane.tsx`'s HDR branch (including `tonemapToImageData`, re-exported
 * below for existing callers). This shim keeps every existing importer working
 * unchanged: same default export, same `HdrImagePaneProps`/`HdrData` (the
 * canonical `HdrData` now lives in `image-backend.ts`), same rendering — it
 * forwards with `toolbar={false}` so legacy consumers keep the exact
 * pre-unification chrome (no `PlotToolbar`, the floating notation chip).
 * Backend-seam mounts should use `CpuImagePane` directly instead.
 */
import type { Interpolation } from "../types";
import type { Viewport as ImageViewport } from "../hooks/use-image-viewport";
import type { PixelValueNotation } from "../primitives/PixelValueOverlay";
import CpuImagePane, { tonemapToImageData } from "./CpuImagePane";
import type { HdrData } from "./image-backend";

export { tonemapToImageData };
export type { HdrData };

export interface HdrImagePaneProps {
  hdr: HdrData;
  /** Tone-map operator name (`TONEMAP_OPERATORS` key). Default `"srgb"`. */
  tonemap?: string;
  /** Exposure in EV stops (× 2**exposure). Default `0`. */
  exposure?: number;
  /** Optional output-encode gamma override (`pow(x,1/gamma)`). Unset = sRGB OETF (correct for all operators). */
  gamma?: number;
  showAxes?: boolean;
  label?: string;
  interpolation?: Interpolation;

  /** Viewport (modifier-gated wheel-zoom + drag-pan). Controlled; the adapter
   *  owns the state. Defaults to identity so the pane renders un-zoomed. */
  zoom?: number;
  pan?: { x: number; y: number };
  onViewportChange?: (v: ImageViewport) => void;

  /** Initial notation for the pixel-value overlay (user-toggleable in-pane). */
  pixelValueNotation?: PixelValueNotation;
}

export default function HdrImagePane(props: HdrImagePaneProps) {
  return <CpuImagePane {...props} toolbar={false} />;
}
