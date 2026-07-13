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
 * actual canvas pixels, not a CSS filter. CPU decode is fine for v1 sizes; a
 * WebGL2 fragment-shader port (upload the float data as a texture, tone-map in
 * a shader) is the future perf upgrade for large images / live scrubbing.
 *
 * SHAPE: `[H,W]` grayscale, `[H,W,1]` gray, `[H,W,3]` rgb, `[H,W,4]` rgba.
 * NaN/Inf pixels are treated as 0. The pane fills its container (like
 * ImagePane); the standalone adapter's `ChartBox` provides the sizing box.
 */
import { useEffect, useRef, useState } from "react";
import {
  getTonemapOperator,
  applyExposure,
  outputEncode,
  type RgbTriple,
} from "../image/tonemap";
import type { Interpolation } from "../types";
import PixelAxes from "../primitives/PixelAxes";
import LabelChip from "../primitives/LabelChip";

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
}: HdrImagePaneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgWrapperRef = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

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
    setDims((prev) =>
      prev && prev.w === imageData.width && prev.h === imageData.height
        ? prev
        : { w: imageData.width, h: imageData.height },
    );
  }, [hdr, tonemap, exposure, gamma]);

  const imgRendering = interpolation === "auto" ? undefined : interpolation;

  return (
    <div className="relative flex flex-col h-full">
      <div
        className="flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard"
        style={{ padding: showAxes && dims ? "16px 4px 4px 28px" : "4px" }}
      >
        <div
          ref={imgWrapperRef}
          className="relative w-full h-full"
          style={{ transformOrigin: "0 0" }}
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
              zoom={1}
              containerRef={imgWrapperRef}
            />
          )}
        </div>
      </div>
      {label ? <LabelChip label={label} /> : null}
    </div>
  );
}
