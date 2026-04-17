export type DiffMode = "absolute" | "relative" | "squared";

/**
 * Compute a per-pixel diff between a baseline and another image.
 * Both inputs and the output are ImageData objects (from Canvas getImageData).
 * If dimensions differ, crop to the intersection (min width x min height).
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
        // R, G, B — skip alpha
        const a = baseline.data[bi + c]!;
        const b = other.data[oi + c]!;
        let v: number;

        switch (mode) {
          case "absolute":
            v = Math.abs(a - b);
            break;
          case "relative":
            // Dividing by max(a, 1) avoids division-by-zero when baseline pixel is 0.
            v = (Math.abs(a - b) / Math.max(a, 1)) * 255;
            break;
          case "squared":
            v = ((a - b) * (a - b)) / 255;
            break;
        }

        result.data[ri + c] = Math.min(255, Math.round(v));
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
    img.crossOrigin = "anonymous"; // same-origin, but set for safety
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
