import type { ColormapName } from "../types";
import { getColormapLUT } from "../colormaps";
import { SERIES_COLORS } from "../types";

/** Options shared by the strided color helpers below. */
export interface StridedColorOptions {
  /** Element stride between successive values/categories (default 1 = contiguous). */
  stride?: number;
  /** Offset of the first value/category within each stride (default 0). */
  offset?: number;
  /** Reuse an existing `Float32Array(nPoints * 3)` instead of allocating one. */
  out?: Float32Array;
}

/**
 * Maps `nPoints` scalar values to an interleaved RGB `Float32Array` (0..1
 * per channel) via a colormap LUT over an explicit `[min, max]` domain.
 *
 * `stride`/`offset` let callers read values directly out of an interleaved
 * source buffer (e.g. a pointcloud's `xyzc` layout) without a copy — pass
 * `values` as the raw buffer and `offset` as the value's position within
 * each point's stride.
 */
export function valuesToColors(
  values: ArrayLike<number>,
  nPoints: number,
  domain: [number, number],
  colormap: ColormapName = "viridis",
  opts?: StridedColorOptions,
): Float32Array {
  const { stride = 1, offset = 0, out } = opts ?? {};
  const colors = out ?? new Float32Array(nPoints * 3);
  const lut = getColormapLUT(colormap);
  const [min, max] = domain;
  const span = max - min || 1;
  for (let i = 0; i < nPoints; i++) {
    const v = values[i * stride + offset]!;
    const t = Math.max(0, Math.min(1, (v - min) / span));
    const idx = Math.min(255, Math.max(0, Math.round(t * 255)));
    colors[i * 3] = lut[idx * 3]! / 255;
    colors[i * 3 + 1] = lut[idx * 3 + 1]! / 255;
    colors[i * 3 + 2] = lut[idx * 3 + 2]! / 255;
  }
  return colors;
}

function hexToRgb01(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

const CATEGORY_PALETTE_01: Array<[number, number, number]> = SERIES_COLORS.map(hexToRgb01);

/**
 * Maps integer category ids to RGB via the shared `SERIES_COLORS` palette
 * (cycled with modulo, matching the workspace's categorical color scheme
 * used by scalar/scatter plots).
 */
export function categoriesToColors(
  categories: ArrayLike<number>,
  nPoints: number,
  opts?: StridedColorOptions,
): Float32Array {
  const { stride = 1, offset = 0, out } = opts ?? {};
  const colors = out ?? new Float32Array(nPoints * 3);
  for (let i = 0; i < nPoints; i++) {
    const cat = Math.max(0, Math.round(categories[i * stride + offset]!));
    const [r, g, b] = CATEGORY_PALETTE_01[cat % CATEGORY_PALETTE_01.length]!;
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  return colors;
}

/**
 * Copies `(r, g, b)` triples already present in `data` at `stride`-spaced
 * offsets starting at `offset` into an interleaved RGB `Float32Array`. Values
 * are copied as-is (0..1 or 0..255) — callers normalize beforehand if their
 * source uses a byte range.
 */
export function packRgbColors(
  data: ArrayLike<number>,
  nPoints: number,
  stride: number,
  offset: number,
  out?: Float32Array,
): Float32Array {
  const colors = out ?? new Float32Array(nPoints * 3);
  for (let i = 0; i < nPoints; i++) {
    colors[i * 3] = data[i * stride + offset]!;
    colors[i * 3 + 1] = data[i * stride + offset + 1]!;
    colors[i * 3 + 2] = data[i * stride + offset + 2]!;
  }
  return colors;
}
