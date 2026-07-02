export type { DiffMode } from "../types";
import type { DiffMode } from "../types";
import { getCachedLoadedImageData, setCachedLoadedImageData } from "./cache";

export const DIFF_MODE_LABELS: Record<DiffMode, string> = {
  signed: "Signed Error",
  absolute: "Absolute Error",
  squared: "Squared Error",
  relative_signed: "Relative Signed",
  relative_absolute: "Relative Absolute",
  relative_squared: "Relative Squared",
};

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
        const denom = Math.max(a, 1);
        let v: number;

        switch (mode) {
          case "signed":
            v = (diff + 255) / 2;
            break;
          case "absolute":
            v = absDiff;
            break;
          case "squared":
            v = (diff * diff) / 255;
            break;
          case "relative_signed":
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

      result.data[ri + 3] = 255;
    }
  }

  return result;
}

export async function loadImageData(url: string): Promise<ImageData | null> {
  const cached = getCachedLoadedImageData(url);
  if (cached) return cached;

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        setCachedLoadedImageData(url, data);
        resolve(data);
      } catch (err) {
        console.warn("[cairn] loadImageData failed:", err);
        resolve(null);
      }
    };
    img.onerror = (err) => {
      console.warn("[cairn] loadImageData: image failed to load:", url, err);
      resolve(null);
    };
    img.src = url;
  });
}
