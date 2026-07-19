/**
 * `renderers/image-backend.ts` — the ONE place the interchangeable image
 * BACKEND contract lives.
 *
 * cairn-plot ships two interchangeable image-rendering backends that accept the
 * EXACT SAME props and are chosen upstream by a render mode:
 *   - `renderers/CpuImagePane.tsx` — the 2D-canvas / CSS-transform CPU backend
 *     (unifies the former `ImagePane` SDR pane + `HdrImagePane` float-HDR pane).
 *   - `renderers/GpuImagePane.tsx` — the WebGPU engine backend.
 * Both are `(props: ImageBackendProps) => JSX.Element` and are picked per mount
 * by `plot-renderers.tsx`'s `resolveImageRenderer(mode)` (the "backends used
 * upstream" seam). This module holds the shared prop union, the `isHdrProps`
 * discriminant, and the user-settable render-mode resolution so BOTH backends
 * (and the seam) import them from one spot with no import cycle onto either
 * pane component.
 */
import type {
  Colormap,
  DiffMode,
  ImageOverlayData,
  ImageOverlaySettings,
  ImageProcessing,
  Interpolation,
} from "../types";
import type { Viewport as ImageViewport } from "../hooks/use-image-viewport";
import type { PixelValueNotation } from "../primitives/PixelValueOverlay";

// ---------------------------------------------------------------------------
// HDR data contract — a parsed float `.npy` (from `parseNpy`, via the `imghdr`
// DataSpec). `[H,W]` grayscale, `[H,W,C]` with `C∈{1,3,4}`.
// ---------------------------------------------------------------------------
export interface HdrData {
  /** Flattened float samples in row-major order. */
  data: Float64Array | Float32Array;
  /** `[H,W]` | `[H,W,C]` with `C∈{1,3,4}`. */
  shape: number[];
  /** Raw numpy dtype string (e.g. `<f4`) — informational. */
  dtype: string;
}

/** The float-HDR prop shape (presence of `hdr` selects this backend path). */
export interface HdrGpuImagePaneProps {
  hdr: HdrData;
  tonemap?: string;
  exposure?: number;
  gamma?: number;
  showAxes?: boolean;
  label?: string;
  interpolation?: Interpolation;
  zoom?: number;
  pan?: { x: number; y: number };
  onViewportChange?: (v: ImageViewport) => void;
  pixelValueNotation?: PixelValueNotation;
}

/** The 8-bit `imageUrl` prop shape (plus the legacy compare/diff plumbing). */
export interface SdrGpuImagePaneProps {
  imageUrl: string | null;
  baselineUrl?: string | null;
  isBaseline?: boolean;
  diffMode?: "none" | DiffMode;
  interpolation?: Interpolation;
  colormap?: Colormap;
  showAxes?: boolean;
  processing?: ImageProcessing;
  zoom?: number;
  pan?: { x: number; y: number };
  onViewportChange?: (v: ImageViewport) => void;
  onNaturalSize?: (w: number, h: number) => void;
  label: string;
  isDraggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  className?: string;
  overlay?: ImageOverlayData;
  overlaySettings?: ImageOverlaySettings;
  pixelValueNotation?: PixelValueNotation;
}

/**
 * The shared prop union BOTH image backends accept. `HdrGpuImagePaneProps`
 * (float-HDR) | `SdrGpuImagePaneProps` (8-bit `imageUrl`), discriminated by
 * the presence of `hdr`.
 */
export type ImageBackendProps = HdrGpuImagePaneProps | SdrGpuImagePaneProps;

/**
 * The interchangeable image-backend interface: a component accepting the
 * shared {@link ImageBackendProps}. Both `CpuImagePane` and `GpuImagePane` are
 * assignable to this type; `resolveImageRenderer(mode)` returns one of them.
 */
export type ImageBackend = (props: ImageBackendProps) => JSX.Element;

/** Discriminant: `true` when these props select the float-HDR backend path. */
export function isHdrProps(p: ImageBackendProps): p is HdrGpuImagePaneProps {
  return "hdr" in p && (p as HdrGpuImagePaneProps).hdr != null;
}

// ---------------------------------------------------------------------------
// Shared HDR-decode primitives — used identically by both backends when they
// walk the raw float buffer (CpuImagePane's `tonemapToImageData`,
// GpuImagePane's `hdrToRGBAFloat32`). Kept here (not duplicated per pane) so
// the shape/channel contract has ONE definition.
// ---------------------------------------------------------------------------

/**
 * Decode an HDR `shape` into `(H, W, C)`. Grayscale `[H,W]` is treated as
 * `C=1`; `[H,W,C]` passes `C` through. Throws on any other rank.
 */
export function shapeDims(shape: number[]): { h: number; w: number; c: number } {
  if (shape.length === 2) return { h: shape[0]!, w: shape[1]!, c: 1 };
  if (shape.length === 3) return { h: shape[0]!, w: shape[1]!, c: shape[2]! };
  throw new Error(
    `cairn-plot image: unsupported HDR shape [${shape.join(",")}] (want [H,W] or [H,W,C]).`,
  );
}

/** NaN/±Inf → 0; finite values pass through. */
export function finite(v: number): number {
  return Number.isFinite(v) ? v : 0;
}

// ---------------------------------------------------------------------------
// User-settable render mode (backend selection).
//
// NOTE: distinct from `image.ts`'s `getRenderMode()`, which is the (unrelated)
// WebGL2-vs-CPU switch for the pixel-DIFF compute path. This `RenderMode`
// picks which whole image BACKEND (CPU 2D-canvas vs. WebGPU) renders a pane.
// ---------------------------------------------------------------------------
export type RenderMode = "cpu" | "gpu" | "auto";

declare global {
  interface Window {
    /** Settable global override for the image backend (see `resolveRenderMode`). */
    __cairnPlotRenderMode?: RenderMode;
  }
}

function isRenderMode(v: unknown): v is RenderMode {
  return v === "cpu" || v === "gpu" || v === "auto";
}

/**
 * Resolve the active render mode. FIRST DEFINED WINS:
 *   1. an explicit `renderMode` (threaded from the plot spec),
 *   2. `window.__cairnPlotRenderMode` (a settable global),
 *   3. the URL query `?render=cpu|gpu|auto`,
 *   4. default `"auto"`.
 */
export function resolveRenderMode(explicit?: RenderMode | string | null): RenderMode {
  if (isRenderMode(explicit)) return explicit;
  if (typeof window !== "undefined") {
    if (isRenderMode(window.__cairnPlotRenderMode)) return window.__cairnPlotRenderMode;
    try {
      const q = new URLSearchParams(window.location.search).get("render");
      if (isRenderMode(q)) return q;
    } catch {
      /* location unavailable — fall through to default */
    }
  }
  return "auto";
}
