import type { FrameSource } from "../viewport/types";

// ---------------------------------------------------------------------------
// Cross-type raster alignment (WS-VC6, prototype-first per the design doc's
// §2.4 / §5 risk #1).
//
// side/split/blend cross-type (image <-> 3D) are "free": the compositor
// already layers ANY two FrameSources as plain <img>s regardless of pixel
// dimensions (CSS `object-fit: contain` handles the aspect mismatch visually
// — see MediaComparePane/ImagePane). Pixel `diff`, however, does per-pixel
// math (`image/diff.ts`'s `computeDiff`, which crops to `min(width,height)`,
// top-left anchored) — meaningful only when the two rasters depict the same
// spatial content at the same scale/aspect. An image capture (arbitrary
// native resolution) and a 3D-rendered canvas (a fixed offscreen size, e.g.
// 640x480) will almost never already match, so a naive top-left crop would
// silently compare mismatched regions.
//
// This module is the ONE alignment step: resample + letterbox both frames to
// a COMMON target raster before handing them to the EXISTING diff pipeline
// (image/diff.ts's computeDiff via ImagePane, unmodified) — not a second diff
// implementation.
//
// Design decisions (see ws-VC6-report.md for the prototype evidence):
//  - Target size: bounded by the SMALLER of the two sources' own resolution
//    (never upsample past either source — upsampling manufactures detail
//    that isn't there and would make the diff look noisier than reality),
//    additionally capped at MAX_COMPARE_DIM to bound compute cost for a
//    high-res image against a modest 3D canvas.
//  - Target ASPECT: the PRIMARY (foreground) frame's aspect ratio — a diff
//    reads as "the reference resampled onto the primary's frame", consistent
//    with every other diff mode (`other` vs `baseline`, primary always the
//    "shape" being evaluated).
//  - Fit: "contain" (preserve each source's own aspect, centered, letterboxed
//    with transparent padding) — the SAME visual fit already used on-screen
//    for split/blend/normal (`object-fit: contain`), so the diff matches what
//    the user sees in side/split/blend, not a stretched/distorted reading.
//  - Colorspace: no explicit conversion. Canvas 2D `drawImage` already
//    normalizes both an `<img>` (decoded sRGB) and a WebGL canvas readback
//    (browser-composited sRGB) into the same 8-bit RGBA target — exactly
//    what the existing same-type 3D-vs-3D compare path already relies on
//    (`useOffscreenSnapshot` -> `canvas.toDataURL()` -> `<img>`), so this
//    introduces no new colorspace assumption.
// ---------------------------------------------------------------------------

const MAX_COMPARE_DIM = 1024;

interface Drawable {
  el: CanvasImageSource;
  w: number;
  h: number;
}

function loadFrameSource(f: FrameSource): Promise<Drawable | null> {
  if (f.kind === "canvas") {
    return Promise.resolve({ el: f.canvas, w: f.canvas.width, h: f.canvas.height });
  }
  const src = f.kind === "url" ? f.url : f.dataUrl;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ el: img, w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export interface RasterAlignmentResult {
  /** Data URL of the primary (foreground) frame, resampled+letterboxed into
   *  the common target raster. */
  primaryUrl: string;
  /** Data URL of the reference (baseline) frame, resampled+letterboxed into
   *  the SAME common target raster (identical width/height to `primaryUrl`). */
  referenceUrl: string;
  width: number;
  height: number;
}

/**
 * Resample + letterbox two (possibly cross-type, possibly mismatched-size)
 * FrameSources onto one common raster so a pixel `diff` between them is
 * spatially meaningful. Pure/side-effect-free beyond transient canvas use;
 * returns `null` if either source fails to load (e.g. a broken URL).
 */
export async function alignFrameSourcesForDiff(
  primary: FrameSource,
  reference: FrameSource,
): Promise<RasterAlignmentResult | null> {
  const [pd, rd] = await Promise.all([loadFrameSource(primary), loadFrameSource(reference)]);
  if (!pd || !rd || pd.w <= 0 || pd.h <= 0 || rd.w <= 0 || rd.h <= 0) return null;

  const smallerMax = Math.min(Math.max(pd.w, pd.h), Math.max(rd.w, rd.h), MAX_COMPARE_DIM);
  const scale = smallerMax / Math.max(pd.w, pd.h);
  const width = Math.max(1, Math.round(pd.w * scale));
  const height = Math.max(1, Math.round(pd.h * scale));

  const drawLetterboxed = (d: Drawable): string => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    const fit = Math.min(width / d.w, height / d.h);
    const dw = d.w * fit;
    const dh = d.h * fit;
    ctx.drawImage(d.el, (width - dw) / 2, (height - dh) / 2, dw, dh);
    return canvas.toDataURL("image/png");
  };

  return {
    primaryUrl: drawLetterboxed(pd),
    referenceUrl: drawLetterboxed(rd),
    width,
    height,
  };
}
