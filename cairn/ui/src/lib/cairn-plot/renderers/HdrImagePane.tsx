/**
 * HdrImagePane — the true float-HDR image renderer (cairn-plot HDR-A).
 *
 * Unlike `ImagePane` (which shows an already-8-bit `<img>` and whose
 * exposure/gamma controls are cosmetic CSS/SVG filters over 8-bit pixels), this
 * renderer receives the image as FLOAT array data (a parsed float `.npy`, via
 * the `imghdr` DataSpec) and does real HDR tone-mapping CLIENT-SIDE:
 *
 *   float scene-linear pixel
 *     → applyExposure(v, EV)               (× 2**exposure)
 *     → TONEMAP_OPERATORS[tonemap](rgb)    (HDR [0,∞) → display-linear [0,1])
 *     → outputEncode(x, gamma)            (sRGB OETF by default; pow(x,1/gamma) if gamma set)
 *     → 8-bit RGBA into an ImageData → putImageData onto a <canvas>.
 *
 * The decode is a single CPU pass recomputed whenever the data OR any of
 * `tonemap` / `exposure` / `gamma` changes (a `useEffect` on those deps). This
 * is the honest proof HDR is applied: changing exposure/operator changes the
 * actual canvas pixels, not a CSS filter. CPU decode is fine for v1 sizes; the
 * WebGPU engine (`engine/image-engine.ts`, `renderers/GpuImagePane.tsx`)
 * ports this exact pipeline to a GPU fragment shader for large images / live
 * scrubbing — this component remains the LEGACY CPU fallback the engine
 * renders through when WebGPU is unavailable (see
 * `docs/superpowers/specs/2026-07-16-webgpu-engine-design.md`).
 *
 * SHAPE: `[H,W]` grayscale, `[H,W,1]` gray, `[H,W,3]` rgb, `[H,W,4]` rgba.
 * NaN/Inf pixels are treated as 0. The pane fills its container (like
 * ImagePane); the standalone adapter's `ChartBox` provides the sizing box.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getTonemapOperator,
  applyExposure,
  outputEncode,
  type RgbTriple,
} from "../image/tonemap";
import type { Interpolation } from "../types";
import PixelAxes from "../primitives/PixelAxes";
import LabelChip from "../primitives/LabelChip";
import PixelValueOverlay, {
  CHANNEL_COLORS,
  PixelNotationToggle,
  formatChannelValue,
  type PixelSample,
  type PixelValueNotation,
} from "../primitives/PixelValueOverlay";
import { useImageViewport, type Viewport as ImageViewport } from "../hooks/use-image-viewport";

export interface HdrData {
  /** Flattened float samples in row-major order (from `parseNpy`). */
  data: Float64Array | Float32Array;
  /** `[H,W]` | `[H,W,C]` with `C∈{1,3,4}`. */
  shape: number[];
  /** Raw numpy dtype string (e.g. `<f4`) — informational. */
  dtype: string;
}

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

/** Decode HDR shape into (H, W, C). Grayscale `[H,W]` is treated as C=1. */
function shapeDims(shape: number[]): { h: number; w: number; c: number } {
  if (shape.length === 2) return { h: shape[0]!, w: shape[1]!, c: 1 };
  if (shape.length === 3)
    return { h: shape[0]!, w: shape[1]!, c: shape[2]! };
  throw new Error(
    `HdrImagePane: unsupported shape [${shape.join(",")}] (want [H,W] or [H,W,C]).`,
  );
}

const finite = (v: number): number => (Number.isFinite(v) ? v : 0);

/**
 * Tone-map the float HDR buffer into an 8-bit RGBA `ImageData`. Pure — no DOM
 * beyond the `ImageData` allocation. Exposure → operator → output-encode per
 * pixel, exactly the pipeline documented in `tonemap.ts`.
 */
export function tonemapToImageData(
  hdr: HdrData,
  tonemap: string,
  exposure: number,
  gamma?: number,
): ImageData {
  const { h, w, c } = shapeDims(hdr.shape);
  const src = hdr.data;
  const op = getTonemapOperator(tonemap);
  const out = new Uint8ClampedArray(w * h * 4);

  for (let i = 0; i < w * h; i++) {
    const base = i * c;
    let r: number;
    let g: number;
    let b: number;
    let a = 1;
    if (c === 1) {
      r = g = b = finite(src[base]!);
    } else if (c === 3) {
      r = finite(src[base]!);
      g = finite(src[base + 1]!);
      b = finite(src[base + 2]!);
    } else {
      // c === 4 (rgba); alpha passes through the encode as a plain [0,1] value.
      r = finite(src[base]!);
      g = finite(src[base + 1]!);
      b = finite(src[base + 2]!);
      a = finite(src[base + 3]!);
    }

    // 1) exposure in scene-linear, 2) tone-map HDR→[0,1], 3) output-encode.
    const lit: RgbTriple = [
      applyExposure(r, exposure),
      applyExposure(g, exposure),
      applyExposure(b, exposure),
    ];
    const [tr, tg, tb] = op(lit);
    const o = i * 4;
    out[o] = 255 * outputEncode(tr, gamma);
    out[o + 1] = 255 * outputEncode(tg, gamma);
    out[o + 2] = 255 * outputEncode(tb, gamma);
    // Alpha is a coverage value, not light — clamp to [0,1], no tone-map.
    out[o + 3] = 255 * (a < 0 ? 0 : a > 1 ? 1 : a);
  }
  return new ImageData(out, w, h);
}

