import type { ColormapName } from "../types";
import { getColormapLUT } from "./lut";

/**
 * Apply a colormap LUT to an ImageData.
 *
 * `mode` controls how pixel values map to the LUT:
 * - "linear": 0→LUT[0], 255→LUT[255]. Use for raw images and non-signed diffs.
 * - "signed": Same as linear, but semantically the midpoint (128) represents
 *   zero diff. Use for signed diffs where the computation already maps zero to 128.
 * - "positive": 0→LUT[128], 255→LUT[255]. Use for absolute/squared diffs
 *   where 0 = no diff (should map to colormap center/white in diverging maps).
 */
export function applyColormap(
  src: ImageData,
  cmap: ColormapName,
  mode: "linear" | "signed" | "positive" = "linear",
): ImageData {
  const lut = getColormapLUT(cmap);
  const out = new ImageData(src.width, src.height);
  const sd = src.data;
  const od = out.data;
  for (let i = 0; i < sd.length; i += 4) {
    const avg = (sd[i]! + sd[i + 1]! + sd[i + 2]!) / 3;
    let idx: number;
    if (mode === "positive") {
      idx = Math.round(128 + (avg / 255) * 127);
    } else {
      idx = Math.round(avg);
    }
    idx = Math.max(0, Math.min(255, idx));
    od[i] = lut[idx * 3]!;
    od[i + 1] = lut[idx * 3 + 1]!;
    od[i + 2] = lut[idx * 3 + 2]!;
    od[i + 3] = sd[i + 3]!;
  }
  return out;
}
