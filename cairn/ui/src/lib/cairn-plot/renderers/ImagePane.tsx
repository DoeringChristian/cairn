/**
 * ImagePane — THIN COMPATIBILITY SHIM over `CpuImagePane` (the unified CPU
 * image backend; see `renderers/image-backend.ts` for the backend contract).
 *
 * The former 544-line SDR/2D-canvas implementation moved verbatim into
 * `CpuImagePane.tsx`'s SDR branch. This shim keeps every existing importer
 * (`media-compare/compositor.tsx`, app cards, tests) working unchanged: same
 * default export, same `ImagePaneProps` (the required-field-stricter version
 * of the shared `SdrGpuImagePaneProps` shape), same rendering — it forwards
 * with `toolbar={false}` so legacy consumers keep the exact pre-unification
 * chrome (no `PlotToolbar`, the free-floating `PixelNotationToggle` chip).
 * Backend-seam mounts should use `CpuImagePane` directly instead.
 */
import type {
  Colormap,
  DiffMode,
  ImageProcessing,
  Interpolation,
  ImageOverlayData,
  ImageOverlaySettings,
} from "../types";
import type { Viewport as ImageViewport } from "../hooks/use-image-viewport";
import type { PixelValueNotation } from "../primitives/PixelValueOverlay";
import CpuImagePane from "./CpuImagePane";

export interface ImagePaneProps {
  imageUrl: string | null;
  baselineUrl: string | null;
  isBaseline?: boolean;
  diffMode: "none" | DiffMode;
  interpolation: Interpolation;
  colormap: Colormap;
  showAxes: boolean;

  processing?: ImageProcessing;

  zoom?: number;
  pan?: { x: number; y: number };
  onViewportChange?: (v: ImageViewport) => void;

  onNaturalSize?: (w: number, h: number) => void;
  label: string;
  isDraggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  className?: string;

  /** Optional bounding-box / segmentation-mask annotations for this image. */
  overlay?: ImageOverlayData;
  overlaySettings?: ImageOverlaySettings;

  /** Initial notation for the pixel-value overlay (user-toggleable in-pane). */
  pixelValueNotation?: PixelValueNotation;
}

export default function ImagePane(props: ImagePaneProps) {
  return <CpuImagePane {...props} toolbar={false} />;
}