export default function HdrImagePane({
  hdr,
  tonemap = "srgb",
  exposure = 0,
  gamma,
  showAxes = false,
  label = "",
  interpolation = "auto",
  zoom = 1,
  pan = { x: 0, y: 0 },
  onViewportChange,
  pixelValueNotation = "decimal",
}: HdrImagePaneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgWrapperRef = useRef<HTMLDivElement | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  // Retained tone-mapped pixels — used for the overlay's auto-contrast.
  const dispDataRef = useRef<ImageData | null>(null);
  const [pixelDataVersion, setPixelDataVersion] = useState(0);
  const [notation, setNotation] = useState<PixelValueNotation>(pixelValueNotation);
  const [overlayActive, setOverlayActive] = useState(false);

  // Single CPU tone-map pass; reruns on data / tonemap / exposure / gamma.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let imageData: ImageData;
    try {
      imageData = tonemapToImageData(hdr, tonemap, exposure, gamma);
    } catch (err) {
      console.error("[cairn] HDR tone-map error:", err);
      return;
    }
    if (canvas.width !== imageData.width || canvas.height !== imageData.height) {
      canvas.width = imageData.width;
      canvas.height = imageData.height;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(imageData, 0, 0);
    dispDataRef.current = imageData;
    setPixelDataVersion((v) => v + 1);
    setDims((prev) =>
      prev && prev.w === imageData.width && prev.h === imageData.height
        ? prev
        : { w: imageData.width, h: imageData.height },
    );
  }, [hdr, tonemap, exposure, gamma]);

  const { containerProps: viewportProps } = useImageViewport({
    containerRef: paneRef,
    zoom,
    pan,
    onViewportChange,
  });

  // TEV-style per-pixel value overlay: reads the RAW float samples so the
  // numbers are the true scene values (not the tone-mapped display pixels).
  const samplePixel = useCallback(
    (px: number, py: number, notation: PixelValueNotation): PixelSample | null => {
      const d = dims;
      if (!d || px < 0 || py < 0 || px >= d.w || py >= d.h) return null;
      const c = hdr.shape.length === 2 ? 1 : (hdr.shape[2] ?? 1);
      const base = (py * d.w + px) * c;
      const src = hdr.data;
      const disp = dispDataRef.current;
      let luminance = 0.5;
      if (disp && disp.width === d.w && disp.height === d.h) {
        const j = (py * d.w + px) * 4;
        luminance =
          (0.299 * disp.data[j]! +
            0.587 * disp.data[j + 1]! +
            0.114 * disp.data[j + 2]!) /
          255;
      }
      if (c === 1) {
        return {
          lines: [formatChannelValue(src[base] ?? 0, "unit", notation)],
          luminance,
        };
      }
      // Multi-channel HDR: tint each float line by its channel (R/G/B).
      return {
        lines: [
          formatChannelValue(src[base] ?? 0, "unit", notation),
          formatChannelValue(src[base + 1] ?? 0, "unit", notation),
          formatChannelValue(src[base + 2] ?? 0, "unit", notation),
        ],
        luminance,
        colors: [CHANNEL_COLORS[0], CHANNEL_COLORS[1], CHANNEL_COLORS[2]],
      };
    },
    [hdr, dims],
  );

  const imgRendering = interpolation === "auto" ? undefined : interpolation;
  const transformStr = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;

  return (
    <div className="relative flex flex-col h-full">
      <div
        ref={paneRef}
        className="relative flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard"
        style={{ padding: showAxes && dims ? "16px 4px 4px 28px" : "4px", ...viewportProps.style }}
        onPointerDown={viewportProps.onPointerDown}
        onPointerMove={viewportProps.onPointerMove}
        onPointerUp={viewportProps.onPointerUp}
        onPointerCancel={viewportProps.onPointerCancel}
      >
        <div
          ref={imgWrapperRef}
          className="relative w-full h-full"
          style={{ transform: transformStr, transformOrigin: "0 0" }}
        >
          <canvas
            ref={canvasRef}
            className="w-full h-full object-contain block"
            style={{ imageRendering: imgRendering }}
          />
          {showAxes && dims && (
            <PixelAxes
              naturalWidth={dims.w}
              naturalHeight={dims.h}
              zoom={zoom}
              containerRef={imgWrapperRef}
            />
          )}
        </div>
        {dims && (
          <PixelValueOverlay
            imageElRef={canvasRef}
            naturalWidth={dims.w}
            naturalHeight={dims.h}
            zoom={zoom}
            pan={pan}
            sample={samplePixel}
            notation={notation}
            version={pixelDataVersion}
            onActiveChange={setOverlayActive}
          />
        )}
        {overlayActive && (
          <PixelNotationToggle notation={notation} onChange={setNotation} />
        )}
      </div>
      {label ? <LabelChip label={label} /> : null}
    </div>
  );
}
