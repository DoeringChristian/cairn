import type { ColormapName } from "../types";

function lerp3(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

export function buildLUT(stops: Array<[number, number, number]>): Uint8Array {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const seg = t * (stops.length - 1);
    const lo = Math.floor(seg);
    const hi = Math.min(lo + 1, stops.length - 1);
    const f = seg - lo;
    const [r, g, b] = lerp3(stops[lo]!, stops[hi]!, f);
    lut[i * 3] = Math.round(r);
    lut[i * 3 + 1] = Math.round(g);
    lut[i * 3 + 2] = Math.round(b);
  }
  return lut;
}

export const COLORMAP_STOPS: Record<ColormapName, Array<[number, number, number]>> = {
  viridis: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]],
  "red-green": [[215, 25, 28], [255, 255, 255], [26, 150, 65]],
  "red-blue": [[215, 25, 28], [255, 255, 255], [44, 123, 182]],
};

export const DIVERGING_COLORMAPS = new Set<string>(["red-green", "red-blue"]);

const colormapLUTs = new Map<string, Uint8Array>();

export function getColormapLUT(name: ColormapName): Uint8Array {
  let lut = colormapLUTs.get(name);
  if (!lut) {
    // Degrade an unknown colormap name to viridis rather than crash. The G2
    // Python composable API lets a caller pass an arbitrary `shared.colormap`
    // string, so a typo must not read `undefined.length` and blank the page.
    const stops = COLORMAP_STOPS[name] ?? COLORMAP_STOPS.viridis;
    lut = buildLUT(stops);
    colormapLUTs.set(name, lut);
  }
  return lut;
}
