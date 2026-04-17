/**
 * Client-side per-pixel image diff computation.
 *
 * Six diff modes covering signed/absolute/squared × raw/relative.
 * Signed modes map to [0, 255] via midpoint offset (128 = no diff).
 */

export type DiffMode =
  | "signed"
  | "absolute"
  | "squared"
  | "relative_signed"
  | "relative_absolute"
  | "relative_squared";

export const DIFF_MODE_LABELS: Record<DiffMode, string> = {
  signed: "Signed Error",
  absolute: "Absolute Error",
  squared: "Squared Error",
  relative_signed: "Relative Signed",
  relative_absolute: "Relative Absolute",
  relative_squared: "Relative Squared",
};

/**
 * Compute a per-pixel diff between a baseline and another image.
 * Both inputs and the output are ImageData objects (from Canvas getImageData).
 * If dimensions differ, crop to the intersection (min width × min height).
 */
export function computeDiff(
  baseline: ImageData,
  other: ImageData,
  mode: DiffMode,
): ImageData {
  const w = Math.min(baseline.width, other.width);
  const h = Math.min(baseline.height, other.height);
  const result = new ImageData(w, h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const bi = (y * baseline.width + x) * 4;
      const oi = (y * other.width + x) * 4;
      const ri = (y * w + x) * 4;

      for (let c = 0; c < 3; c++) {
        const a = baseline.data[bi + c]!;
        const b = other.data[oi + c]!;
        const diff = a - b;
        const absDiff = Math.abs(diff);
        const denom = Math.max(a, 1); // avoid division by zero
        let v: number;

        switch (mode) {
          case "signed":
            // Map [-255, 255] → [0, 255] via midpoint. 128 = no diff.
            v = (diff + 255) / 2;
            break;
          case "absolute":
            v = absDiff;
            break;
          case "squared":
            v = (diff * diff) / 255;
            break;
          case "relative_signed":
            // Map [-1, 1] → [0, 255] via midpoint. 128 = no diff.
            v = ((diff / denom) + 1) * 127.5;
            break;
          case "relative_absolute":
            v = (absDiff / denom) * 255;
            break;
          case "relative_squared":
            v = ((diff * diff) / (denom * denom)) * 255;
            break;
        }

        result.data[ri + c] = Math.min(255, Math.max(0, Math.round(v)));
      }

      result.data[ri + 3] = 255; // full alpha
    }
  }

  return result;
}

/**
 * Load an image URL into an ImageData by drawing to an offscreen canvas.
 * Returns null if the image fails to load.
 */
export async function loadImageData(url: string): Promise<ImageData | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
